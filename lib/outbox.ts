import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

// Mesma fórmula do sync_msgstore.py e do WaNotificationListener.java. Aqui ela
// serve para que a mensagem que VOCÊ enviou também seja reconhecida quando o
// msgstore trouxer a versão real, em vez de virar uma segunda bolha.
export function dedupeKey(jid: string, tsMillis: number, fromMe: boolean, texto: string) {
  const base = `${jid}|${Math.floor(tsMillis / 1000)}|${fromMe ? 1 : 0}|${texto.trim()}`;
  return createHash("sha1").update(base, "utf8").digest("hex");
}

/**
 * Enfileira uma mensagem para o aparelho enviar e já mostra a bolha na
 * conversa como 'pending'.
 *
 * A bolha otimista existe porque o aparelho só é consultado de tempos em
 * tempos: sem ela, você clicaria em enviar e não veria nada acontecer até o
 * próximo ciclo. Ela é substituída pela versão real quando o msgstore chegar.
 */
export async function enqueueAndroid(
  db: SupabaseClient,
  instance: string,
  jid: string,
  texto: string
): Promise<{ outboxId: number; messageId: string }> {
  const { data: fila, error: erroFila } = await db
    .from("zap_outbox")
    .insert({ instance, remote_jid: jid, kind: "text", content: texto })
    .select("id")
    .single();
  if (erroFila) throw new Error(`enfileirar: ${erroFila.message}`);

  const agora = Date.now();
  const chave = dedupeKey(jid, agora, true, texto);
  const messageId = `nl:${chave.slice(0, 16)}`;

  const { error: erroMsg } = await db.from("zap_messages").upsert(
    {
      instance,
      remote_jid: jid,
      message_id: messageId,
      from_me: true,
      type: "text",
      content: texto,
      status: "pending",
      msg_timestamp: new Date(agora).toISOString(),
      origin: "notif",
      dedupe_key: chave,
      outbox_id: fila.id,
    },
    { onConflict: "instance,message_id", ignoreDuplicates: true }
  );
  if (erroMsg) {
    // A fila é o que importa; a bolha é conforto visual. Não desfaz o envio.
    console.error("bolha otimista falhou:", erroMsg.message);
  }

  return { outboxId: fila.id, messageId };
}
