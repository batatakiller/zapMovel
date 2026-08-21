import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// O aparelho confirma o que conseguiu (ou não) enviar. Falha não volta direto
// para 'queued': quem devolve à fila é a própria zap_outbox_claim, que recupera
// linhas presas em 'sending' há mais de 5 minutos. Assim uma falha permanente
// (conversa sem notificação ativa, por exemplo) não vira laço infinito — ela
// esgota as 5 tentativas e para.
export async function POST(req: NextRequest) {
  const token = process.env.ANDROID_INGEST_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "ANDROID_INGEST_TOKEN não configurado" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const { id, ok, error: erroAgente } = await req.json().catch(() => ({}));
  if (typeof id !== "number") {
    return NextResponse.json({ error: "id é obrigatório" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { error } = await db
    .from("zap_outbox")
    .update(
      ok
        ? { status: "sent", sent_at: new Date().toISOString(), error: null }
        : { status: "queued", error: String(erroAgente ?? "falha no aparelho").slice(0, 500) }
    )
    .eq("id", id);
  if (error) {
    console.error("outbox/ack:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // a bolha na conversa deixa de aparecer como pendente
  if (ok) {
    await db
      .from("zap_messages")
      .update({ status: "sent" })
      .eq("outbox_id", id)
      .then(() => null, () => null);
  } else {
    await db
      .from("zap_messages")
      .update({ status: "failed" })
      .eq("outbox_id", id)
      .then(() => null, () => null);
  }

  return NextResponse.json({ ok: true });
}
