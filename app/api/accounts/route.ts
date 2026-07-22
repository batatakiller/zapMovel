import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { listAccounts, setEvolutionConfig } from "@/lib/accounts";
import { createInstance } from "@/lib/evolution";

// GET /api/accounts — lista todas as contas cadastradas.
export async function GET() {
  const accounts = await listAccounts();
  return NextResponse.json({ accounts });
}

// POST /api/accounts — cria uma nova conta AO VIVO: cria a instância no
// Evolution e cadastra em zap_accounts. Body: { instance, label, color?, phone?,
// evolutionUrl?, evolutionApikey? }. Sem evolutionUrl/evolutionApikey, usa o
// servidor Evolution padrão do .env — só preencha se este número mora em OUTRO
// servidor Evolution.
// Depois use GET /api/accounts/<instance>/qr para escanear o QR e parear.
export async function POST(req: NextRequest) {
  const { instance, label, color, phone, evolutionUrl, evolutionApikey } = await req.json().catch(() => ({}));
  const name = String(instance ?? "").trim().toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(name)) {
    return NextResponse.json(
      { error: "instance inválido: use letras minúsculas, números e hífen (2 a 31 caracteres)" },
      { status: 400 }
    );
  }
  if (!label?.trim()) {
    return NextResponse.json({ error: "label (nome da conta) é obrigatório" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: existing } = await db.from("zap_accounts").select("instance").eq("instance", name).maybeSingle();
  if (existing) {
    return NextResponse.json({ error: `já existe uma conta chamada '${name}'` }, { status: 409 });
  }

  // Resolve o servidor Evolution: o informado no formulário, ou o padrão do .env
  // (a conta ainda não existe, então não há configuração própria salva ainda).
  const cfg = {
    url: evolutionUrl?.trim() || process.env.EVOLUTION_URL || "",
    apikey: evolutionApikey?.trim() || process.env.EVOLUTION_APIKEY || "",
  };
  if (!cfg.url || !cfg.apikey) {
    return NextResponse.json(
      { error: "informe o servidor Evolution (URL + apikey) — nenhum padrão configurado no .env" },
      { status: 400 }
    );
  }

  // Cria a instância no Evolution (idempotente: se já existir lá, seguimos em frente).
  let created: any = null;
  try {
    created = await createInstance(cfg, name);
  } catch (e: any) {
    if (!/already in use|already exists/i.test(e?.message ?? "")) {
      return NextResponse.json({ error: `falha ao criar instância no Evolution: ${e?.message}` }, { status: 502 });
    }
  }

  const { error } = await db.from("zap_accounts").insert({
    instance: name,
    label: label.trim(),
    color: color?.trim() || "#008069",
    phone: phone?.trim() || null,
    kind: "live",
    sort_order: 100,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Só grava configuração própria se o usuário realmente informou um servidor diferente.
  if (evolutionUrl?.trim() || evolutionApikey?.trim()) {
    await setEvolutionConfig(name, evolutionUrl, evolutionApikey).catch((e) =>
      console.error("setEvolutionConfig:", e?.message)
    );
  }

  const qr = created?.qrcode?.base64 ?? created?.qrcode?.code ?? null;
  return NextResponse.json({ ok: true, instance: name, qr });
}

// DELETE /api/accounts — remove uma conta do cadastro (não apaga as mensagens
// já importadas). Body: { instance }.
export async function DELETE(req: NextRequest) {
  const { instance } = await req.json().catch(() => ({}));
  if (!instance) return NextResponse.json({ error: "instance obrigatório" }, { status: 400 });
  await supabaseAdmin().from("zap_accounts").delete().eq("instance", instance);
  return NextResponse.json({ ok: true });
}
