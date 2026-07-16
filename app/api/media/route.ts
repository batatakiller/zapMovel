import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

const BASE = process.env.EVOLUTION_URL!;
const INSTANCE = process.env.EVOLUTION_INSTANCE!;
const APIKEY = process.env.EVOLUTION_APIKEY!;
const SUPABASE_URL = process.env.SUPABASE_URL!;

// mesmo padrão de nome usado pelo bot do n8n: chat_media/<message_id>.<ext>
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
};
const extFor = (mime: string) => EXT[mime?.split(";")[0]] ?? (mime?.includes("video") ? "mp4" : "jpg");

function bucketUrl(name: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/chat_media/${name}`;
}

// Serve a mídia de uma mensagem.
// 1º tenta o bucket chat_media (permanente, compartilhado com o bot);
// se não existir, busca no Evolution, grava no bucket e responde.
// GET /api/media?id=<message_id>
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  // 1) bucket primeiro (jpg é o mais comum, depois os outros formatos)
  for (const ext of ["jpg", "png", "webp", "mp4", "ogg", "mp3"]) {
    const head = await fetch(bucketUrl(`${id}.${ext}`), { method: "HEAD", cache: "no-store" });
    if (head.ok) return NextResponse.redirect(bucketUrl(`${id}.${ext}`), 302);
  }

  // 2) fallback: Evolution
  const db = supabaseAdmin();
  const { data: row } = await db
    .from("zap_messages")
    .select("raw")
    .eq("instance", INSTANCE)
    .eq("message_id", id)
    .single();

  const key = (row?.raw as any)?.key;
  if (!key?.id) return NextResponse.json({ error: "mensagem não encontrada" }, { status: 404 });

  const res = await fetch(`${BASE}/chat/getBase64FromMediaMessage/${INSTANCE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: APIKEY },
    body: JSON.stringify({ message: { key }, convertToMp4: false }),
    cache: "no-store",
  });
  if (!res.ok) return NextResponse.json({ error: `mídia indisponível (${res.status})` }, { status: 502 });

  const json = await res.json();
  if (!json?.base64) return NextResponse.json({ error: "sem conteúdo" }, { status: 404 });

  const mimetype: string = json?.mimetype ?? "image/jpeg";
  const buf = Buffer.from(json.base64, "base64");

  // 3) grava no bucket para as próximas visualizações (e para o bot)
  await db.storage
    .from("chat_media")
    .upload(`${id}.${extFor(mimetype)}`, buf, { contentType: mimetype, upsert: true })
    .catch(() => null);

  return new NextResponse(buf, {
    headers: {
      "Content-Type": mimetype,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
