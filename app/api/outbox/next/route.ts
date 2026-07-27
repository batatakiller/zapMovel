import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// O aparelho puxa daqui o que precisa enviar. A reserva é feita pela função
// zap_outbox_claim, que usa `for update skip locked` — dois ciclos do agente
// (ou dois aparelhos) nunca pegam a mesma linha.
export async function POST(req: NextRequest) {
  const token = process.env.ANDROID_INGEST_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "ANDROID_INGEST_TOKEN não configurado" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const { instance, limit } = await req.json().catch(() => ({}));
  if (!instance) {
    return NextResponse.json({ error: "instance é obrigatório" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db.rpc("zap_outbox_claim", {
    p_instance: instance,
    p_limit: Math.min(Number(limit) || 5, 20),
  });
  if (error) {
    console.error("outbox/next:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (data ?? []).map((r: any) => ({
    id: r.id,
    remote_jid: r.remote_jid,
    kind: r.kind,
    content: r.content,
    attempts: r.attempts,
  }));
  return NextResponse.json({ items });
}
