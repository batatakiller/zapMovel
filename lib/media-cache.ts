import { supabaseAdmin } from "./supabase-server";
import { getEvolutionConfig } from "./accounts";
import type { ZapRow } from "./normalize";

export const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/amr": "amr",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/zip": "zip",
  "text/plain": "txt",
};

// extensões conhecidas — usadas para checar se a mídia já está no bucket
// antes de buscar de novo no Evolution (evita download/upload repetido).
export const KNOWN_MEDIA_EXTENSIONS = [...new Set(Object.values(EXT_BY_MIME))];

export function extFor(mimetype: string): string {
  const base = mimetype?.split(";")[0] ?? "";
  if (EXT_BY_MIME[base]) return EXT_BY_MIME[base];
  if (base.startsWith("image/")) return "jpg";
  if (base.startsWith("video/")) return "mp4";
  if (base.startsWith("audio/")) return "ogg";
  return "bin";
}

const MEDIA_TYPES = new Set(["image", "sticker", "audio", "video", "document"]);

function bucketUrl(name: string): string {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/chat_media/${name}`;
}

// Garante que a mídia de uma mensagem (foto, áudio, vídeo, documento) esteja
// salva no bucket chat_media, mesmo que ninguém tenha aberto a conversa
// ainda. O WhatsApp/Evolution não guarda mídia para sempre — sem isso, uma
// mídia recebida e nunca vista pode se perder de vez.
export async function cacheMediaForRow(row: ZapRow): Promise<void> {
  if (!MEDIA_TYPES.has(row.type)) return;
  const key = (row.raw as any)?.key;
  if (!key?.id) return;

  // já está no bucket? evita buscar de novo no Evolution. Checa todas as
  // extensões em paralelo (sequencial seria lento — até 19 round-trips).
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
    if (!res.ok) return; // mídia pode já ter expirado no Evolution — nada a fazer

    const json = await res.json();
    if (!json?.base64) return;

    const mimetype: string = json.mimetype ?? "application/octet-stream";
    const buf = Buffer.from(json.base64, "base64");
    const db = supabaseAdmin();
    const { error } = await db.storage
      .from("chat_media")
      .upload(`${row.message_id}.${extFor(mimetype)}`, buf, { contentType: mimetype, upsert: true });
    if (error) console.error(`cacheMediaForRow(${row.message_id}): upload falhou:`, error.message);
  } catch (e: any) {
    console.error(`cacheMediaForRow(${row.message_id}):`, e?.message);
  }
}
