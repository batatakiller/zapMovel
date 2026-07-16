// Importa o histórico de mensagens do Evolution para zap_messages.
// Uso: npm run backfill            (importa até 40 páginas x 50 = 2000 mensagens)
//      PAGES=100 npm run backfill  (mais histórico)

import { normalizeUpsert, upsertRows, findMessages } from "./evo-common.mjs";

const MAX_PAGES = Number(process.env.PAGES ?? 40);
const PER_PAGE = 50;

let imported = 0;
for (let page = 1; page <= MAX_PAGES; page++) {
  const { records, pages, total } = await findMessages(page, PER_PAGE);
  if (!records?.length) break;
  const rows = records.map(normalizeUpsert);
  imported += await upsertRows(rows);
  console.log(`[backfill] página ${page}/${Math.min(pages ?? MAX_PAGES, MAX_PAGES)} — ${imported}/${total} mensagens`);
  if (page >= (pages ?? 1)) break;
}
console.log(`[backfill] concluído: ${imported} mensagens importadas`);
process.exit(0);
