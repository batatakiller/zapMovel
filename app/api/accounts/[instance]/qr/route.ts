import { NextRequest, NextResponse } from "next/server";
import { connectInstance, connectionState } from "@/lib/evolution";

// GET /api/accounts/<instance>/qr — devolve o QR code (base64) para parear o
// número e o estado atual da conexão. O app chama de tempos em tempos até o
// state virar 'open'.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ instance: string }> }) {
  const { instance } = await params;

  try {
    const state = await connectionState(instance);
    if (state === "open") {
      return NextResponse.json({ state, qr: null, connected: true });
    }
    const conn = await connectInstance(instance);
    const qr = conn?.base64 ?? conn?.qrcode?.base64 ?? null;
    const pairingCode = conn?.pairingCode ?? conn?.code ?? null;
    return NextResponse.json({ state, qr, pairingCode, connected: false });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "falha ao obter QR" }, { status: 502 });
  }
}
