"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "@/hooks/useSession";
import { useQuickReplies } from "@/hooks/useQuickReplies";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { QuickReply } from "@/lib/types";

function normalizeShortcut(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^\/+/, "") // remove "/" se a pessoa digitar
    .replace(/\s+/g, "-");
}

export default function QuickRepliesPage() {
  const ready = useSession();
  const { replies, loaded, reload } = useQuickReplies();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<QuickReply | null>(null);
  const [shortcut, setShortcut] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setShortcut("");
    setMessage("");
    setError(null);
    setShowForm(true);
  }

  function openEdit(r: QuickReply) {
    setEditing(r);
    setShortcut(r.shortcut);
    setMessage(r.message);
    setError(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanShortcut = normalizeShortcut(shortcut);
    if (!cleanShortcut) {
      setError("Dê um atalho (ex.: horario).");
      return;
    }
    if (!message.trim()) {
      setError("Escreva o texto da resposta.");
      return;
    }
    setSaving(true);
    try {
      const db = supabaseBrowser();
      if (editing) {
        const { error } = await db
          .from("zap_quick_replies")
          .update({ shortcut: cleanShortcut, message: message.trim() })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await db
          .from("zap_quick_replies")
          .insert({ shortcut: cleanShortcut, message: message.trim() });
        if (error) throw error;
      }
      closeForm();
      reload();
    } catch (e: any) {
      setError(e?.code === "23505" ? `já existe uma resposta rápida "/${cleanShortcut}"` : e?.message ?? "falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(r: QuickReply) {
    if (!confirm(`Excluir a resposta rápida "/${r.shortcut}"?`)) return;
    await supabaseBrowser().from("zap_quick_replies").delete().eq("id", r.id);
    reload();
  }

  if (!ready) return null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col" style={{ background: "var(--wa-panel)" }}>
      <header
        className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 text-white"
        style={{ background: "var(--wa-header)", paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <Link href="/" className="px-1 text-xl" aria-label="Voltar">
          ←
        </Link>
        <h1 className="text-xl font-semibold">Respostas Rápidas</h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        <p className="px-4 pt-4 pb-1 text-sm" style={{ color: "var(--wa-text-muted)" }}>
          Digite <b>/</b> seguido do atalho no campo de mensagem de qualquer conversa para inserir o texto pronto.
        </p>

        <ul className="mt-2 divide-y" style={{ borderColor: "color-mix(in srgb, var(--wa-text) 8%, transparent)" }}>
          {loaded && replies.length === 0 && (
            <li className="p-4 text-sm" style={{ color: "var(--wa-text-muted)" }}>
              Nenhuma resposta rápida cadastrada ainda.
            </li>
          )}
          {replies.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-semibold" style={{ color: "var(--wa-accent)" }}>
                  /{r.shortcut}
                </p>
                <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-sm" style={{ color: "var(--wa-text)" }}>
                  {r.message}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => openEdit(r)}
                  className="rounded-full px-2.5 py-1.5 text-sm"
                  style={{ background: "var(--wa-bg)", color: "var(--wa-text-muted)" }}
                  title="Editar"
                  aria-label="Editar"
                >
                  ✏️
                </button>
                <button
                  onClick={() => handleDelete(r)}
                  className="rounded-full px-2.5 py-1.5 text-sm"
                  style={{ background: "var(--wa-bg)", color: "var(--wa-text-muted)" }}
                  title="Excluir"
                  aria-label="Excluir"
                >
                  🗑️
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="p-4">
          {!showForm ? (
            <button
              onClick={openNew}
              className="w-full rounded-lg px-4 py-3 text-white"
              style={{ background: "var(--wa-accent)" }}
            >
              + Nova resposta rápida
            </button>
          ) : (
            <form onSubmit={handleSave} className="flex flex-col gap-3 rounded-lg p-4" style={{ background: "var(--wa-bg)" }}>
              <div>
                <label className="mb-1 block text-xs font-semibold" style={{ color: "var(--wa-text-muted)" }}>
                  Atalho (sem espaços, sem "/")
                </label>
                <div className="flex items-center gap-1">
                  <span style={{ color: "var(--wa-text-muted)" }}>/</span>
                  <input
                    value={shortcut}
                    onChange={(e) => setShortcut(e.target.value)}
                    placeholder="horario"
                    className="w-full rounded-lg px-3 py-2 outline-none"
                    style={{ background: "var(--wa-panel)", color: "var(--wa-text)" }}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold" style={{ color: "var(--wa-text-muted)" }}>
                  Texto da resposta
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Nosso horário de atendimento é..."
                  rows={4}
                  className="w-full resize-none rounded-lg px-3 py-2 outline-none"
                  style={{ background: "var(--wa-panel)", color: "var(--wa-text)" }}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-lg px-4 py-2 text-white disabled:opacity-50"
                  style={{ background: "var(--wa-accent)" }}
                >
                  {saving ? "Salvando..." : editing ? "Salvar" : "Criar"}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-lg px-4 py-2"
                  style={{ background: "var(--wa-panel)", color: "var(--wa-text)" }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
