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
  const cutoffDate = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
  console.log(`[clean-old-messages] Iniciando expurgo de mensagens anteriores a: ${cutoffDate} (${DAYS} dias)`);

  const { count: totalToDelete, error: countErr } = await supabase
    .from("zap_messages")
    .select("*", { count: "exact", head: true })
    .lt("msg_timestamp", cutoffDate);

  if (countErr) {
    console.error("[clean-old-messages] Erro ao contar mensagens:", countErr.message);
    process.exit(1);
  }

  console.log(`[clean-old-messages] Encontradas ${totalToDelete} mensagens para remover.`);
  if (!totalToDelete || totalToDelete === 0) {
    console.log("[clean-old-messages] Nenhuma mensagem antiga para limpar.");
    return;
  }

  let deleted = 0;
  const BATCH_SIZE = 500;

  while (deleted < totalToDelete) {
    // Busca os IDs do próximo lote
    const { data: rows, error: selectErr } = await supabase
      .from("zap_messages")
      .select("id")
      .lt("msg_timestamp", cutoffDate)
      .limit(BATCH_SIZE);

    if (selectErr || !rows || rows.length === 0) {
      if (selectErr) console.error("[clean-old-messages] Erro ao buscar lote:", selectErr.message);
      break;
    }

    const ids = rows.map((r) => r.id);
    const { error: delErr } = await supabase.from("zap_messages").delete().in("id", ids);

    if (delErr) {
      console.error("[clean-old-messages] Erro ao deletar lote:", delErr.message);
      break;
    }

    deleted += ids.length;
    console.log(`[clean-old-messages] Removidas ${deleted} de ${totalToDelete} mensagens...`);
  }

  console.log(`\n[clean-old-messages] Concluído! Total de mensagens limpas: ${deleted}.`);
}

main().catch(console.error);
