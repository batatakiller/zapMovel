"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "@/hooks/useSession";
import { useAccounts } from "@/hooks/useAccounts";

const COLORS = ["#128C7E", "#25D366", "#0088cc", "#7E57C2", "#EF6C00", "#C62828", "#00838F", "#5D4037"];

function qrSrc(qr: string): string {
  return qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`;
}

export default function AccountsPage() {
  const ready = useSession();
  const { accounts, loaded } = useAccounts();

  const [showForm, setShowForm] = useState(false);
  const [instance, setInstance] = useState("");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [phone, setPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // pareamento (QR)
  const [pairing, setPairing] = useState<string | null>(null); // instance sendo pareada
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollQr = useCallback(
    async (inst: string) => {
      try {
        const res = await fetch(`/api/accounts/${encodeURIComponent(inst)}/qr`);
        const json = await res.json();
        if (json.connected) {
          setConnected(true);
          setQr(null);
          stopPolling();
          return;
        }
        if (json.qr) setQr(json.qr);
        if (json.pairingCode) setPairingCode(json.pairingCode);
      } catch {
        /* ignora — tenta de novo no próximo tick */
      }
    },
    [stopPolling]
  );

  function startPairing(inst: string) {
    stopPolling();
    setPairing(inst);
    setQr(null);
    setPairingCode(null);
    setConnected(false);
    pollQr(inst);
    pollRef.current = setInterval(() => pollQr(inst), 3000);
  }

  function closePairing() {
    stopPolling();
    setPairing(null);
    setQr(null);
    setPairingCode(null);
    setConnected(false);
  }

  useEffect(() => stopPolling, [stopPolling]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const name = instance.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(name)) {
      setError("Identificador inválido: use minúsculas, números e hífen (2 a 31 caracteres).");
      return;
    }
    if (!label.trim()) {
      setError("Dê um nome para a conta.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instance: name, label: label.trim(), color, phone: phone.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setShowForm(false);
      setInstance("");
      setLabel("");
      setPhone("");
      startPairing(name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
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
        <h1 className="text-xl font-semibold">Contas de WhatsApp</h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* lista de contas */}
        <ul className="divide-y" style={{ borderColor: "color-mix(in srgb, var(--wa-text) 8%, transparent)" }}>
          {loaded && accounts.length === 0 && (
            <li className="p-4 text-sm" style={{ color: "var(--wa-text-muted)" }}>
              Nenhuma conta cadastrada ainda.
            </li>
          )}
          {accounts.map((a) => (
            <li key={a.instance} className="flex items-center gap-3 px-4 py-3">
              <span className="h-10 w-10 shrink-0 rounded-full" style={{ background: a.color }} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{a.label}</p>
                <p className="truncate text-sm" style={{ color: "var(--wa-text-muted)" }}>
                  {a.phone ? `${a.phone} · ` : ""}
                  {a.kind === "live" ? "conectada (ao vivo)" : "arquivo importado (só leitura)"}
                </p>
              </div>
              {a.kind === "live" && (
                <button
                  onClick={() => startPairing(a.instance)}
                  className="shrink-0 rounded-full px-3 py-1.5 text-sm text-white"
                  style={{ background: "var(--wa-accent)" }}
                >
                  Conectar
                </button>
              )}
            </li>
          ))}
        </ul>

        {/* botão adicionar */}
        <div className="p-4">
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="w-full rounded-lg px-4 py-3 text-white"
              style={{ background: "var(--wa-accent)" }}
            >
              + Adicionar um WhatsApp (ao vivo)
            </button>
          ) : (
            <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-lg p-4" style={{ background: "var(--wa-bg)" }}>
              <div>
                <label className="mb-1 block text-xs font-semibold" style={{ color: "var(--wa-text-muted)" }}>
                  Nome da conta
                </label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Ex.: Trabalho"
                  className="w-full rounded-lg px-3 py-2 outline-none"
                  style={{ background: "var(--wa-panel)", color: "var(--wa-text)" }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold" style={{ color: "var(--wa-text-muted)" }}>
                  Identificador (sem espaços)
                </label>
                <input
                  value={instance}
                  onChange={(e) => setInstance(e.target.value)}
                  placeholder="ex.: trabalho"
                  className="w-full rounded-lg px-3 py-2 outline-none"
                  style={{ background: "var(--wa-panel)", color: "var(--wa-text)" }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold" style={{ color: "var(--wa-text-muted)" }}>
                  Telefone (opcional)
                </label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="5562999999999"
                  className="w-full rounded-lg px-3 py-2 outline-none"
                  style={{ background: "var(--wa-panel)", color: "var(--wa-text)" }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold" style={{ color: "var(--wa-text-muted)" }}>
                  Cor da etiqueta
                </label>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className="h-8 w-8 rounded-full"
                      style={{ background: c, outline: color === c ? "3px solid var(--wa-text)" : "none" }}
                      aria-label={`cor ${c}`}
                    />
                  ))}
                </div>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 rounded-lg px-4 py-2 text-white disabled:opacity-50"
                  style={{ background: "var(--wa-accent)" }}
                >
                  {creating ? "Criando..." : "Criar e parear"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setError(null); }}
                  className="rounded-lg px-4 py-2"
                  style={{ background: "var(--wa-panel)", color: "var(--wa-text)" }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>

        {/* como importar backup (arquivo) */}
        <div className="mx-4 mb-6 rounded-lg p-4 text-sm" style={{ background: "var(--wa-bg)", color: "var(--wa-text-muted)" }}>
          <p className="mb-1 font-semibold" style={{ color: "var(--wa-text)" }}>
            📁 Importar backup de um aparelho antigo
          </p>
          <p>
            As conversas antigas do Android entram como conta de <b>arquivo</b> (só leitura). No computador que roda o
            bridge, copie o <code>msgstore.db</code> descriptografado e a pasta de mídia e rode:
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-black/30 p-2 text-xs text-white">
{`npm run import -- ./msgstore.db \\
  --instance zap-antigo --label "Zap Antigo" \\
  --media "/caminho/WhatsApp"`}
          </pre>
          <p className="mt-2">Veja os detalhes em <code>docs/IMPORTAR-BACKUP.md</code>.</p>
        </div>
      </div>

      {/* modal de pareamento (QR) */}
      {pairing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={closePairing}>
          <div
            className="w-full max-w-sm rounded-2xl p-6 text-center"
            style={{ background: "var(--wa-panel)", color: "var(--wa-text)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-lg font-semibold">Parear WhatsApp</h2>
            <p className="mb-4 text-sm" style={{ color: "var(--wa-text-muted)" }}>
              No celular: WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho.
            </p>
            {connected ? (
              <div className="py-8">
                <p className="text-4xl">✅</p>
                <p className="mt-2 font-medium">Conectado!</p>
              </div>
            ) : qr ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrSrc(qr)} alt="QR code" className="mx-auto h-64 w-64 rounded-lg bg-white p-2" />
                {pairingCode && (
                  <p className="mt-3 text-sm">
                    ou use o código: <b className="tracking-widest">{pairingCode}</b>
                  </p>
                )}
              </>
            ) : (
              <p className="py-10 text-sm" style={{ color: "var(--wa-text-muted)" }}>
                Gerando QR code...
              </p>
            )}
            <button
              onClick={closePairing}
              className="mt-5 w-full rounded-lg px-4 py-2 text-white"
              style={{ background: "var(--wa-accent)" }}
            >
              {connected ? "Pronto" : "Fechar"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
