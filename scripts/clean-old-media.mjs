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

const daysArg = process.argv.find((a) => a.startsWith("--days="));
const DAYS = daysArg ? parseInt(daysArg.split("=")[1], 10) : 60;

async function main() {
  const cutoffTime = Date.now() - DAYS * 24 * 60 * 60 * 1000;
  const cutoffDateStr = new Date(cutoffTime).toISOString();
  console.log(`[clean-old-media] Buscando mídias no bucket chat_media criadas antes de: ${cutoffDateStr} (${DAYS} dias)`);

  let offset = 0;
  let totalDeleted = 0;
  let totalBytesFreed = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: files, error } = await supabase.storage.from("chat_media").list("", {
      limit: 500,
      offset: 0, // Como apagamos os arquivos antigos, o offset permanece 0
    });

    if (error) {
      console.error("[clean-old-media] Erro ao listar arquivos do bucket:", error.message);
      break;
    }

    if (!files || files.length === 0) {
      hasMore = false;
      break;
    }

    const toDelete = [];
    for (const f of files) {
      if (f.name && f.created_at) {
        const fileTime = new Date(f.created_at).getTime();
        if (fileTime < cutoffTime) {
          toDelete.push(f);
        }
      }
    }

    if (toDelete.length === 0) {
      // Se nenhuma mídia nas primeiras 500 é antiga, incrementa o offset para avançar
      offset += files.length;
      if (files.length < 500) hasMore = false;
      continue;
    }

    const fileNames = toDelete.map((f) => f.name);
    const bytesInBatch = toDelete.reduce((acc, f) => acc + (f.metadata?.size || 0), 0);

    // Deleta do storage em lotes de até 100
    for (let i = 0; i < fileNames.length; i += 100) {
      const chunk = fileNames.slice(i, i + 100);
      const { error: delErr } = await supabase.storage.from("chat_media").remove(chunk);
      if (delErr) {
        console.error("[clean-old-media] Erro ao deletar lote de mídias:", delErr.message);
      }
    }

    totalDeleted += fileNames.length;
    totalBytesFreed += bytesInBatch;
    console.log(`[clean-old-media] Removidos ${totalDeleted} arquivos... (~${(totalBytesFreed / (1024 * 1024)).toFixed(2)} MB liberados)`);
  }

  console.log(`\n[clean-old-media] Concluído! Total de arquivos apagados: ${totalDeleted} (~${(totalBytesFreed / (1024 * 1024)).toFixed(2)} MB).`);
}

main().catch(console.error);
