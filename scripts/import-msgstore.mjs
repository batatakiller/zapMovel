// Importa um backup do WhatsApp Android (msgstore.db já DESCRIPTOGRAFADO) para
// zap_messages, criando/associando a uma conta. Preserva conversas e arquivos.
//
// Uso:
//   node scripts/import-msgstore.mjs <caminho/msgstore.db> --instance <nome> \
//        [--label "Meu Zap Antigo"] [--color "#25D366"] [--phone 5562999999999] \
//        [--media "<pasta WhatsApp>"] [--limit N] [--skip-media]
//
// --media  aponta para a pasta que contém "Media/" (ex.: .../Android/media/com.whatsapp/WhatsApp
//          ou a antiga /sdcard/WhatsApp). Sem ela, importa só os textos/rótulos.
//
// Requer Node com node:sqlite (v22.5+; em versões < 24 rode com --experimental-sqlite).

import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { supabase } from "./evo-common.mjs";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (e) {
  console.error("node:sqlite indisponível. Use Node 22.5+ e, se preciso, a flag --experimental-sqlite.");
  console.error(e.message);
  process.exit(1);
}

// ---------- argumentos ----------
const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith("--"));
function opt(name, def = null) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
}
const flag = (name) => args.includes(`--${name}`);

const instance = opt("instance");
const label = opt("label");
const color = opt("color", "#128C7E");
const phone = opt("phone");
const mediaDir = opt("media");
const limit = Number(opt("limit", "0")) || 0;
const skipMedia = flag("skip-media") || !mediaDir;

if (!dbPath || !existsSync(dbPath)) {
  console.error("Informe o caminho do msgstore.db descriptografado. Ex.:\n  node scripts/import-msgstore.mjs ./msgstore.db --instance arquivo-antigo --label 'Zap Antigo'");
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(instance ?? "")) {
  console.error("--instance é obrigatório (minúsculas, números e hífen). Ex.: --instance arquivo-antigo");
  process.exit(1);
}

// ---------- helpers ----------
const EXT_BY_MIME = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/3gpp": "3gp", "audio/ogg": "ogg", "audio/mpeg": "mp3",
  "audio/mp4": "m4a", "audio/amr": "amr", "application/pdf": "pdf",
};
function extFor(mime, filePath) {
  const base = (mime ?? "").split(";")[0];
  if (EXT_BY_MIME[base]) return EXT_BY_MIME[base];
  const fromPath = filePath?.split(".").pop();
  if (fromPath && fromPath.length <= 5) return fromPath.toLowerCase();
  if (base.startsWith("image/")) return "jpg";
  if (base.startsWith("video/")) return "mp4";
  if (base.startsWith("audio/")) return "ogg";
  return "bin";
}
function mediaKind(mime) {
  if (!mime) return null;
  if (mime.startsWith("image/webp")) return ["sticker", "💟 Figurinha"];
  if (mime.startsWith("image/")) return ["image", "📷 Foto"];
  if (mime.startsWith("video/")) return ["video", "🎬 Vídeo"];
  if (mime.startsWith("audio/")) return ["audio", "🎤 Áudio"];
  return ["document", "📄 Documento"];
}
function isoFromMs(ms) {
  const n = Number(ms);
  if (!n) return new Date().toISOString();
  return new Date(n).toISOString();
}
// caminho absoluto do arquivo de mídia dentro da pasta --media
function resolveMediaPath(filePath) {
  if (!filePath || !mediaDir) return null;
  const idx = filePath.indexOf("Media/");
  const rel = idx >= 0 ? filePath.slice(idx) : filePath;
  const abs = join(mediaDir, rel);
  return existsSync(abs) ? abs : null;
}

// ---------- abre o banco ----------
const db = new DatabaseSync(dbPath, { readOnly: true });
const tables = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
);
function columns(table) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
  } catch {
    return new Set();
  }
}
const isModern = tables.has("message") && tables.has("jid") && tables.has("chat");
const isLegacy = tables.has("messages");
if (!isModern && !isLegacy) {
  console.error("Schema não reconhecido. Esperado 'message'+'jid'+'chat' (moderno) ou 'messages' (antigo).");
  process.exit(1);
}
console.log(`[import] schema ${isModern ? "MODERNO" : "ANTIGO"} — lendo ${dbPath}`);

// ---------- garante a conta ----------
{
  const { error } = await supabase.from("zap_accounts").upsert(
    {
      instance,
      label: label ?? instance,
      color,
      phone: phone ?? null,
      kind: "archive",
      sort_order: 200,
    },
    { onConflict: "instance", ignoreDuplicates: true }
  );
  if (error) console.warn("[import] aviso ao registrar conta (a tabela zap_accounts existe?):", error.message);
}

// ---------- monta as linhas ----------
function buildModernRows() {
  const groupSubject = new Map();
  if (columns("chat").has("subject")) {
    for (const r of db.prepare(
      "SELECT cj.raw_string AS jid, c.subject AS subject FROM chat c JOIN jid cj ON cj._id = c.jid_row_id WHERE cj.raw_string LIKE '%@g.us' AND c.subject IS NOT NULL"
    ).all()) {
      groupSubject.set(r.jid, r.subject);
    }
  }

  const hasMediaTable = tables.has("message_media");
  const mediaJoin = hasMediaTable
    ? "LEFT JOIN message_media mm ON mm.message_row_id = m._id"
    : "";
  const mediaCols = hasMediaTable ? "mm.file_path AS file_path, mm.mime_type AS mime_type" : "NULL AS file_path, NULL AS mime_type";

  const sql = `
    SELECT m._id AS _id, m.from_me AS from_me, m.key_id AS key_id, m.timestamp AS ts,
           m.text_data AS text_data, m.message_type AS mtype, m.status AS status,
           cj.raw_string AS chat_jid, ${mediaCols}
    FROM message m
    JOIN chat c ON c._id = m.chat_row_id
    JOIN jid cj ON cj._id = c.jid_row_id
    ${mediaJoin}
    ORDER BY m._id ${limit ? `LIMIT ${limit}` : ""}`;

  const out = [];
  for (const r of db.prepare(sql).all()) {
    const row = mapRow({
      key_id: r.key_id,
      from_me: r.from_me,
      chat_jid: r.chat_jid,
      ts: r.ts,
      text_data: r.text_data,
      mime_type: r.mime_type,
      file_path: r.file_path,
      caption: null,
      groupSubject,
    });
    if (row) out.push({ row, file_path: r.file_path, mime_type: r.mime_type });
  }
  return out;
}

function buildLegacyRows() {
  const cols = columns("messages");
  const capCol = cols.has("media_caption") ? "media_caption" : "NULL";
  const mimeCol = cols.has("media_mime_type") ? "media_mime_type" : "NULL";
  const sql = `
    SELECT _id, key_remote_jid AS chat_jid, key_from_me AS from_me, key_id,
           timestamp AS ts, data AS text_data, ${mimeCol} AS mime_type,
           ${capCol} AS caption
    FROM messages
    ORDER BY _id ${limit ? `LIMIT ${limit}` : ""}`;
  const out = [];
  for (const r of db.prepare(sql).all()) {
    const row = mapRow({
      key_id: r.key_id,
      from_me: r.from_me,
      chat_jid: r.chat_jid,
      ts: r.ts,
      text_data: r.text_data,
      mime_type: r.mime_type,
      file_path: null, // caminho de mídia não é confiável no schema antigo
      caption: r.caption,
      groupSubject: new Map(),
    });
    if (row) out.push({ row, file_path: null, mime_type: r.mime_type });
  }
  return out;
}

function mapRow({ key_id, from_me, chat_jid, ts, text_data, mime_type, file_path, caption, groupSubject }) {
  if (!key_id || !chat_jid || chat_jid === "status@broadcast") return null;
  const jid = String(chat_jid).replace(/:\d+@/, "@");
  const fromMe = from_me === 1 || from_me === true;

  const kind = mediaKind(mime_type);
  let type, content;
  if (kind) {
    type = kind[0];
    const cap = (caption ?? "").trim();
    content = cap ? `${kind[1]} — ${cap}` : kind[1];
  } else if (text_data && String(text_data).trim()) {
    type = "text";
    content = String(text_data);
  } else {
    // sem texto e sem mídia (evento de sistema, chamada, etc.) — ignora
    return null;
  }

  const isGroup = jid.endsWith("@g.us");
  const pushName = !fromMe && isGroup ? groupSubject.get(jid) ?? null : null;

  return {
    instance,
    remote_jid: jid,
    message_id: String(key_id),
    from_me: fromMe,
    push_name: pushName,
    type,
    content,
    // histórico: recebidas entram como 'read' (não inflam o não-lido); enviadas como 'sent'
    status: fromMe ? "sent" : "read",
    msg_timestamp: isoFromMs(ts),
    raw: null,
  };
}

const items = isModern ? buildModernRows() : buildLegacyRows();
console.log(`[import] ${items.length} mensagens mapeadas`);

// ---------- grava mensagens em lotes ----------
let saved = 0;
const BATCH = 500;
// dedupe por message_id (mesma key pode aparecer duas vezes)
const byId = new Map();
for (const it of items) byId.set(it.row.message_id, it);
const uniq = [...byId.values()];

for (let i = 0; i < uniq.length; i += BATCH) {
  const slice = uniq.slice(i, i + BATCH).map((it) => it.row);
  const { error } = await supabase
    .from("zap_messages")
    .upsert(slice, { onConflict: "instance,message_id" });
  if (error) {
    console.error("[import] erro no lote:", error.message);
  } else {
    saved += slice.length;
    process.stdout.write(`\r[import] mensagens gravadas: ${saved}/${uniq.length}`);
  }
}
process.stdout.write("\n");

// ---------- sobe as mídias ----------
if (skipMedia) {
  console.log("[import] mídia pulada (--skip-media ou sem --media).");
} else {
  const mediaItems = uniq.filter((it) => it.file_path && it.mime_type);
  console.log(`[import] tentando subir ${mediaItems.length} arquivos de mídia de ${mediaDir} ...`);
  let up = 0, miss = 0, fail = 0, bytes = 0;
  const CONC = 5;
  for (let i = 0; i < mediaItems.length; i += CONC) {
    await Promise.all(
      mediaItems.slice(i, i + CONC).map(async (it) => {
        const abs = resolveMediaPath(it.file_path);
        if (!abs) { miss++; return; }
        try {
          const buf = readFileSync(abs);
          bytes += statSync(abs).size;
          const name = `${it.row.message_id}.${extFor(it.mime_type, it.file_path)}`;
          const { error } = await supabase.storage
            .from("chat_media")
            .upload(name, buf, { contentType: it.mime_type, upsert: true });
          if (error) { fail++; if (process.env.DEBUG) console.error("\nupload:", error.message); }
          else up++;
        } catch (e) {
          fail++;
          if (process.env.DEBUG) console.error("\n", e.message);
        }
      })
    );
    process.stdout.write(`\r[import] mídia: ${up} enviadas, ${miss} não encontradas, ${fail} falhas`);
  }
  process.stdout.write("\n");
  console.log(`[import] ~${(bytes / 1e6).toFixed(1)} MB de mídia enviados ao bucket chat_media`);
}

db.close();
console.log(`\n[import] concluído: conta '${instance}' — ${saved} mensagens no ZapMóvel.`);
process.exit(0);
