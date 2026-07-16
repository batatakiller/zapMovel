"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useSession } from "@/hooks/useSession";
import { usePush } from "@/hooks/usePush";
import { jidToPhone, isGroup } from "@/lib/normalize";
import type { ZapMessage, Chat } from "@/lib/types";

function formatTime(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function buildChats(messages: ZapMessage[]): Chat[] {
  const byJid = new Map<string, Chat>();
  for (const m of messages) {
    const existing = byJid.get(m.remote_jid);
    if (!existing) {
      byJid.set(m.remote_jid, {
        jid: m.remote_jid,
        name: (!m.from_me && m.push_name) || jidToPhone(m.remote_jid),
        last: m,
        unread: !m.from_me ? 1 : 0,
      });
    } else {
      if (new Date(m.msg_timestamp) > new Date(existing.last.msg_timestamp)) existing.last = m;
      if (!m.from_me && m.push_name && /^[\d]/.test(existing.name)) existing.name = m.push_name;
      if (!m.from_me) existing.unread++;
    }
  }
  return [...byJid.values()].sort(
    (a, b) => new Date(b.last.msg_timestamp).getTime() - new Date(a.last.msg_timestamp).getTime()
  );
}

type SearchResults = { chats: Chat[]; hits: ZapMessage[] };

export default function ChatListPage() {
  const ready = useSession();
  const [messages, setMessages] = useState<ZapMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const push = usePush();

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser()
      .from("zap_messages")
      .select("id,instance,remote_jid,message_id,from_me,push_name,type,content,status,msg_timestamp")
      .order("msg_timestamp", { ascending: false })
      .limit(800);
    if (!error && data) setMessages(data as ZapMessage[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!ready) return;
    load();
    const channel = supabaseBrowser()
      .channel("chat-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "zap_messages" }, () => load())
      .subscribe();
    // fallback: enquanto o realtime não estiver habilitado na tabela, sincroniza a cada 5s
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 5000);
    return () => {
      clearInterval(timer);
      supabaseBrowser().removeChannel(channel);
    };
  }, [ready, load]);

  // busca por nome, telefone ou conteúdo (nº de pedido, chave etc.) no histórico inteiro
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    const t = setTimeout(async () => {
      const safe = q.replace(/[%,()]/g, " ").trim();
      const { data } = await supabaseBrowser()
        .from("zap_messages")
        .select("id,instance,remote_jid,message_id,from_me,push_name,type,content,status,msg_timestamp")
        .or(`push_name.ilike.%${safe}%,remote_jid.ilike.%${safe}%,content.ilike.%${safe}%`)
        .order("msg_timestamp", { ascending: false })
        .limit(300);
      const rows = (data ?? []) as ZapMessage[];
      const lower = safe.toLowerCase();
      const byContact = rows.filter(
        (m) => m.push_name?.toLowerCase().includes(lower) || m.remote_jid.includes(safe)
      );
      const hits = rows.filter((m) => m.content?.toLowerCase().includes(lower)).slice(0, 30);
      setResults({ chats: buildChats(byContact), hits });
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const chats = useMemo(() => buildChats(messages), [messages]);

  if (!ready) return null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col" style={{ background: "var(--wa-panel)" }}>
      <header
        className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 text-white"
        style={{ background: "var(--wa-header)", paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <h1 className="text-xl font-semibold">ZapMóvel</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={() => (push.state === "enabled" ? push.disable() : push.enable())}
            className="text-lg"
            title={
              push.state === "enabled"
                ? "Notificações ativas — tocar para desativar"
                : push.state === "denied"
                  ? "Notificações bloqueadas nas configurações do navegador"
                  : "Ativar notificações neste dispositivo"
            }
          >
            {push.state === "enabled" ? "🔔" : "🔕"}
          </button>
          <button
            onClick={() => supabaseBrowser().auth.signOut()}
            className="text-sm opacity-80"
            title="Sair"
          >
            sair
          </button>
        </div>
      </header>

      <div className="px-3 py-2" style={{ background: "var(--wa-panel)" }}>
        <div
          className="flex items-center gap-2 rounded-full px-4 py-2"
          style={{ background: "var(--wa-bg)" }}
        >
          <span style={{ color: "var(--wa-text-muted)" }}>🔍</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pesquisar nome, telefone ou pedido"
            className="w-full bg-transparent text-[15px] outline-none"
            style={{ color: "var(--wa-text)" }}
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Limpar" style={{ color: "var(--wa-text-muted)" }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {loading && (
        <p className="p-6 text-center text-sm" style={{ color: "var(--wa-text-muted)" }}>
          Carregando conversas...
        </p>
      )}

      {results && (
        <div className="flex-1 overflow-y-auto">
          <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase" style={{ color: "var(--wa-text-muted)" }}>
            Conversas
          </p>
          {results.chats.length === 0 && (
            <p className="px-4 py-1 text-sm" style={{ color: "var(--wa-text-muted)" }}>
              Nenhum contato encontrado
            </p>
          )}
          <ul>
            {results.chats.map((c) => (
              <li key={c.jid}>
                <Link href={`/chat/${encodeURIComponent(c.jid)}`} className="flex items-center gap-3 px-4 py-2.5">
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-semibold text-white"
                    style={{ background: "var(--wa-header)" }}
                  >
                    {c.name[0]?.toUpperCase() ?? "#"}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="truncate text-sm" style={{ color: "var(--wa-text-muted)" }}>
                      {jidToPhone(c.jid)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase" style={{ color: "var(--wa-text-muted)" }}>
            Mensagens
          </p>
          {results.hits.length === 0 && (
            <p className="px-4 py-1 text-sm" style={{ color: "var(--wa-text-muted)" }}>
              Nenhuma mensagem encontrada
            </p>
          )}
          <ul className="pb-4">
            {results.hits.map((m) => (
              <li key={m.id}>
                <Link href={`/chat/${encodeURIComponent(m.remote_jid)}`} className="block px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium">
                      {(!m.from_me && m.push_name) || jidToPhone(m.remote_jid)}
                    </p>
                    <span className="shrink-0 text-xs" style={{ color: "var(--wa-text-muted)" }}>
                      {formatTime(m.msg_timestamp)}
                    </span>
                  </div>
                  <p className="truncate text-sm" style={{ color: "var(--wa-text-muted)" }}>
                    {m.from_me ? "Você: " : ""}
                    {m.content}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!results && !loading && chats.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-lg">Nenhuma conversa ainda</p>
          <p className="text-sm" style={{ color: "var(--wa-text-muted)" }}>
            Quando chegar uma mensagem no WhatsApp ela aparece aqui em tempo real.
          </p>
        </div>
      )}

      <ul
        className="flex-1 divide-y"
        hidden={!!results}
        style={{ borderColor: "color-mix(in srgb, var(--wa-text) 8%, transparent)" }}
      >
        {chats.map((c) => (
          <li key={c.jid}>
            <Link href={`/chat/${encodeURIComponent(c.jid)}`} className="flex items-center gap-3 px-4 py-3">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white"
                style={{ background: "var(--wa-header)" }}
              >
                {isGroup(c.jid) ? "👥" : c.name.replace(/\D/g, "") === c.name ? "#" : c.name[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className={`truncate font-medium ${c.unread > 0 ? "font-bold" : ""}`}>{c.name}</p>
                    {c.unread > 0 && (
                      <span
                        className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold text-white"
                        style={{ background: "var(--wa-accent)" }}
                      >
                        {c.unread > 99 ? "99+" : c.unread}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-xs" style={{ color: "var(--wa-text-muted)" }}>
                    {formatTime(c.last.msg_timestamp)}
                  </span>
                </div>
                <p className={`truncate text-sm ${c.unread > 0 ? "font-semibold" : ""}`} style={{ color: "var(--wa-text-muted)" }}>
                  {c.last.from_me ? "Você: " : ""}
                  {c.last.content ?? `[${c.last.type}]`}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
