import { NextRequest, NextResponse } from "next/server";
import { sendText, instanceName, type QuotedRef } from "@/lib/evolution";
import { assertLiveInstance, getEvolutionConfig } from "@/lib/accounts";
import { supabaseAdmin } from "@/lib/supabase-server";
import { jidToPhone } from "@/lib/normalize";

export async function POST(req: NextRequest) {
  const { jid, text, instance, quotedMessageId } = await req.json().catch(() => ({}));
  const inst = instance || instanceName;
  if (!jid || !text?.trim()) {
    return NextResponse.json({ error: "jid e text são obrigatórios" }, { status: 400 });
  }

  try {
    await assertLiveInstance(inst);
    const db = supabaseAdmin();

    // responder: busca a mensagem citada pra montar o "quoted" do Evolution
    let quoted: QuotedRef | undefined;
    if (quotedMessageId) {
      const { data: quotedRow } = await db
        .from("zap_messages")
        .select("raw,from_me,content")
        .eq("instance", inst)
        .eq("message_id", quotedMessageId)
        .maybeSingle();
      const rawKey = (quotedRow?.raw as any)?.key;
      const rawMessage = (quotedRow?.raw as any)?.message;
      if (quotedRow) {
        quoted = {
          key: rawKey ?? { remoteJid: jid, fromMe: !!quotedRow.from_me, id: quotedMessageId },
          message: rawMessage ?? { conversation: quotedRow.content ?? "" },
        };
      }
    }

    const cfg = await getEvolutionConfig(inst);
    const result = await sendText(cfg, inst, jidToPhone(jid), text.trim(), quoted);
    const messageId = result?.key?.id;

    // insert otimista — o evento do websocket fará upsert na mesma linha
    if (messageId) {
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
          quoted_message_id: quotedMessageId ?? null,
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
