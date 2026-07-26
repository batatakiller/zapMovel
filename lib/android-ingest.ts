import type { SupabaseClient } from "@supabase/supabase-js";

// Uma mensagem como sai do scripts/android/sync_msgstore.py.
export type AndroidMessage = {
  instance: string;
  remote_jid: string;
  message_id: string;
  from_me: boolean;
  push_name: string | null;
  type: string;
  content: string | null;
  status: string;
  msg_timestamp: number; // epoch em milissegundos
  quoted_message_id: string | null;
  dedupe_key: string;
  origin: "msgstore";
  media_path: string | null;
  mime_type: string | null;
  sender_jid: string | null;
  is_group: boolean;
};

export type IngestResult = {
  received: number;
  inserted: number;
  reconciled: number; // linhas provisórias da notificação corrigidas
  updated: number; // linhas que já existiam com o id real
  jids: number;
};

// A camada de notificação grava a mensagem em segundos, mas sem o id real do
// WhatsApp — ela inventa um id sintético e guarda a dedupe_key. Quando o
// msgstore chega com a verdade, precisamos ATUALIZAR aquela linha em vez de
// inserir uma nova, senão cada mensagem apareceria duas vezes na conversa.
export async function normalizeAndroidBatch(
  db: SupabaseClient,
  messages: AndroidMessage[]
): Promise<IngestResult> {
  const instance = messages[0].instance;
  // um lote nunca deve misturar contas — a reconciliação abaixo assume uma só
  if (messages.some((m) => m.instance !== instance)) {
    throw new Error("um lote deve conter mensagens de uma única instância");
  }

  const messageIds = [...new Set(messages.map((m) => m.message_id))];
  const dedupeKeys = [...new Set(messages.map((m) => m.dedupe_key).filter(Boolean))];

  // Quem já está no banco com o id real? (sync rodou de novo sobre o mesmo trecho)
  const { data: existing, error: exErr } = await db
    .from("zap_messages")
    .select("message_id")
    .eq("instance", instance)
    .in("message_id", messageIds);
  if (exErr) throw new Error(`consulta de existentes: ${exErr.message}`);
  const alreadyReal = new Set((existing ?? []).map((r) => r.message_id));

  // Quais linhas provisórias da notificação correspondem a este lote?
  const { data: provisional, error: prErr } = await db
    .from("zap_messages")
    .select("id,dedupe_key")
    .eq("instance", instance)
    .eq("origin", "notif")
    .in("dedupe_key", dedupeKeys.length ? dedupeKeys : ["__vazio__"]);
  if (prErr) throw new Error(`consulta de provisórias: ${prErr.message}`);

  const notifRowByKey = new Map<string, number>();
  for (const r of provisional ?? []) {
    // se houver mais de uma provisória com a mesma chave, a primeira ganha e a
    // outra permanece — some no próximo ciclo, quando sua própria chave casar
    if (r.dedupe_key && !notifRowByKey.has(r.dedupe_key)) notifRowByKey.set(r.dedupe_key, r.id);
  }

  const toReconcile: { id: number; row: ReturnType<typeof toRow> }[] = [];
  const toUpsert: Record<string, unknown>[] = []; // upsert por (instance, message_id)
  const usedNotifRows = new Set<number>();

  for (const m of messages) {
    const row = toRow(m);
    const notifId = m.dedupe_key ? notifRowByKey.get(m.dedupe_key) : undefined;

    // Só reconcilia se o id real ainda não existir — do contrário o UPDATE
    // colidiria com a unicidade (instance, message_id).
    if (notifId !== undefined && !alreadyReal.has(m.message_id) && !usedNotifRows.has(notifId)) {
      usedNotifRows.add(notifId);
      toReconcile.push({ id: notifId, row });
    } else {
      toUpsert.push(row);
    }
  }

  // Precisa ser UPDATE, e não upsert: `id` é GENERATED ALWAYS, então o
  // INSERT ... ON CONFLICT do PostgREST é rejeitado ao receber um id explícito.
  // Atualizar no lugar (em vez de apagar e reinserir) mantém a linha estável
  // para o Realtime — a bolha na conversa é corrigida sem sumir e voltar.
  if (toReconcile.length) {
    const CONCURRENCY = 8;
    for (let i = 0; i < toReconcile.length; i += CONCURRENCY) {
      const results = await Promise.all(
        toReconcile.slice(i, i + CONCURRENCY).map(({ id, row }) =>
          db.from("zap_messages").update(row).eq("id", id)
        )
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(`reconciliação: ${failed.error.message}`);
    }
  }
  if (toUpsert.length) {
    const { error } = await db
      .from("zap_messages")
      .upsert(toUpsert, { onConflict: "instance,message_id", ignoreDuplicates: false });
    if (error) throw new Error(`upsert zap_messages: ${error.message}`);
  }

  const jids = await upsertJidMap(db, instance, messages);

  return {
    received: messages.length,
    inserted: toUpsert.filter((r) => !alreadyReal.has(r.message_id as string)).length,
    updated: toUpsert.filter((r) => alreadyReal.has(r.message_id as string)).length,
    reconciled: toReconcile.length,
    jids,
  };
}

function toRow(m: AndroidMessage) {
  return {
    instance: m.instance,
    remote_jid: m.remote_jid,
    message_id: m.message_id,
    from_me: m.from_me,
    push_name: m.push_name,
    type: m.type,
    content: m.content,
    status: m.status,
    msg_timestamp: new Date(m.msg_timestamp || Date.now()).toISOString(),
    quoted_message_id: m.quoted_message_id,
    origin: "msgstore",
    dedupe_key: m.dedupe_key,
    // media_path/mime_type ficam no raw: é o que o passo de upload de mídia usa
    // para achar o arquivo em /sdcard e mandar para o bucket chat_media
    raw: {
      media_path: m.media_path,
      mime_type: m.mime_type,
      sender_jid: m.sender_jid,
      is_group: m.is_group,
    },
  };
}

// Acumula o que se sabe sobre cada conversa. Para chats @lid o telefone não
// existe no aparelho (o WhatsApp deixou de guardá-lo), então phone fica nulo
// até que outra fonte — a notificação de um lead novo, ou a tela do chat —
// preencha. O nome, quando o aparelho tem, já vem aqui.
async function upsertJidMap(
  db: SupabaseClient,
  instance: string,
  messages: AndroidMessage[]
): Promise<number> {
  const byLid = new Map<string, { display_name: string | null }>();
  for (const m of messages) {
    if (!m.remote_jid.endsWith("@lid")) continue;
    const prev = byLid.get(m.remote_jid);
    // não deixa um nome conhecido ser sobrescrito por nulo de outra mensagem
    if (!prev || (!prev.display_name && m.push_name)) {
      byLid.set(m.remote_jid, { display_name: m.push_name });
    }
  }
  if (!byLid.size) return 0;

  const rows = [...byLid].map(([lid, v]) => ({
    instance,
    lid,
    display_name: v.display_name,
    source: "msgstore",
    updated_at: new Date().toISOString(),
  }));

  // Um lote pode trazer o mesmo LID sem nome (mensagem de chat cujo contato o
  // aparelho não conhece). Sobrescrever com nulo apagaria um nome já
  // descoberto antes, então só quem tem nome faz update; o resto apenas
  // registra o LID se ainda não existir.
  const comNome = rows.filter((r) => r.display_name);
  const semNome = rows.filter((r) => !r.display_name);

  if (comNome.length) {
    const { error } = await db.from("zap_jid_map").upsert(comNome, { onConflict: "instance,lid" });
    if (error) throw new Error(`upsert zap_jid_map: ${error.message}`);
  }
  if (semNome.length) {
    const { error } = await db
      .from("zap_jid_map")
      .upsert(semNome, { onConflict: "instance,lid", ignoreDuplicates: true });
    if (error) throw new Error(`insert zap_jid_map: ${error.message}`);
  }
  return rows.length;
}
