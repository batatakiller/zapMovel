import webpush from "web-push";
import { supabaseAdmin } from "./supabase-server";

// Configura VAPID details se disponível (necessário para push notifications)
if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:admin@zapmovel.app",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

export type PushPayload = { title: string; body: string; jid: string };

// Envia a notificação para todos os dispositivos inscritos.
// Inscrições mortas (410/404) são removidas automaticamente.
export async function sendPushToAll(payload: PushPayload): Promise<void> {
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn("Push notifications desabilitadas: variáveis VAPID não configuradas");
    return;
  }

  const db = supabaseAdmin();
  const { data: subs, error } = await db.from("push_subscriptions").select("endpoint,subscription");
  if (error || !subs?.length) return;

  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription as webpush.PushSubscription, body, { TTL: 3600 });
      } catch (e: any) {
        if (e?.statusCode === 410 || e?.statusCode === 404) {
          await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        } else {
          console.error("push falhou:", e?.statusCode, e?.message);
        }
      }
    })
  );
}
