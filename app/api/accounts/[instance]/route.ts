import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { setEvolutionConfig, clearEvolutionConfig } from "@/lib/accounts";

// PATCH /api/accounts/<instance> — edita uma conta já cadastrada.
// Body: { label?, color?, phone?, enabled?, isDefault?, evolutionUrl?, evolutionApikey?, resetEvolution? }
// - enabled: false esconde a conta do painel (não apaga nada).
// - isDefault: true faz o painel abrir já filtrado nesta conta.
// - evolutionUrl/evolutionApikey: define um servidor Evolution próprio para esta conta.
// - resetEvolution: true remove a config própria (volta a usar o padrão do .env).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ instance: string }> }) {
  const { instance } = await params;
  const { label, color, phone, enabled, isDefault, evolutionUrl, evolutionApikey, resetEvolution } =
    await req.json().catch(() => ({}));

  const db = supabaseAdmin();
  const patch: Record<string, unknown> = {};
  if (label?.trim()) patch.label = label.trim();
  if (color?.trim()) patch.color = color.trim();
  if (phone !== undefined) patch.phone = phone?.trim() || null;
  if (typeof enabled === "boolean") patch.enabled = enabled;

  if (isDefault === true) {
    // Só uma conta pode ser padrão, e há índice único garantindo isso — então
    // é preciso limpar a anterior ANTES de marcar a nova, senão o banco recusa.
    const { error } = await db
      .from("zap_accounts")
      .update({ is_default: false })
      .eq("is_default", true)
      .neq("instance", instance);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    patch.is_default = true;
  } else if (isDefault === false) {
    patch.is_default = false;
  }

  // Esconder a conta padrão deixaria o painel abrindo num filtro invisível.
  if (patch.enabled === false) patch.is_default = false;

  if (Object.keys(patch).length) {
    const { error } = await db.from("zap_accounts").update(patch).eq("instance", instance);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    if (resetEvolution) {
      await clearEvolutionConfig(instance);
    } else if (evolutionUrl?.trim() || evolutionApikey?.trim()) {
      await setEvolutionConfig(instance, evolutionUrl, evolutionApikey);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "falha ao salvar servidor Evolution" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
