import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// Recebe o arquivo que o agente leu da URI da própria notificação e o guarda no
// bucket chat_media, com o mesmo nome que /api/media espera (<message_id>.<ext>).
//
// O corpo é o binário puro, não JSON em base64: base64 infla 33% e o limite de
// corpo da Vercel é o gargalo aqui.
export const maxDuration = 60;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "application/pdf": "pdf",
};

// Vídeo é o que estoura cota: no histórico deste aparelho foram 6,67 GB em
// apenas 1.285 arquivos. O limite protege o Storage de um único arquivo grande.
const LIMITE_BYTES = 12 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const token = process.env.ANDROID_INGEST_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "ANDROID_INGEST_TOKEN não configurado" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const messageId = req.headers.get("x-message-id");
  const instance = req.headers.get("x-instance");
  const mime = (req.headers.get("content-type") ?? "application/octet-stream").split(";")[0];
  if (!messageId || !instance) {
    return NextResponse.json({ error: "x-message-id e x-instance são obrigatórios" }, { status: 400 });
  }

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) {
    return NextResponse.json({ error: "corpo vazio" }, { status: 400 });
  }
  if (buf.length > LIMITE_BYTES) {
    return NextResponse.json(
      { error: `arquivo de ${(buf.length / 1e6).toFixed(1)} MB acima do limite` },
      { status: 413 }
    );
  }

  const db = supabaseAdmin();

  // A mensagem precisa existir ANTES de guardarmos o arquivo. Sem esta
  // checagem, uma mídia cuja mensagem foi descartada na ingestão (por já
  // constar no banco, por exemplo) deixaria um arquivo órfão no bucket,
  // consumindo cota sem nunca ser exibido.
  const { data: atual } = await db
    .from("zap_messages")
    .select("raw")
    .eq("instance", instance)
    .eq("message_id", messageId)
    .maybeSingle();
  if (!atual) {
    return NextResponse.json(
      { error: "mensagem não encontrada — arquivo descartado" },
      { status: 404 }
    );
  }

  const ext = EXT[mime] ?? "bin";
  const caminho = `${messageId}.${ext}`;

  const { error: erroUpload } = await db.storage
    .from("chat_media")
    .upload(caminho, buf, { contentType: mime, upsert: true });
  if (erroUpload) {
    console.error("upload chat_media:", erroUpload.message);
    return NextResponse.json({ error: erroUpload.message }, { status: 500 });
  }

  // Marca na mensagem que a mídia já está no bucket — é o que faz a bolha
  // deixar de ser um rótulo "📷 Foto" e virar a imagem de verdade.
  await db
    .from("zap_messages")
    .update({ raw: { ...((atual?.raw as object) ?? {}), media_stored: caminho, mime_type: mime } })
    .eq("instance", instance)
    .eq("message_id", messageId);

  return NextResponse.json({ ok: true, path: caminho, bytes: buf.length });
}
