// Utilitários compartilhados entre bridge.mjs, backfill.mjs e import-msgstore.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// carrega .env.local sem depender de dotenv
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// remove barra(s) no final — evita "http://host//instance" ao concatenar
const stripTrailingSlash = (url) => (url ?? "").replace(/\/+$/, "");

export const EVOLUTION_URL = stripTrailingSlash(process.env.EVOLUTION_URL);
export const APIKEY = process.env.EVOLUTION_APIKEY;
export const INSTANCE = process.env.EVOLUTION_INSTANCE ?? "super";

export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Lista as instâncias AO VIVO (kind='live') cadastradas em zap_accounts.
// Se a tabela não existir ou estiver vazia, cai na instância única do .env.
export async function listLiveInstances() {
  try {
    const { data, error } = await supabase
      .from("zap_accounts")
      .select("instance,kind")
      .eq("kind", "live");
    if (error || !data?.length) return [INSTANCE];
    return data.map((a) => a.instance);
  } catch {
    return [INSTANCE];
  }
}

// Resolve URL + apikey do Evolution para uma conta: usa a configuração
// própria (zap_account_secrets) quando existir, senão cai no .env padrão.
// Espelha lib/accounts.ts#getEvolutionConfig.
export async function getEvolutionConfig(instance) {
  try {
    const { data } = await supabase
      .from("zap_account_secrets")
      .select("evolution_url,evolution_apikey")
      .eq("instance", instance)
      .maybeSingle();
    const customUrl = data?.evolution_url?.trim();
    return {
      url: customUrl ? stripTrailingSlash(customUrl) : EVOLUTION_URL,
      apikey: data?.evolution_apikey?.trim() || APIKEY,
    };
  } catch {
    return { url: EVOLUTION_URL, apikey: APIKEY };
  }
}

// --- normalização (espelha lib/normalize.ts) ---
const TYPE_MAP = {
  imageMessage: ["image", "📷 Foto"],
  videoMessage: ["video", "🎬 Vídeo"],
  audioMessage: ["audio", "🎤 Áudio"],
  documentMessage: ["document", "📄 Documento"],
  stickerMessage: ["sticker", "💟 Figurinha"],
  contactMessage: ["contact", "👤 Contato"],
  locationMessage: ["location", "📍 Localização"],
};
const STATUS_MAP = {
  0: "pending", 1: "pending", 2: "sent", 3: "delivered", 4: "read",
  PENDING: "pending", SERVER_ACK: "sent", DELIVERY_ACK: "delivered", READ: "read",
};
export const normStatus = (s) => (s == null ? "received" : STATUS_MAP[s] ?? String(s).toLowerCase());

function extractContent(msg) {
  if (!msg) return { type: "other", content: null };
  if (msg.conversation) return { type: "text", content: msg.conversation };
  if (msg.extendedTextMessage?.text) return { type: "text", content: msg.extendedTextMessage.text };
  if (msg.reactionMessage) return { type: "reaction", content: `Reagiu com ${msg.reactionMessage.text ?? "👍"}` };
  for (const [k, [type, label]] of Object.entries(TYPE_MAP)) {
    if (msg[k]) return { type, content: msg[k]?.caption ? `${label} — ${msg[k].caption}` : label };
  }
  return { type: "other", content: `[${Object.keys(msg)[0] ?? "?"}]` };
}

function canonicalJid(key) {
  if (!key?.remoteJid) return null;
  const jid = key.remoteJid.endsWith("@lid") && key.remoteJidAlt ? key.remoteJidAlt : key.remoteJid;
  // remove sufixo de dispositivo ("5562...:0@s.whatsapp.net" -> "5562...@s.whatsapp.net")
  return jid.replace(/:\d+@/, "@");
}

export function normalizeUpsert(data, instance = INSTANCE) {
  const key = data?.key;
  const jid = canonicalJid(key);
  if (!jid || !key?.id || jid === "status@broadcast") return null;
  const { type, content } = extractContent(data.message);
  const ts = data.messageTimestamp ? new Date(Number(data.messageTimestamp) * 1000) : new Date();
  return {
    instance,
    remote_jid: jid,
    message_id: key.id,
    from_me: !!key.fromMe,
    push_name: data.pushName ?? null,
    type,
    content,
    status: key.fromMe ? normStatus(data.status ?? "sent") : "received",
    msg_timestamp: ts.toISOString(),
    raw: data,
  };
}

export async function upsertRows(rows) {
  // dedupe por (instance, message_id) dentro do lote — o Postgres rejeita
  // ON CONFLICT que afete a mesma linha duas vezes
  const byId = new Map();
  for (const r of rows) if (r) byId.set(`${r.instance}|${r.message_id}`, r);
  const valid = [...byId.values()];
  if (!valid.length) return 0;
  const { error } = await supabase
    .from("zap_messages")
    .upsert(valid, { onConflict: "instance,message_id" });
  if (error) throw new Error(error.message);
  return valid.length;
}

export async function findMessages(instance = INSTANCE, page = 1, offset = 25) {
  const cfg = await getEvolutionConfig(instance);
  const res = await fetch(`${cfg.url}/chat/findMessages/${instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: cfg.apikey },
    body: JSON.stringify({ page, offset }),
  });
  if (!res.ok) throw new Error(`findMessages HTTP ${res.status}`);
  const json = await res.json();
  return json?.messages ?? { records: [], total: 0, pages: 1 };
}

// --- cache de mídia (espelha lib/media-cache.ts) ---
const EXT_BY_MIME = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/3gpp": "3gp",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/amr": "amr",
  "application/pdf": "pdf", "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/zip": "zip", "text/plain": "txt",
};
const KNOWN_MEDIA_EXTENSIONS = [...new Set(Object.values(EXT_BY_MIME))];
function extFor(mimetype) {
  const base = mimetype?.split(";")[0] ?? "";
  if (EXT_BY_MIME[base]) return EXT_BY_MIME[base];
  if (base.startsWith("image/")) return "jpg";
  if (base.startsWith("video/")) return "mp4";
  if (base.startsWith("audio/")) return "ogg";
  return "bin";
}
const MEDIA_TYPES = new Set(["image", "sticker", "audio", "video", "document"]);
function bucketUrl(name) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/chat_media/${name}`;
}

// Garante que a mídia de uma mensagem esteja salva no bucket chat_media,
// mesmo que ninguém tenha aberto a conversa ainda no app.
export async function cacheMediaForRow(row) {
  if (!MEDIA_TYPES.has(row.type)) return;
  const key = row.raw?.key;
  if (!key?.id) return;

  // checa todas as extensões em paralelo (sequencial seria lento)
  const alreadyCached = await Promise.any(
    KNOWN_MEDIA_EXTENSIONS.map(async (ext) => {
      const head = await fetch(bucketUrl(`${row.message_id}.${ext}`), { method: "HEAD", cache: "no-store" });
      if (!head.ok) throw new Error("not found");
    })
  )
    .then(() => true)
    .catch(() => false);
  if (alreadyCached) return;

  try {
    const cfg = await getEvolutionConfig(row.instance);
    if (!cfg.url || !cfg.apikey) return;
    const res = await fetch(`${cfg.url}/chat/getBase64FromMediaMessage/${row.instance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.apikey },
      body: JSON.stringify({ message: { key }, convertToMp4: false }),
      cache: "no-store",
    });
    if (!res.ok) return;
    const json = await res.json();
    if (!json?.base64) return;

    const mimetype = json.mimetype ?? "application/octet-stream";
    const buf = Buffer.from(json.base64, "base64");
    const { error } = await supabase.storage
      .from("chat_media")
      .upload(`${row.message_id}.${extFor(mimetype)}`, buf, { contentType: mimetype, upsert: true });
    if (error) console.error(`cacheMediaForRow(${row.message_id}): upload falhou:`, error.message);
  } catch (e) {
    console.error(`cacheMediaForRow(${row.message_id}):`, e.message);
  }
}
