"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "@/hooks/useSession";
import type { Account } from "@/lib/types";

const COLORS = ["#128C7E", "#25D366", "#0088cc", "#7E57C2", "#EF6C00", "#C62828", "#00838F", "#5D4037"];

function qrSrc(qr: string): string {
  return qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`;
}

// Campos de servidor Evolution reutilizados na criação e na edição.
function EvolutionFields({
  url,
  setUrl,
  apikey,
  setApikey,
  hint,
}: {
  url: string;
  setUrl: (v: string) => void;
  apikey: string;
  setApikey: (v: string) => void;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3" style={{ borderColor: "color-mix(in srgb, var(--wa-text) 20%, transparent)" }}>
      <p className="text-xs" style={{ color: "var(--wa-text-muted)" }}>
        {hint}
      </p>
      <div>
        <label className="mb-1 block text-xs font-semibold" style={{ color: "var(--wa-text-muted)" }}>
          URL do servidor Evolution
        </label>
        <input
          type="url"
          name="zm-evolution-server-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://evolution2.meuservidor.com"
          className="w-full rounded-lg px-3 py-2 outline-none"
          style={{ background: "var(--wa-panel)", color: "var(--wa-text)" }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold" style={{ color: "var(--wa-text-muted)" }}>
          Apikey desse servidor
        </label>
        <input
          type="text"
          name="zm-evolution-server-apikey"
          value={apikey}
          onChange={(e) => setApikey(e.target.value)}
          placeholder="ex.: B836FD3A9A67-4234-8241-1444C8FCF1D3"
          className="w-full rounded-lg px-3 py-2 font-mono text-sm outline-none"
          style={{ background: "var(--wa-panel)", color: "var(--wa-text)" }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
        />
        <p className="mt-1 text-[11px]" style={{ color: "var(--wa-text-muted)" }}>
          Fica visível de propósito — evita autofill do navegador colar login/senha salvos aqui por engano.
        </p>
      </div>
    </div>
  );
}

export default function AccountsPage() {
  const ready = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loaded, setLoaded] = useState(false);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts");
      const json = await res.json();
      setAccounts(json.accounts ?? []);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (ready) loadAccounts();
  }, [ready, loadAccounts]);

  const [showForm, setShowForm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [instance, setInstance] = useState("");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [phone, setPhone] = useState("");
  const [evolutionUrl, setEvolutionUrl] = useState("");
  const [evolutionApikey, setEvolutionApikey] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // edição de conta existente
  const [editing, setEditing] = useState<Account | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEvoUrl, setEditEvoUrl] = useState("");
  const [editEvoKey, setEditEvoKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // pareamento (QR)
  const [pairing, setPairing] = useState<string | null>(null); // instance sendo pareada
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
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
        if (!res.ok || json.error) {
          setQrError(json.error ?? `falha ao obter QR (HTTP ${res.status})`);
          return; // continua tentando no próximo tick — pode ser algo transitório
        }
        setQrError(null);
        if (json.connected) {
          setConnected(true);
          setQr(null);
          stopPolling();
          return;
        }
        if (json.qr) setQr(json.qr);
        if (json.pairingCode) setPairingCode(json.pairingCode);
      } catch (e) {
        setQrError((e as Error).message || "falha de rede ao buscar o QR");
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
    setQrError(null);
    pollQr(inst);
    pollRef.current = setInterval(() => pollQr(inst), 3000);
  }

  function closePairing() {
    stopPolling();
    setPairing(null);
    setQr(null);
    setPairingCode(null);
    setConnected(false);
    setQrError(null);
  }

  useEffect(() => stopPolling, [stopPolling]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Preserva a caixa exata: se a instância já existe no Evolution (criada
    // por fora do ZapMóvel), o nome é sensível a maiúsculas/minúsculas.
    const name = instance.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,30}$/.test(name)) {
      setError("Identificador inválido: use letras, números, hífen e underscore (2 a 31 caracteres).");
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
        body: JSON.stringify({
          instance: name,
          label: label.trim(),
          color,
          phone: phone.trim(),
          evolutionUrl: evolutionUrl.trim() || undefined,
          evolutionApikey: evolutionApikey.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setShowForm(false);
      setShowAdvanced(false);
      setInstance("");
      setLabel("");
      setPhone("");
      setEvolutionUrl("");
      setEvolutionApikey("");
      await loadAccounts();
      startPairing(name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function openEdit(a: Account) {
    setEditing(a);
    setEditLabel(a.label);
    setEditColor(a.color);
    setEditPhone(a.phone ?? "");
    setEditEvoUrl("");
    setEditEvoKey("");
    setEditError(null);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(editing.instance)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: editLabel.trim(),
          color: editColor,
          phone: editPhone.trim(),
          evolutionUrl: editEvoUrl.trim() || undefined,
          evolutionApikey: editEvoKey.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setEditing(null);
      await loadAccounts();
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleResetEvolution() {
    if (!editing) return;
    setSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(editing.instance)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetEvolution: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setEditing({ ...editing, hasCustomEvolution: false });
      setEditEvoUrl("");
      setEditEvoKey("");
      loadAccounts();
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setSaving(false);
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
                  {a.hasCustomEvolution ? " · servidor próprio" : ""}
                </p>
              </div>
              <button
                onClick={() => openEdit(a)}
                className="shrink-0 rounded-full px-2.5 py-1.5 text-sm"
                style={{ background: "var(--wa-bg)", color: "var(--wa-text-muted)" }}
                title="Editar conta"
                aria-label="Editar conta"
              >
                ✏️
              </button>
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
                  Identificador (sem espaços — se a instância já existe no Evolution, use o nome EXATO, com a mesma caixa)
                </label>
                <input
                  value={instance}
                  onChange={(e) => setInstance(e.target.value)}
                  placeholder="ex.: trabalho ou AJU"
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

              {!showAdvanced ? (
                <button
                  type="button"
                  onClick={() => setShowAdvanced(true)}
                  className="self-start text-sm underline"
                  style={{ color: "var(--wa-text-muted)" }}
                >
                  ⚙️ Avançado: este número está em outro servidor Evolution?
                </button>
              ) : (
                <EvolutionFields
                  url={evolutionUrl}
                  setUrl={setEvolutionUrl}
                  apikey={evolutionApikey}
                  setApikey={setEvolutionApikey}
                  hint="Deixe em branco para usar o mesmo servidor Evolution já configurado no projeto (.env). Só preencha se este WhatsApp roda numa instância Evolution diferente (outro VPS/Coolify). Se a instância já existe e está pareada (ex.: criada pelo Evolution Manager), use o identificador dela em 'Identificador' e a apikey/token dessa instância aqui — o app detecta que já existe e conecta direto, sem precisar da chave global de admin."
                />
              )}

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
                  onClick={() => { setShowForm(false); setShowAdvanced(false); setError(null); }}
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
            ) : qrError ? (
              <div className="py-6">
                <p className="text-3xl">⚠️</p>
                <p className="mt-2 text-sm font-medium text-red-500">{qrError}</p>
                <p className="mt-2 text-xs" style={{ color: "var(--wa-text-muted)" }}>
                  Continuando a tentar... Se persistir, confira a URL/apikey do servidor Evolution dessa conta (✏️
                  editar).
                </p>
              </div>
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

      {/* modal de edição de conta */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => setEditing(null)}>
          <form
            onSubmit={handleSaveEdit}
            className="flex w-full max-w-sm flex-col gap-3 rounded-2xl p-6"
            style={{ background: "var(--wa-panel)", color: "var(--wa-text)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">Editar conta</h2>
            <div>
              <label className="mb-1 block text-xs font-semibold" style={{ color: "var(--wa-text-muted)" }}>
                Nome da conta
              </label>
              <input
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                className="w-full rounded-lg px-3 py-2 outline-none"
                style={{ background: "var(--wa-bg)", color: "var(--wa-text)" }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold" style={{ color: "var(--wa-text-muted)" }}>
                Telefone (opcional)
              </label>
              <input
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                className="w-full rounded-lg px-3 py-2 outline-none"
                style={{ background: "var(--wa-bg)", color: "var(--wa-text)" }}
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
                    onClick={() => setEditColor(c)}
                    className="h-8 w-8 rounded-full"
                    style={{ background: c, outline: editColor === c ? "3px solid var(--wa-text)" : "none" }}
                    aria-label={`cor ${c}`}
                  />
                ))}
              </div>
            </div>

            {editing.kind === "live" && (
              <>
                <EvolutionFields
                  url={editEvoUrl}
                  setUrl={setEditEvoUrl}
                  apikey={editEvoKey}
                  setApikey={setEditEvoKey}
                  hint={
                    editing.hasCustomEvolution
                      ? "Esta conta já usa um servidor Evolution próprio. Preencha para substituir, ou use o botão abaixo para voltar ao padrão do projeto."
                      : "Esta conta usa o servidor Evolution padrão do projeto. Preencha só se quiser conectá-la a outro servidor."
                  }
                />
                {editing.hasCustomEvolution && (
                  <button
                    type="button"
                    onClick={handleResetEvolution}
                    disabled={saving}
                    className="self-start text-sm underline disabled:opacity-50"
                    style={{ color: "var(--wa-text-muted)" }}
                  >
                    Voltar a usar o servidor padrão do projeto
                  </button>
                )}
              </>
            )}

            {editError && <p className="text-sm text-red-500">{editError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 rounded-lg px-4 py-2 text-white disabled:opacity-50"
                style={{ background: "var(--wa-accent)" }}
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg px-4 py-2"
                style={{ background: "var(--wa-bg)", color: "var(--wa-text)" }}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
