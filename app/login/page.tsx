"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser, anonKeyConfigured } from "@/lib/supabase-browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const configured = anonKeyConfigured();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message === "Invalid login credentials" ? "E-mail ou senha inválidos" : error.message);
    else router.replace("/");
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="h-20 w-20" />
        <h1 className="text-2xl font-semibold">ZapMóvel</h1>
        <p className="text-sm" style={{ color: "var(--wa-text-muted)" }}>
          Seu WhatsApp via Evolution API
        </p>
      </div>

      {!configured ? (
        <div
          className="max-w-sm rounded-xl p-4 text-sm leading-relaxed"
          style={{ background: "var(--wa-panel)", color: "var(--wa-text)" }}
        >
          <p className="mb-2 font-semibold">⚙️ Configuração pendente</p>
          <p>
            Cole a <b>anon key</b> do Supabase em <code>.env.local</code> na variável{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> e reinicie o servidor.
          </p>
          <p className="mt-2" style={{ color: "var(--wa-text-muted)" }}>
            Dashboard → Settings → API Keys → anon public
          </p>
        </div>
      ) : (
        <form onSubmit={handleLogin} className="flex w-full max-w-sm flex-col gap-3">
          <input
            type="email"
            required
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-xl px-4 py-3 outline-none"
            style={{ background: "var(--wa-panel)", color: "var(--wa-text)" }}
          />
          <input
            type="password"
            required
            placeholder="Senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-xl px-4 py-3 outline-none"
            style={{ background: "var(--wa-panel)", color: "var(--wa-text)" }}
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl py-3 font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--wa-header)" }}
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      )}
    </main>
  );
}
