"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { QuickReply } from "@/lib/types";

// Carrega as respostas rápidas cadastradas ("/atalho" -> texto pronto).
export function useQuickReplies() {
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [loaded, setLoaded] = useState(false);
  // canal próprio por instância do hook — pode haver mais de um componente
  // montado ao mesmo tempo (lista + conversa, no layout mestre-detalhe)
  const instanceId = useId();

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser()
      .from("zap_quick_replies")
      .select("id,shortcut,message,sort_order")
      .order("sort_order", { ascending: true })
      .order("shortcut", { ascending: true });
    if (data) setReplies(data as QuickReply[]);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    const channel = supabaseBrowser()
      .channel(`quick-replies-${instanceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "zap_quick_replies" }, () => load())
      .subscribe();
    return () => {
      supabaseBrowser().removeChannel(channel);
    };
  }, [instanceId, load]);

  return { replies, loaded, reload: load };
}
