import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function GET() {
  const checks = {
    env: {
      evolutionUrl: !!process.env.EVOLUTION_URL,
      evolutionInstance: !!process.env.EVOLUTION_INSTANCE,
      evolutionApikey: !!process.env.EVOLUTION_APIKEY,
      supabaseUrl: !!process.env.SUPABASE_URL,
      supabaseKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      webhookForwardUrl: !!process.env.WEBHOOK_FORWARD_URL,
    },
    database: { ok: false, error: null as string | null },
    evolution: { ok: false, error: null as string | null },
  };

  try {
    const db = supabaseAdmin();
    const { count, error } = await db.from("zap_messages").select("*", { count: "exact", head: true });
    checks.database.ok = !error;
    if (error) checks.database.error = error.message;
  } catch (e: any) {
    checks.database.error = e?.message;
  }

  if (process.env.EVOLUTION_URL && process.env.EVOLUTION_APIKEY && process.env.EVOLUTION_INSTANCE) {
    try {
      const res = await fetch(`${process.env.EVOLUTION_URL}/instance/info/${process.env.EVOLUTION_INSTANCE}`, {
        method: "GET",
        headers: { apikey: process.env.EVOLUTION_APIKEY },
      });
      checks.evolution.ok = res.ok;
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        checks.evolution.error = json?.message || `HTTP ${res.status}`;
      }
    } catch (e: any) {
      checks.evolution.error = e?.message;
    }
  }

  return NextResponse.json({
    ok: checks.database.ok && (checks.evolution.ok || !process.env.EVOLUTION_URL),
    checks,
    tips: {
      noEvolutionUrl: !process.env.EVOLUTION_URL ? "Configure EVOLUTION_URL no .env.local ou variáveis de ambiente" : null,
      noEvolutionInstance: !process.env.EVOLUTION_INSTANCE ? "Configure EVOLUTION_INSTANCE no .env.local" : null,
      noEvolutionApikey: !process.env.EVOLUTION_APIKEY ? "Configure EVOLUTION_APIKEY no .env.local" : null,
      evolutionUnreachable: checks.evolution.error ? `Servidor Evolution não responde: ${checks.evolution.error}` : null,
      databaseDown: checks.database.error ? `Banco de dados indisponível: ${checks.database.error}` : null,
    },
  });
}
