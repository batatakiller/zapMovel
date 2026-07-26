import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { normalizeAndroidBatch, type AndroidMessage } from "@/lib/android-ingest";

// Recebe lotes de mensagens lidas do msgstore.db do aparelho (scripts/android/
// sync_msgstore.py). Diferente do webhook do Evolution, aqui o payload já vem
// normalizado — o trabalho desta rota é reconciliar com o que a camada de
// notificação gravou antes, sem duplicar linha.
export async function POST(req: NextRequest) {
  const token = process.env.ANDROID_INGEST_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "ANDROID_INGEST_TOKEN não configurado" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const messages: AndroidMessage[] = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages[] é obrigatório" }, { status: 400 });
  }
  if (messages.length > 1000) {
    return NextResponse.json({ error: "lote grande demais (máx. 1000)" }, { status: 413 });
  }

  try {
    const result = await normalizeAndroidBatch(supabaseAdmin(), messages);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    console.error("ingest/android falhou:", e?.message);
    return NextResponse.json({ error: e?.message ?? "falha na ingestão" }, { status: 500 });
  }
}
