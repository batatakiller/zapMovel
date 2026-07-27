"use client";

import { useEffect, useId, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { Account } from "@/lib/types";

// Carrega as contas cadastradas (para etiquetas/cores na caixa unificada).
// Lê direto de zap_accounts (RLS: leitura para usuário logado).
export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loaded, setLoaded] = useState(false);
  // no layout mestre-detalhe, a lista e a conversa ficam montadas ao mesmo
  // tempo (desktop) — cada instância deste hook precisa de um canal próprio,
  // senão a segunda .subscribe() no mesmo nome derruba a conexão.
  const instanceId = useId();

  useEffect(() => {
    let alive = true;
    async function load() {
      const { data } = await supabaseBrowser()
        .from("zap_accounts")
        .select("instance,label,color,phone,kind,transport,enabled,is_default,sort_order")
        .order("sort_order", { ascending: true });
      // conta desativada some do painel; as mensagens dela continuam no banco
      if (alive && data) setAccounts((data as Account[]).filter((a) => a.enabled !== false));
      if (alive) setLoaded(true);
    }
    load();
    const channel = supabaseBrowser()
      .channel(`accounts-${instanceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "zap_accounts" }, () => load())
      .subscribe();
    return () => {
      alive = false;
      supabaseBrowser().removeChannel(channel);
    };
  }, [instanceId]);

  const byInstance = new Map(accounts.map((a) => [a.instance, a]));
  const padrao = accounts.find((a) => a.is_default)?.instance ?? null;
  return { accounts, byInstance, loaded, padrao };
}
