import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// Registra/remove a inscrição de push deste dispositivo
export async function POST(req: NextRequest) {
  const { subscription } = await req.json().catch(() => ({}));
  if (!subscription?.endpoint || !subscription?.keys) {
    return NextResponse.json({ error: "subscription inválida" }, { status: 400 });
  }
  const db = supabaseAdmin();
  const { error } = await db
    .from("push_subscriptions")
    .upsert({ endpoint: subscription.endpoint, subscription }, { onConflict: "endpoint" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { endpoint } = await req.json().catch(() => ({}));
  if (!endpoint) return NextResponse.json({ error: "endpoint obrigatório" }, { status: 400 });
  await supabaseAdmin().from("push_subscriptions").delete().eq("endpoint", endpoint);
  return NextResponse.json({ ok: true });
}
