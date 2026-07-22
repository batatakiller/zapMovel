"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { Account } from "@/lib/types";

// Carrega as contas cadastradas (para etiquetas/cores na caixa unificada).
// Lê direto de zap_accounts (RLS: leitura para usuário logado).
export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      const { data } = await supabaseBrowser()
        .from("zap_accounts")
        .select("instance,label,color,phone,kind,sort_order")
        .order("sort_order", { ascending: true });
      if (alive && data) setAccounts(data as Account[]);
      if (alive) setLoaded(true);
    }
    load();
    const channel = supabaseBrowser()
      .channel("accounts")
      .on("postgres_changes", { event: "*", schema: "public", table: "zap_accounts" }, () => load())
      .subscribe();
    return () => {
      alive = false;
      supabaseBrowser().removeChannel(channel);
    };
  }, []);

  const byInstance = new Map(accounts.map((a) => [a.instance, a]));
  return { accounts, byInstance, loaded };
}
