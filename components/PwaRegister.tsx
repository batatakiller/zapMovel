"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function PwaRegister() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    // 1) Registra o Service Worker imediatamente em todas as páginas
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => console.warn("PWA Service Worker registration error:", err));
    }

    // 2) Detecta se já está rodando instalado como PWA (standalone)
    const checkStandalone = () => {
      const isStandaloneMode =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true ||
        document.referrer.includes("android-app://");
      setIsStandalone(isStandaloneMode);
    };

    checkStandalone();

    // 3) Captura o evento nativo de instalação do navegador
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
      setShowBanner(false);
    }
  };

  if (isStandalone || !showBanner || !deferredPrompt) {
    return null;
  }

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-50 flex items-center justify-between gap-3 rounded-xl p-3 shadow-2xl md:left-auto md:right-6 md:w-96"
      style={{
        background: "var(--wa-panel, #202c33)",
        border: "1px solid color-mix(in srgb, var(--wa-green, #00a884) 40%, transparent)",
        color: "var(--wa-text, #e9edef)",
      }}
    >
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="ZapMóvel" className="h-10 w-10 rounded-lg" />
        <div>
          <p className="text-sm font-semibold">Instalar ZapMóvel</p>
          <p className="text-xs" style={{ color: "var(--wa-text-muted, #8696a0)" }}>
            Acesso rápido direto da tela inicial
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowBanner(false)}
          className="rounded-lg px-2 py-1 text-xs opacity-60 hover:opacity-100"
          style={{ color: "var(--wa-text-muted, #8696a0)" }}
        >
          Agora não
        </button>
        <button
          onClick={handleInstallClick}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold shadow transition-transform active:scale-95"
          style={{
            background: "var(--wa-green, #00a884)",
            color: "#ffffff",
          }}
        >
          Instalar
        </button>
      </div>
    </div>
  );
}
