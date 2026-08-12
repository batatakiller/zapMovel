import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function cleanRaw(raw) {
  if (!raw || typeof raw !== "object") return null;
  let modified = false;
  const clone = JSON.parse(JSON.stringify(raw));

  if (clone.message && typeof clone.message === "object") {
    if (clone.message.base64) {
      delete clone.message.base64;
      modified = true;
    }
    if (clone.message.imageMessage?.jpegThumbnail) {
      delete clone.message.imageMessage.jpegThumbnail;
      modified = true;
    }
    if (clone.message.videoMessage?.jpegThumbnail) {
      delete clone.message.videoMessage.jpegThumbnail;
      modified = true;
    }
    if (clone.message.stickerMessage?.jpegThumbnail) {
      delete clone.message.stickerMessage.jpegThumbnail;
      modified = true;
    }
  }

  return modified ? clone : null;
}

async function main() {
  console.log("[clean-raw] Buscando mensagens com base64 / thumbnails pesadas no raw...");

  let processed = 0;
  let cleaned = 0;
  let hasMore = true;

  while (hasMore) {
    // Busca um lote de mensagens pesadas
    const { data: rows, error } = await supabase
      .from("zap_messages")
      .select("id, raw")
      .not("raw", "is", null)
      .order("id", { ascending: true })
      .range(processed, processed + 499);

    if (error) {
      console.error("[clean-raw] Erro ao buscar lote:", error.message);
      break;
    }

    if (!rows || rows.length === 0) {
      hasMore = false;
      break;
    }

    processed += rows.length;

    const updates = [];
    for (const r of rows) {
      const cleanedRaw = cleanRaw(r.raw);
      if (cleanedRaw) {
        updates.push({ id: r.id, raw: cleanedRaw });
      }
    }

    if (updates.length > 0) {
      const CONCURRENCY = 10;
      for (let i = 0; i < updates.length; i += CONCURRENCY) {
        const chunk = updates.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map((u) => supabase.from("zap_messages").update({ raw: u.raw }).eq("id", u.id))
        );
      }
      cleaned += updates.length;
      console.log(`[clean-raw] Processadas ${processed} linhas... Limpas até agora: ${cleaned}`);
    }

    if (rows.length < 500) {
      hasMore = false;
    }
  }

  console.log(`\n[clean-raw] Concluído! Total de mensagens limpas: ${cleaned} de ${processed} verificadas.`);
}

main().catch(console.error);
