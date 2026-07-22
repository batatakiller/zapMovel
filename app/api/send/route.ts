import { NextRequest, NextResponse } from "next/server";
import { sendText, instanceName } from "@/lib/evolution";
import { assertLiveInstance } from "@/lib/accounts";
import { supabaseAdmin } from "@/lib/supabase-server";
import { jidToPhone } from "@/lib/normalize";

export async function POST(req: NextRequest) {
  const { jid, text, instance } = await req.json().catch(() => ({}));
  const inst = instance || instanceName;
  if (!jid || !text?.trim()) {
    return NextResponse.json({ error: "jid e text são obrigatórios" }, { status: 400 });
  }

  try {
    await assertLiveInstance(inst);
    const result = await sendText(inst, jidToPhone(jid), text.trim());
    const messageId = result?.key?.id;

    // insert otimista — o evento do websocket fará upsert na mesma linha
    if (messageId) {
      const db = supabaseAdmin();
      await db.from("zap_messages").upsert(
        {
          instance: inst,
          remote_jid: jid,
          message_id: messageId,
          from_me: true,
          type: "text",
          content: text.trim(),
          status: "pending",
          msg_timestamp: new Date().toISOString(),
          raw: result,
        },
        { onConflict: "instance,message_id" }
      );
    }

    return NextResponse.json({ ok: true, id: messageId });
  } catch (e: any) {
    console.error("send falhou:", e?.message);
    return NextResponse.json({ error: e?.message ?? "falha no envio" }, { status: 502 });
  }
}
