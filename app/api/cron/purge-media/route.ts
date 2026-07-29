import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// Apaga do bucket a mídia do tablet mais velha que a janela. Sem isso o
// Storage cresce ~9 MB/dia (medido) e estoura o 1 GB do plano gratuito em
// poucas semanas. A mensagem continua no banco — some o arquivo, não a
// conversa — e o original segue no aparelho, em /sdcard.
//
// Chamado pelo cron da Vercel (vercel.json). Também aceita chamada manual com
// o token de ingestão.
const DIAS = Number(process.env.MEDIA_RETENCAO_DIAS ?? 21);
const CONTA = process.env.MEDIA_RETENCAO_INSTANCE ?? "tablet-loja";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const doCron = auth === `Bearer ${process.env.CRON_SECRET}`;
  const manual = auth === `Bearer ${process.env.ANDROID_INGEST_TOKEN}`;
  if (!doCron && !manual) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const corte = new Date(Date.now() - DIAS * 86400_000).toISOString();

  // só mídia desta conta e mais velha que a janela; o `media_stored` é o que
  // diz qual arquivo apagar e some junto, para a mensagem não prometer uma
  // imagem que já não existe
  const { data, error } = await db
    .from("zap_messages")
    .select("id,raw")
    .eq("instance", CONTA)
    .not("raw->>media_stored", "is", null)
    .lt("msg_timestamp", corte)
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const alvos = (data ?? [])
    .map((r) => ({ id: r.id, arquivo: (r.raw as any)?.media_stored as string }))
    .filter((x) => x.arquivo);
  if (!alvos.length) return NextResponse.json({ ok: true, apagados: 0 });

  const { error: erroRemove } = await db.storage
    .from("chat_media")
    .remove(alvos.map((a) => a.arquivo));
  if (erroRemove) return NextResponse.json({ error: erroRemove.message }, { status: 500 });

  // limpa a marca em lote, para /api/media não redirecionar para o vazio
  for (const a of alvos) {
    const { data: linha } = await db.from("zap_messages").select("raw").eq("id", a.id).maybeSingle();
    const raw = { ...((linha?.raw as Record<string, unknown>) ?? {}) };
    delete raw.media_stored;
    await db.from("zap_messages").update({ raw }).eq("id", a.id);
  }

  return NextResponse.json({ ok: true, apagados: alvos.length, janela_dias: DIAS });
}
