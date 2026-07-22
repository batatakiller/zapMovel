import { supabaseAdmin } from "./supabase-server";
import { normalizeUpsert, normalizeStatus, extractReaction, ZapRow, ReactionRow, jidToPhone } from "./normalize";
import { sendPushToAll } from "./push";
import { cacheMediaForRow } from "./media-cache";

// Grava/atualiza mensagens vindas do Evolution (webhook ou websocket).
// Upsert por (instance, message_id): o mesmo evento pode chegar duas vezes
// (ex.: MESSAGES_UPSERT do que enviamos + insert otimista do /api/send).
export async function ingestEvent(event: string, instance: string, data: any): Promise<void> {
  const db = supabaseAdmin();
  const ev = event.toLowerCase().replace(/_/g, ".");

  if (ev === "messages.upsert" || ev === "send.message") {
    const items = Array.isArray(data) ? data : [data];
    const rawMsgs = items.map((m: any) => m.messages?.[0] ?? m);

    // reações são um evento de mensagem à parte — vão para zap_reactions,
    // nunca viram uma linha normal em zap_messages
    const reactions = rawMsgs
      .map((m: any) => extractReaction(instance, m))
      .filter((r: ReactionRow | null): r is ReactionRow => r !== null);
    if (reactions.length) {
      const { error } = await db
        .from("zap_reactions")
        .upsert(reactions, { onConflict: "instance,target_message_id,reactor_jid" });
      if (error) console.error("upsert zap_reactions:", error.message);
    }

    const rows = rawMsgs
      .map((m: any) => normalizeUpsert(instance, m))
      .filter((r: ZapRow | null): r is ZapRow => r !== null);
    if (!rows.length) return;
    const { error } = await db
      .from("zap_messages")
      .upsert(rows, { onConflict: "instance,message_id", ignoreDuplicates: false });
    if (error) throw new Error(`upsert zap_messages: ${error.message}`);

    // notifica os dispositivos sobre mensagens recebidas (nunca as suas)
    await Promise.all(
      rows
        .filter((r) => !r.from_me)
        .map((r) =>
          sendPushToAll({
            title: r.push_name || jidToPhone(r.remote_jid),
            body: r.content ?? "Nova mensagem",
            jid: r.remote_jid,
          }).catch((e) => console.error("push:", e?.message))
        )
    );

    // salva foto/áudio/vídeo/documento no bucket imediatamente — sem esperar
    // alguém abrir a conversa. Evita perder mídia que expira no Evolution.
    await Promise.all(rows.map((r) => cacheMediaForRow(r).catch((e) => console.error("cacheMedia:", e?.message))));

    return;
  }

  if (ev === "messages.update") {
    const items = Array.isArray(data) ? data : [data];
    for (const u of items) {
      const id = u?.keyId ?? u?.key?.id;
      const status = u?.status;
      if (!id || status === undefined) continue;
      const { error } = await db
        .from("zap_messages")
        .update({ status: normalizeStatus(status) })
        .eq("instance", instance)
        .eq("message_id", id);
      if (error) throw new Error(`update status: ${error.message}`);
    }
  }
}
