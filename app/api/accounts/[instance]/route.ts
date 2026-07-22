import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { setEvolutionConfig, clearEvolutionConfig } from "@/lib/accounts";

// PATCH /api/accounts/<instance> — edita uma conta já cadastrada.
// Body: { label?, color?, phone?, evolutionUrl?, evolutionApikey?, resetEvolution? }
// - evolutionUrl/evolutionApikey: define um servidor Evolution próprio para esta conta.
// - resetEvolution: true remove a config própria (volta a usar o padrão do .env).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ instance: string }> }) {
  const { instance } = await params;
  const { label, color, phone, evolutionUrl, evolutionApikey, resetEvolution } = await req.json().catch(() => ({}));

  const patch: Record<string, unknown> = {};
  if (label?.trim()) patch.label = label.trim();
  if (color?.trim()) patch.color = color.trim();
  if (phone !== undefined) patch.phone = phone?.trim() || null;

  if (Object.keys(patch).length) {
    const { error } = await supabaseAdmin().from("zap_accounts").update(patch).eq("instance", instance);
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
