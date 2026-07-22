import { NextRequest, NextResponse } from "next/server";
import { markRead, instanceName } from "@/lib/evolution";
import { listAccounts, getEvolutionConfig } from "@/lib/accounts";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const { jid, messages, instance } = await req.json().catch(() => ({}));
  const inst = instance || instanceName;
  if (!jid || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "jid e messages são obrigatórios" }, { status: 400 });
  }

  try {
    // Marca localmente como lido (funciona para contas ao vivo e de arquivo).
    const ids = messages.map((m: { id: string }) => m.id).filter(Boolean);
    if (ids.length) {
      await supabaseAdmin()
        .from("zap_messages")
        .update({ status: "read" })
        .eq("instance", inst)
        .eq("from_me", false)
        .in("message_id", ids);
    }

    // Envia o recibo de leitura ao WhatsApp só para contas ao vivo (Evolution).
    const accounts = await listAccounts();
    const acc = accounts.find((a) => a.instance === inst);
    if (acc?.kind !== "archive") {
      const cfg = await getEvolutionConfig(inst);
      await markRead(cfg, inst, messages).catch((e) => console.error("markRead evolution:", e?.message));
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("mark-read falhou:", e?.message);
    return NextResponse.json({ error: e?.message ?? "falha ao marcar como lido" }, { status: 502 });
  }
}
