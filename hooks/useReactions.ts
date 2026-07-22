"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { Reaction } from "@/lib/types";

// Reações de uma conversa, agrupadas por mensagem alvo. Reação com emoji
// vazio/null significa removida — já é filtrada aqui.
export function useReactions(instance: string, jid: string) {
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const instanceId = useId();

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser()
      .from("zap_reactions")
      .select("id,instance,remote_jid,target_message_id,reactor_jid,from_me,emoji,msg_timestamp")
      .eq("instance", instance)
      .eq("remote_jid", jid);
    if (data) setReactions(data as Reaction[]);
  }, [instance, jid]);

  useEffect(() => {
    load();
    const channel = supabaseBrowser()
      .channel(`reactions-${instanceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "zap_reactions", filter: `remote_jid=eq.${jid}` },
        (payload) => {
          const r = (payload.new ?? payload.old) as Reaction | undefined;
          if (r && r.instance !== instance) return;
          load();
        }
      )
      .subscribe();
    return () => {
      supabaseBrowser().removeChannel(channel);
    };
  }, [instanceId, instance, jid, load]);

  const byMessage = useMemo(() => {
    const map = new Map<string, Reaction[]>();
    for (const r of reactions) {
      if (!r.emoji) continue; // removida
      const list = map.get(r.target_message_id) ?? [];
      list.push(r);
      map.set(r.target_message_id, list);
    }
    return map;
  }, [reactions]);

  return { byMessage, reload: load };
}
