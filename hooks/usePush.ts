"use client";

import { useCallback, useEffect, useState } from "react";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export type PushState = "unsupported" | "default" | "enabled" | "denied";

// Registra o service worker e controla a inscrição de Web Push deste dispositivo
export function usePush() {
  const [state, setState] = useState<PushState>("default");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      // registra o SW mesmo assim (necessário p/ iPhone após instalar na tela de início)
      if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => null);
      return;
    }
    navigator.serviceWorker.register("/sw.js").then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      if (Notification.permission === "denied") setState("denied");
      else if (sub && Notification.permission === "granted") setState("enabled");
      else setState("default");
    });
  }, []);

  const enable = useCallback(async () => {
    if (typeof window === "undefined" || !("PushManager" in window) || !("Notification" in window)) {
      if (typeof window !== "undefined" && typeof navigator !== "undefined") {
        const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
        const w = window as any;
        const standalone = (w.matchMedia?.("(display-mode: standalone)").matches ?? false) || (navigator as any).standalone;
        alert(
          isIOS && !standalone
            ? "No iPhone as notificações só funcionam com o app instalado:\n\n1. Toque em Compartilhar (□↑) no Safari\n2. 'Adicionar à Tela de Início'\n3. Abra o ZapMóvel pelo ícone novo\n4. Toque no sino de novo\n\n(Requer iOS 16.4 ou superior)"
            : "Este navegador não suporta notificações push. Tente o Chrome (Android) ou instale o app na tela de início."
        );
      }
      return;
    }
    // Permissão já bloqueada nas configurações: requestPermission() não pergunta
    // de novo — nenhum conserto no servidor reverte isso, só o próprio usuário
    // liberando o site nas configurações do navegador.
    if (Notification.permission === "denied") {
      setState("denied");
      alert(
        "As notificações estão BLOQUEADAS para este site.\n\n" +
          "Chrome (computador): abra chrome://settings/content/notifications, remova zapmovel.vercel.app da lista de \"Não têm permissão\", recarregue a página e toque no sino de novo.\n\n" +
          "Ou clique no ícone de controles/cadeado à esquerda do endereço → Notificações → Permitir."
      );
      return;
    }

    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      alert("Configuração de notificações ausente no servidor (chave VAPID). Avise o administrador.");
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "default");
        if (permission === "denied") {
          alert(
            "Você negou as notificações. Para ativar depois, libere este site nas configurações de notificações do navegador e toque no sino novamente."
          );
        }
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const subscription =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }));
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`registro no servidor falhou (HTTP ${res.status}) ${detail}`.trim());
      }
      setState("enabled");
    } catch (e: any) {
      console.error("push enable:", e);
      // mostra o erro REAL — o texto genérico anterior escondia a causa
      alert(`Não foi possível ativar as notificações.\n\nDetalhe técnico: ${e?.name ?? "Erro"}: ${e?.message ?? e}`);
    }
  }, []);

  const disable = useCallback(async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    setState("default");
  }, []);

  return { state, enable, disable };
}
