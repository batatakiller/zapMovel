"use client";

import { usePathname } from "next/navigation";
import ChatList from "./ChatList";

// Mestre-detalhe responsivo (como o WhatsApp Web): no desktop (md+), a lista
// de conversas fica fixa numa coluna à esquerda e a conversa aberta ocupa o
// resto à direita. No celular continua uma tela por vez — lista OU conversa,
// navegando por rota normal — exatamente como antes, sem nenhuma mudança.
//
// Só se aplica às rotas "/" (lista) e "/chat/[instance]/[jid]" (conversa).
// Qualquer outra rota (/login, /accounts) passa direto, tela cheia, intacta.
export default function ResponsiveShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isListRoute = pathname === "/";
  const isChatRoute = pathname?.startsWith("/chat/") ?? false;

  if (!isListRoute && !isChatRoute) return <>{children}</>;

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside
        className={`${isChatRoute ? "hidden" : "flex"} w-full flex-col md:flex md:w-[380px] md:shrink-0 md:border-r`}
        style={{ borderColor: "color-mix(in srgb, var(--wa-text) 8%, transparent)" }}
      >
        <ChatList />
      </aside>
      <main className={`${isChatRoute ? "flex" : "hidden"} min-w-0 flex-1 flex-col md:flex`}>
        {isChatRoute ? (
          children
        ) : (
          <div
            className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
            style={{ color: "var(--wa-text-muted)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" className="h-16 w-16 opacity-40" />
            <p className="text-lg font-medium" style={{ color: "var(--wa-text)" }}>
              ZapMóvel
            </p>
            <p className="max-w-xs text-sm">Selecione uma conversa na lista ao lado para começar.</p>
          </div>
        )}
      </main>
    </div>
  );
}
