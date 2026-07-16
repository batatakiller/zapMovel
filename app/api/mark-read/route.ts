import { NextRequest, NextResponse } from "next/server";
import { markRead } from "@/lib/evolution";

export async function POST(req: NextRequest) {
  const { jid, messages } = await req.json().catch(() => ({}));
  if (!jid || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "jid e messages são obrigatórios" }, { status: 400 });
  }

  try {
    await markRead(messages);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("mark-read falhou:", e?.message);
    return NextResponse.json({ error: e?.message ?? "falha ao marcar como lido" }, { status: 502 });
  }
}
