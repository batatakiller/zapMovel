"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useSession } from "@/hooks/useSession";
import { usePush } from "@/hooks/usePush";
import { useAccounts } from "@/hooks/useAccounts";
import { jidToPhone, isGroup } from "@/lib/normalize";
import type { ZapMessage, Chat, Account } from "@/lib/types";

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

// Chaveia por (conta + contato): o mesmo número pode existir em duas contas suas.
function buildChats(messages: ZapMessage[]): Chat[] {
  const byKey = new Map<string, Chat>();
  for (const m of messages) {
    const key = `${m.instance}|${m.remote_jid}`;
    const existing = byKey.get(key);
    const isUnread = !m.from_me && m.status !== "read";
    if (!existing) {
      byKey.set(key, {
        instance: m.instance,
        jid: m.remote_jid,
        name: (!m.from_me && m.push_name) || jidToPhone(m.remote_jid),
        last: m,
        unread: isUnread ? 1 : 0,
      });
    } else {
      if (new Date(m.msg_timestamp) > new Date(existing.last.msg_timestamp)) existing.last = m;
      if (!m.from_me && m.push_name && /^[\d]/.test(existing.name)) existing.name = m.push_name;
      if (isUnread) existing.unread++;
    }
  }
  return [...byKey.values()].sort(
    (a, b) => new Date(b.last.msg_timestamp).getTime() - new Date(a.last.msg_timestamp).getTime()
  );
}

function chatHref(c: Chat): string {
  return `/chat/${encodeURIComponent(c.instance)}/${encodeURIComponent(c.jid)}`;
}

// pontinho colorido da conta (só aparece quando há mais de uma)
function AccountDot({ acc }: { acc?: Account }) {
  if (!acc) return null;
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: acc.color }}
      title={acc.label}
    />
  );
}

type SearchResults = { chats: Chat[]; hits: ZapMessage[] };

// Lista de conversas. No mobile ocupa a tela inteira (rota "/"); no desktop
// fica fixa como coluna da esquerda dentro do ResponsiveShell — em ambos os
// casos é a mesma instância montada uma única vez (sem consultas duplicadas).
export default function ChatList() {
  const ready = useSession();
  const { accounts, byInstance } = useAccounts();
  const [messages, setMessages] = useState<ZapMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [filter, setFilter] = useState<string>("all"); // 'all' ou uma instance
  const push = usePush();

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser()
      .from("zap_messages")
      .select("id,instance,remote_jid,message_id,from_me,push_name,type,content,status,msg_timestamp")
      .order("msg_timestamp", { ascending: false })
      .limit(1200);
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
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 5000);
    return () => {
      clearInterval(timer);
      supabaseBrowser().removeChannel(channel);
    };
  }, [ready, load]);

  // busca por nome, telefone ou conteúdo no histórico inteiro
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
      let rows = (data ?? []) as ZapMessage[];
      if (filter !== "all") rows = rows.filter((m) => m.instance === filter);
      const lower = safe.toLowerCase();
      const byContact = rows.filter(
        (m) => m.push_name?.toLowerCase().includes(lower) || m.remote_jid.includes(safe)
      );
      const hits = rows.filter((m) => m.content?.toLowerCase().includes(lower)).slice(0, 30);
      setResults({ chats: buildChats(byContact), hits });
    }, 300);
    return () => clearTimeout(t);
  }, [query, filter]);

  const visibleMessages = useMemo(
    () => (filter === "all" ? messages : messages.filter((m) => m.instance === filter)),
    [messages, filter]
  );
  const chats = useMemo(() => buildChats(visibleMessages), [visibleMessages]);
  const multiAccount = accounts.length > 1;

  if (!ready) return null;

  return (
    <div className="flex h-full w-full flex-col" style={{ background: "var(--wa-panel)" }}>
      <header
        className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 text-white"
        style={{ background: "var(--wa-header)", paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <h1 className="text-xl font-semibold">ZapMóvel</h1>
        <div className="flex items-center gap-4">
          <Link href="/accounts" className="text-lg" title="Contas de WhatsApp">
            👤
          </Link>
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

      {/* Filtro por conta (só quando há mais de uma) */}
      {multiAccount && (
        <div className="flex gap-2 overflow-x-auto px-3 pb-2" style={{ background: "var(--wa-panel)" }}>
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="Todas" />
          {accounts.map((a) => (
            <FilterChip
              key={a.instance}
              active={filter === a.instance}
              onClick={() => setFilter(a.instance)}
              label={a.label}
              color={a.color}
            />
          ))}
        </div>
      )}

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
              <li key={`${c.instance}|${c.jid}`}>
                <Link href={chatHref(c)} className="flex items-center gap-3 px-4 py-2.5">
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-semibold text-white"
                    style={{ background: byInstance.get(c.instance)?.color ?? "var(--wa-header)" }}
                  >
                    {c.name[0]?.toUpperCase() ?? "#"}
                  </div>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate font-medium">
                      {multiAccount && <AccountDot acc={byInstance.get(c.instance)} />}
                      {c.name}
                    </p>
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
                <Link
                  href={`/chat/${encodeURIComponent(m.instance)}/${encodeURIComponent(m.remote_jid)}`}
                  className="block px-4 py-2.5"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {multiAccount && <AccountDot acc={byInstance.get(m.instance)} />}
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
          <Link href="/accounts" className="mt-2 rounded-full px-4 py-2 text-sm text-white" style={{ background: "var(--wa-accent)" }}>
            Adicionar um WhatsApp
          </Link>
        </div>
      )}

      <ul
        className="flex-1 divide-y overflow-y-auto"
        hidden={!!results}
        style={{ borderColor: "color-mix(in srgb, var(--wa-text) 8%, transparent)" }}
      >
        {chats.map((c) => (
          <li key={`${c.instance}|${c.jid}`}>
            <Link href={chatHref(c)} className="flex items-center gap-3 px-4 py-3">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white"
                style={{ background: byInstance.get(c.instance)?.color ?? "var(--wa-header)" }}
              >
                {isGroup(c.jid) ? "👥" : c.name.replace(/\D/g, "") === c.name ? "#" : c.name[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {multiAccount && <AccountDot acc={byInstance.get(c.instance)} />}
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
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm"
      style={{
        background: active ? "var(--wa-accent)" : "var(--wa-bg)",
        color: active ? "#fff" : "var(--wa-text)",
      }}
    >
      {color && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
      {label}
    </button>
  );
}
