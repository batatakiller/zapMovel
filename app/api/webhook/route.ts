import { NextRequest, NextResponse } from "next/server";
import { ingestEvent } from "@/lib/ingest";

// Recebe eventos do Evolution API. Se WEBHOOK_FORWARD_URL estiver definido,
// reenvia o payload intacto (mantém o bot do n8n funcionando em paralelo).
export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => null);
  if (!payload) return NextResponse.json({ ok: false }, { status: 400 });

  const forward = process.env.WEBHOOK_FORWARD_URL;
  const tasks: Promise<unknown>[] = [];

  // o n8n sempre recebeu SÓ MESSAGES_UPSERT — reenviar outros eventos poderia
  // quebrar o fluxo do bot, então filtra antes de reenviar
  const ev = String(payload.event ?? "").toLowerCase().replace(/_/g, ".");
  if (forward && ev === "messages.upsert") {
    tasks.push(
      fetch(forward, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch((e) => console.error("forward n8n falhou:", e?.message))
    );
  }

  tasks.push(
    ingestEvent(payload.event ?? "", payload.instance ?? "super", payload.data).catch((e) =>
      console.error("ingest falhou:", e?.message)
    )
  );

  await Promise.all(tasks);
  return NextResponse.json({ ok: true });
}
