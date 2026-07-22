import { NextRequest, NextResponse } from "next/server";
import { sendReaction, instanceName } from "@/lib/evolution";
import { assertLiveInstance, getEvolutionConfig } from "@/lib/accounts";
import { supabaseAdmin } from "@/lib/supabase-server";

// Reage a uma mensagem (ou remove sua própria reação, com emoji: "").
// Body: { jid, instance?, targetMessageId, targetFromMe, emoji }
export async function POST(req: NextRequest) {
  const { jid, instance, targetMessageId, targetFromMe, emoji } = await req.json().catch(() => ({}));
  const inst = instance || instanceName;
  if (!jid || !targetMessageId) {
    return NextResponse.json({ error: "jid e targetMessageId são obrigatórios" }, { status: 400 });
  }

  try {
    await assertLiveInstance(inst);
    const cfg = await getEvolutionConfig(inst);
    await sendReaction(
      cfg,
      inst,
      { remoteJid: jid, fromMe: !!targetFromMe, id: targetMessageId },
      emoji ?? ""
    );

    // insert otimista — o eco do webhook/bridge confirma na mesma linha
    await supabaseAdmin()
      .from("zap_reactions")
      .upsert(
        {
          instance: inst,
          remote_jid: jid,
          target_message_id: targetMessageId,
          reactor_jid: "me",
          from_me: true,
          emoji: emoji?.trim() || null,
          msg_timestamp: new Date().toISOString(),
        },
        { onConflict: "instance,target_message_id,reactor_jid" }
      );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("react falhou:", e?.message);
    return NextResponse.json({ error: e?.message ?? "falha ao reagir" }, { status: 502 });
  }
}
