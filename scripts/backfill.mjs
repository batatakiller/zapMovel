// Importa o histórico de mensagens do Evolution para zap_messages.
// Uso: npm run backfill                 (todas as contas ao vivo, 40 páginas x 50)
//      PAGES=100 npm run backfill       (mais histórico)
//      INSTANCE=trabalho npm run backfill  (só uma conta específica)

import { normalizeUpsert, upsertRows, findMessages, listLiveInstances } from "./evo-common.mjs";

const MAX_PAGES = Number(process.env.PAGES ?? 40);
const PER_PAGE = 50;

// INSTANCE no env restringe a uma conta; senão faz backfill de todas as ao vivo.
const only = process.env.INSTANCE;
const instances = only ? [only] : await listLiveInstances();

for (const instance of instances) {
  console.log(`\n[backfill] === conta '${instance}' ===`);
  let imported = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    let result;
    try {
      result = await findMessages(instance, page, PER_PAGE);
    } catch (e) {
      console.error(`[backfill] '${instance}' página ${page} falhou: ${e.message}`);
      break;
    }
    const { records, pages, total } = result;
    if (!records?.length) break;
    const rows = records.map((r) => normalizeUpsert(r, instance));
    imported += await upsertRows(rows);
    console.log(`[backfill] '${instance}' página ${page}/${Math.min(pages ?? MAX_PAGES, MAX_PAGES)} — ${imported}/${total} mensagens`);
    if (page >= (pages ?? 1)) break;
  }
  console.log(`[backfill] '${instance}' concluído: ${imported} mensagens`);
}
process.exit(0);
