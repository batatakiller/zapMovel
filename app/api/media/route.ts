import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getEvolutionConfig } from "@/lib/accounts";

const DEFAULT_INSTANCE = process.env.EVOLUTION_INSTANCE ?? "super";
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
// se não existir, busca no Evolution da conta certa, grava no bucket e responde.
// GET /api/media?id=<message_id>&a=<instance>
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const acc = req.nextUrl.searchParams.get("a");
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  // 1) bucket primeiro (jpg é o mais comum, depois os outros formatos)
  for (const ext of ["jpg", "png", "webp", "mp4", "ogg", "mp3"]) {
    const head = await fetch(bucketUrl(`${id}.${ext}`), { method: "HEAD", cache: "no-store" });
    if (head.ok) return NextResponse.redirect(bucketUrl(`${id}.${ext}`), 302);
  }

  // 2) fallback: Evolution da conta dona da mensagem (o message_id é único no WhatsApp)
  const db = supabaseAdmin();
  let query = db.from("zap_messages").select("raw,instance").eq("message_id", id);
  if (acc) query = query.eq("instance", acc);
  const { data: row } = await query.limit(1).maybeSingle();

  const key = (row?.raw as any)?.key;
  const instance = row?.instance ?? acc ?? DEFAULT_INSTANCE;
  // sem raw.key não dá para pedir ao Evolution (ex.: mensagem importada de backup)
  if (!key?.id) return NextResponse.json({ error: "mídia não disponível para esta mensagem" }, { status: 404 });

  const cfg = await getEvolutionConfig(instance);
  const res = await fetch(`${cfg.url}/chat/getBase64FromMediaMessage/${instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: cfg.apikey },
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
