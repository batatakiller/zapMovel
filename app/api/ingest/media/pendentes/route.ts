import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// Lista as mensagens de mídia que têm o caminho do arquivo no aparelho mas
// ainda não têm o arquivo no bucket. É o que o scripts/android/upload_media.py
// consome para fechar o buraco deixado pela notificação, que só cobre o que
// chegou com o agente rodando.
export async function GET(req: NextRequest) {
  const token = process.env.ANDROID_INGEST_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "ANDROID_INGEST_TOKEN não configurado" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const p = req.nextUrl.searchParams;
  const instance = p.get("instance");
  if (!instance) {
    return NextResponse.json({ error: "instance é obrigatório" }, { status: 400 });
  }
  const dias = Math.min(Number(p.get("dias")) || 7, 3650);
  const limite = Math.min(Number(p.get("limite")) || 200, 500);
  const tipos = (p.get("tipos") ?? "image,document,audio,sticker")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const desde = new Date(Date.now() - dias * 86400_000).toISOString();

  const { data, error } = await supabaseAdmin()
    .from("zap_messages")
    .select("message_id,type,raw,msg_timestamp")
    .eq("instance", instance)
    .in("type", tipos)
    .gte("msg_timestamp", desde)
    // sem media_path não há o que buscar no aparelho
    .not("raw->>media_path", "is", null)
    // já no bucket não precisa subir de novo
    .is("raw->>media_stored", null)
    .order("msg_timestamp", { ascending: false })
    .limit(limite);

  if (error) {
    console.error("ingest/media/pendentes:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (data ?? []).map((r) => ({
    message_id: r.message_id,
    type: r.type,
    media_path: (r.raw as any)?.media_path ?? null,
  }));
  return NextResponse.json({ items });
}
