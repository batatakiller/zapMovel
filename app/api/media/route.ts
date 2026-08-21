import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getEvolutionConfig } from "@/lib/accounts";
import { extFor } from "@/lib/media-cache";

const DEFAULT_INSTANCE = process.env.EVOLUTION_INSTANCE ?? "super";

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  "3gp": "video/3gpp",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  amr: "audio/amr",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  txt: "text/plain",
};

function mimeFromFileName(name: string, fallback = "image/jpeg"): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? fallback;
}

// Serve a mídia de uma mensagem.
// 1º tenta baixar do bucket chat_media (com cache HTTP imutável no navegador);
// 2º se não estiver com o nome guardado, busca no bucket pelo message_id;
// 3º se for conta Evolution, baixa da Evolution API, guarda no bucket e responde.
// GET /api/media?id=<message_id>&a=<instance>
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const acc = req.nextUrl.searchParams.get("a");
  if (!id || !/^[A-Za-z0-9_:-]+$/.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const db = supabaseAdmin();
  let query = db.from("zap_messages").select("raw,instance").eq("message_id", id);
  if (acc) query = query.eq("instance", acc);
  const { data: row } = await query.limit(1).maybeSingle();

  // 1) Se já temos o nome do arquivo guardado no bucket
  const guardado = (row?.raw as any)?.media_stored as string | undefined;
  if (guardado) {
    const { data: blob, error: dlErr } = await db.storage.from("chat_media").download(guardado);
    if (blob && !dlErr) {
      const mime = (row?.raw as any)?.mime_type || mimeFromFileName(guardado);
      const arrayBuf = await blob.arrayBuffer();
      return new NextResponse(Buffer.from(arrayBuf), {
        headers: {
          "Content-Type": mime,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  }

  // 2) Busca no bucket pelo id da mensagem (caso o arquivo já tenha sido subido sem media_stored gravado)
  const { data: files } = await db.storage
    .from("chat_media")
    .list("", { search: id, limit: 1 });

  if (files && files.length > 0 && files[0].name) {
    const fileName = files[0].name;
    const { data: blob, error: dlErr } = await db.storage.from("chat_media").download(fileName);
    if (blob && !dlErr) {
      const mime = (row?.raw as any)?.mime_type || mimeFromFileName(fileName);
      db.from("zap_messages")
        .update({ raw: { ...((row?.raw as object) ?? {}), media_stored: fileName } })
        .eq("message_id", id)
        .then(() => null);

      const arrayBuf = await blob.arrayBuffer();
      return new NextResponse(Buffer.from(arrayBuf), {
        headers: {
          "Content-Type": mime,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  }

  // 3) Fallback: Evolution API (para contas Evolution / live)
  const key = (row?.raw as any)?.key;
  const instance = row?.instance ?? acc ?? DEFAULT_INSTANCE;
  if (!key?.id) {
    return NextResponse.json({ error: "mídia não disponível para esta mensagem" }, { status: 404 });
  }

  try {
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
    const fileName = `${id}.${extFor(mimetype)}`;

    // Grava no bucket para as próximas visualizações
    await db.storage
      .from("chat_media")
      .upload(fileName, buf, { contentType: mimetype, upsert: true })
      .catch(() => null);

    db.from("zap_messages")
      .update({ raw: { ...((row?.raw as object) ?? {}), media_stored: fileName, mime_type: mimetype } })
      .eq("message_id", id)
      .then(() => null);

    return new NextResponse(buf, {
      headers: {
        "Content-Type": mimetype,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "falha ao buscar mídia" }, { status: 500 });
  }
}
