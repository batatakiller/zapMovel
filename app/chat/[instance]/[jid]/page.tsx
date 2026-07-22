"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";

// redimensiona/comprime a imagem no navegador (evita estourar o limite de 4,5MB do body)
async function compressImage(file: File): Promise<{ base64: string; mimetype: string }> {
  const bitmap = await createImageBitmap(file);
  const MAX = 1600;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  return { base64: dataUrl.split(",")[1], mimetype: "image/jpeg" };
}
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useSession } from "@/hooks/useSession";
import { useAccounts } from "@/hooks/useAccounts";
import { useQuickReplies } from "@/hooks/useQuickReplies";
import { jidToPhone } from "@/lib/normalize";
import type { ZapMessage } from "@/lib/types";

async function markAsRead(jid: string, instance: string, messages: ZapMessage[]) {
  const unreadMessages = messages.filter((m) => !m.from_me && m.status !== "read");
  if (unreadMessages.length === 0) return;
  try {
    await fetch("/api/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jid,
        instance,
        messages: unreadMessages.map((m) => ({ remoteJid: m.remote_jid, fromMe: m.from_me, id: m.message_id })),
      }),
    });
  } catch (e) {
    console.error("Erro ao marcar como lido:", e);
  }
}

function Ticks({ status }: { status: string }) {
  if (status === "pending") return <span title="enviando">🕓</span>;
  const color = status === "read" ? "var(--wa-check)" : "var(--wa-text-muted)";
  const double = status === "delivered" || status === "read";
  return (
    <span style={{ color, letterSpacing: "-0.35em" }} title={status}>
      {double ? "✓✓" : "✓"}
    </span>
  );
}

function dayLabel(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Hoje";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR");
}

export default function ChatPage({ params }: { params: Promise<{ instance: string; jid: string }> }) {
  const { instance: encInstance, jid: encoded } = use(params);
  const instance = decodeURIComponent(encInstance);
  const jid = decodeURIComponent(encoded);
  const ready = useSession();
  const { byInstance } = useAccounts();
  const { replies: quickReplies } = useQuickReplies();
  const [messages, setMessages] = useState<ZapMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const name = messages.find((m) => !m.from_me && m.push_name)?.push_name ?? jidToPhone(jid);

  const account = byInstance.get(instance);
  const readOnly = account?.kind === "archive";
  const headerColor = account?.color ?? "var(--wa-header)";

  // digitar "/atalho" filtra as respostas rápidas; o botão ⚡ mostra todas
  const slashFilter = text.startsWith("/") ? text.slice(1).toLowerCase() : null;
  const filteredReplies =
    slashFilter !== null ? quickReplies.filter((r) => r.shortcut.toLowerCase().startsWith(slashFilter)) : quickReplies;
  const showDropdown = (showPicker || slashFilter !== null) && !readOnly;

  function insertQuickReply(message: string) {
    setText(message);
    setShowPicker(false);
    textInputRef.current?.focus();
  }

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser()
      .from("zap_messages")
      .select("id,instance,remote_jid,message_id,from_me,push_name,type,content,status,msg_timestamp")
      .eq("instance", instance)
      .eq("remote_jid", jid)
      .order("msg_timestamp", { ascending: true })
      .limit(1000);
    if (data) setMessages(data as ZapMessage[]);
  }, [instance, jid]);

  useEffect(() => {
    if (!ready) return;
    load();
    const channel = supabaseBrowser()
      .channel(`chat-${instance}-${jid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "zap_messages", filter: `remote_jid=eq.${jid}` },
        (payload) => {
          const m = (payload.new ?? {}) as ZapMessage;
          if (m.instance !== instance) return; // ignora outras contas com o mesmo contato
          if (payload.eventType === "INSERT") {
            setMessages((prev) => (prev.some((p) => p.message_id === m.message_id) ? prev : [...prev, m]));
          } else if (payload.eventType === "UPDATE") {
            setMessages((prev) => prev.map((p) => (p.message_id === m.message_id ? { ...p, ...m } : p)));
          }
        }
      )
      .subscribe();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 5000);
    return () => {
      clearInterval(timer);
      supabaseBrowser().removeChannel(channel);
    };
  }, [ready, instance, jid, load]);

  useEffect(() => {
    if (messages.length > 0 && !readOnly) {
      markAsRead(jid, instance, messages);
    }
  }, [jid, instance, messages.length, readOnly]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setText("");

    const tempId = `local-${Date.now()}`;
    const optimistic: ZapMessage = {
      id: -Date.now(),
      instance,
      remote_jid: jid,
      message_id: tempId,
      from_me: true,
      push_name: null,
      type: "text",
      content: body,
      status: "pending",
      msg_timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jid, instance, text: body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setMessages((prev) =>
        prev.map((m) => (m.message_id === tempId ? { ...m, message_id: json.id ?? tempId, status: "sent" } : m))
      );
    } catch {
      setMessages((prev) => prev.map((m) => (m.message_id === tempId ? { ...m, status: "erro" } : m)));
    } finally {
      setSending(false);
    }
  }

  async function handleSendImage(file: File) {
    if (sending) return;
    setSending(true);
    const caption = text.trim();
    setText("");
    try {
      const { base64, mimetype } = await compressImage(file);
      const res = await fetch("/api/send-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jid, instance, base64, mimetype, fileName: file.name, caption }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      await load();
    } catch {
      alert("Falha ao enviar a imagem");
      setText(caption);
    } finally {
      setSending(false);
    }
  }

  if (!ready) return null;

  let lastDay = "";

  return (
    <div className="mx-auto flex h-full w-full max-w-lg flex-col md:mx-0 md:max-w-none">
      <header
        className="flex items-center gap-3 px-3 py-3 text-white"
        style={{ background: headerColor, paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <Link href="/" className="px-1 text-xl" aria-label="Voltar">
          ←
        </Link>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 font-semibold">
          {name[0]?.toUpperCase() ?? "#"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium leading-tight">{name}</p>
          <p className="truncate text-xs opacity-75">
            {jidToPhone(jid)}
            {account ? ` · ${account.label}` : ""}
          </p>
        </div>
      </header>

      <div className="chat-bg flex-1 overflow-y-auto px-3 py-2">
        {messages.map((m) => {
          const day = dayLabel(m.msg_timestamp);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.message_id}>
              {showDay && (
                <div className="my-2 flex justify-center">
                  <span
                    className="rounded-lg px-3 py-1 text-xs"
                    style={{ background: "var(--wa-panel)", color: "var(--wa-text-muted)" }}
                  >
                    {day}
                  </span>
                </div>
              )}
              <div className={`mb-1 flex ${m.from_me ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[80%] rounded-lg px-3 py-1.5 shadow-sm"
                  style={{ background: m.from_me ? "var(--wa-bubble-out)" : "var(--wa-bubble-in)" }}
                >
                  {(m.type === "image" || m.type === "sticker") && !m.message_id.startsWith("local-") && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/media?id=${encodeURIComponent(m.message_id)}&a=${encodeURIComponent(m.instance)}`}
                      alt="mídia"
                      loading="lazy"
                      className="mb-1 max-h-80 w-auto max-w-full cursor-pointer rounded-md"
                      onClick={(e) => window.open((e.target as HTMLImageElement).src, "_blank")}
                      onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                    />
                  )}
                  {m.type === "audio" && !m.message_id.startsWith("local-") && (
                    <audio
                      controls
                      preload="metadata"
                      src={`/api/media?id=${encodeURIComponent(m.message_id)}&a=${encodeURIComponent(m.instance)}`}
                      className="mb-1 h-10 max-w-full"
                      style={{ minWidth: "230px" }}
                    />
                  )}
                  <p className="whitespace-pre-wrap break-words text-[15px]">{m.content}</p>
                  <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px]" style={{ color: "var(--wa-text-muted)" }}>
                    {new Date(m.msg_timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    {m.from_me && <Ticks status={m.status} />}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {readOnly ? (
        <div
          className="p-3 text-center text-sm"
          style={{ background: "var(--wa-panel)", color: "var(--wa-text-muted)", paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          📁 Arquivo importado — somente leitura (esta conta não está conectada)
        </div>
      ) : (
        <>
          {showDropdown && (
            <div
              className="max-h-52 overflow-y-auto border-t"
              style={{ background: "var(--wa-panel)", borderColor: "color-mix(in srgb, var(--wa-text) 8%, transparent)" }}
            >
              {filteredReplies.length === 0 ? (
                <p className="px-4 py-3 text-sm" style={{ color: "var(--wa-text-muted)" }}>
                  Nenhuma resposta rápida encontrada.{" "}
                  <Link href="/quick-replies" className="underline">
                    Cadastrar uma
                  </Link>
                </p>
              ) : (
                filteredReplies.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => insertQuickReply(r.message)}
                    className="block w-full px-4 py-2 text-left"
                  >
                    <p className="font-mono text-xs font-semibold" style={{ color: "var(--wa-accent)" }}>
                      /{r.shortcut}
                    </p>
                    <p className="truncate text-sm" style={{ color: "var(--wa-text)" }}>
                      {r.message}
                    </p>
                  </button>
                ))
              )}
            </div>
          )}
          <form
            onSubmit={handleSend}
            className="flex items-center gap-2 p-2"
            style={{ background: "var(--wa-panel)", paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
          >
            <label
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-xl"
              style={{ background: "var(--wa-bg)", color: "var(--wa-text-muted)" }}
              aria-label="Anexar imagem"
              title="Enviar imagem"
            >
              📎
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={sending}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleSendImage(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => setShowPicker((v) => !v)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl"
              style={{ background: "var(--wa-bg)", color: "var(--wa-text-muted)" }}
              aria-label="Respostas rápidas"
              title="Respostas rápidas"
            >
              ⚡
            </button>
            <input
              ref={textInputRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (!e.target.value.startsWith("/")) setShowPicker(false);
              }}
              placeholder="Mensagem"
              className="flex-1 rounded-full px-4 py-2.5 outline-none"
              style={{ background: "var(--wa-bg)", color: "var(--wa-text)" }}
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              aria-label="Enviar"
              className="flex h-11 w-11 items-center justify-center rounded-full text-white disabled:opacity-50"
              style={{ background: "var(--wa-accent)" }}
            >
              ➤
            </button>
          </form>
        </>
      )}
    </div>
  );
}
