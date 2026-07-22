import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { assertLiveInstance, getEvolutionConfig } from "@/lib/accounts";
import { jidToPhone } from "@/lib/normalize";
import { instanceName } from "@/lib/evolution";

// Envia imagem: body JSON { jid, base64 (sem prefixo data:), mimetype, fileName?, caption?, instance? }
export async function POST(req: NextRequest) {
  const { jid, base64, mimetype, fileName, caption, instance } = await req.json().catch(() => ({}));
  const inst = instance || instanceName;
  if (!jid || !base64 || !mimetype) {
    return NextResponse.json({ error: "jid, base64 e mimetype são obrigatórios" }, { status: 400 });
  }

  try {
    await assertLiveInstance(inst);
    const cfg = await getEvolutionConfig(inst);
    const res = await fetch(`${cfg.url}/message/sendMedia/${inst}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.apikey },
      body: JSON.stringify({
        number: jidToPhone(jid),
        mediatype: "image",
        mimetype,
        media: base64,
        fileName: fileName ?? "imagem.jpg",
        caption: caption ?? "",
      }),
    });
    const result = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Evolution sendMedia ${res.status}: ${JSON.stringify(result)}`);

    const messageId = result?.key?.id;
    if (messageId) {
      const db = supabaseAdmin();
      // guarda a foto no bucket compartilhado com o bot (mesmo padrão: <message_id>.jpg)
      const ext = mimetype === "image/png" ? "png" : "jpg";
      await db.storage
        .from("chat_media")
        .upload(`${messageId}.${ext}`, Buffer.from(base64, "base64"), {
          contentType: mimetype,
          upsert: true,
        })
        .catch(() => null);
      await db.from("zap_messages").upsert(
        {
          instance: inst,
          remote_jid: jid,
          message_id: messageId,
          from_me: true,
          type: "image",
          content: caption ? `📷 Foto — ${caption}` : "📷 Foto",
          status: "pending",
          msg_timestamp: new Date().toISOString(),
          raw: result,
        },
        { onConflict: "instance,message_id" }
      );
    }

    return NextResponse.json({ ok: true, id: messageId });
  } catch (e: any) {
    console.error("send-media falhou:", e?.message);
    return NextResponse.json({ error: e?.message ?? "falha no envio" }, { status: 502 });
  }
}
