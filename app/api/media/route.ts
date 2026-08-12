import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getEvolutionConfig } from "@/lib/accounts";
import { KNOWN_MEDIA_EXTENSIONS, extFor } from "@/lib/media-cache";

const DEFAULT_INSTANCE = process.env.EVOLUTION_INSTANCE ?? "super";
const SUPABASE_URL = process.env.SUPABASE_URL!;

function bucketUrl(name: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/chat_media/${name}`;
}

// Serve a mídia de uma mensagem.
// 1º tenta o bucket chat_media (permanente — normalmente já está lá, cacheado
// no momento em que a mensagem chegou); se não existir, busca no Evolution da
// conta certa, grava no bucket e responde.
// GET /api/media?id=<message_id>&a=<instance>
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const acc = req.nextUrl.searchParams.get("a");
  // O ':' é necessário: as mensagens capturadas pela notificação usam id
  // sintético no formato 'nl:<hash>', e sem ele a foto do tablet nunca é
  // servida. Continua restrito o bastante para não montar caminho arbitrário.
  if (!id || !/^[A-Za-z0-9_:-]+$/.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const db = supabaseAdmin();
  let query = db.from("zap_messages").select("raw,instance").eq("message_id", id);
  if (acc) query = query.eq("instance", acc);
  const { data: row } = await query.limit(1).maybeSingle();

  // 1) a própria mensagem diz onde o arquivo está. Serve qualquer extensão —
  // inclusive o '.bin' de um mime que não está na tabela — e troca até 19 HEADs
  // sequenciais por nenhum.
  const guardado = (row?.raw as any)?.media_stored as string | undefined;
  if (guardado) {
    return NextResponse.redirect(bucketUrl(guardado), {
      status: 302,
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    });
  }

  // 2) mídia da era Evolution / legado: está no bucket, mas sem a marca no DB.
  // Em vez de fazer 19 HEAD requests HTTP (que geram erros 400 no Supabase),
  // buscamos o arquivo no bucket via list pelo ID da mensagem.
  const { data: files } = await db.storage
    .from("chat_media")
    .list("", { search: id, limit: 1 });

  if (files && files.length > 0 && files[0].name) {
    const fileName = files[0].name;
    // Marca na mensagem para evitar chamadas à storage em futuras requisições
    db.from("zap_messages")
      .update({ raw: { ...((row?.raw as object) ?? {}), media_stored: fileName } })
      .eq("message_id", id)
      .then(() => null);

    return NextResponse.redirect(bucketUrl(fileName), {
      status: 302,
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    });
  }

  // 3) fallback: Evolution da conta dona da mensagem (o message_id é único no WhatsApp)
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
