"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    const url =
      typeof window === "undefined"
        ? process.env.NEXT_PUBLIC_SUPABASE_URL!
        : `${window.location.origin}/db`;

    client = createClient(
      url,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}

export function anonKeyConfigured(): boolean {
  const k = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return !!k && k !== "COLE_A_ANON_KEY_AQUI";
}
