import { supabaseAdmin } from "./supabase-server";
import { normalizeUpsert, normalizeStatus, ZapRow, jidToPhone } from "./normalize";
import { sendPushToAll } from "./push";

// Grava/atualiza mensagens vindas do Evolution (webhook ou websocket).
// Upsert por (instance, message_id): o mesmo evento pode chegar duas vezes
// (ex.: MESSAGES_UPSERT do que enviamos + insert otimista do /api/send).
export async function ingestEvent(event: string, instance: string, data: any): Promise<void> {
  const db = supabaseAdmin();
  const ev = event.toLowerCase().replace(/_/g, ".");

  if (ev === "messages.upsert" || ev === "send.message") {
    const items = Array.isArray(data) ? data : [data];
    const rows = items
      .map((m: any) => normalizeUpsert(instance, m.messages?.[0] ?? m))
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
