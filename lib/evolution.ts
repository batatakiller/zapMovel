export type EvoConfig = { url: string; apikey: string };

// Instância padrão (mantém compatibilidade com quem chamar sem passar instance).
export const instanceName = process.env.EVOLUTION_INSTANCE ?? "super";

async function evo(cfg: EvoConfig, path: string, body?: unknown, method = "POST") {
  const res = await fetch(`${cfg.url}${path}`, {
    method,
    headers: { "Content-Type": "application/json", apikey: cfg.apikey },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Evolution ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

export type QuotedRef = { key: { remoteJid: string; fromMe: boolean; id: string }; message: Record<string, unknown> };

export function sendText(cfg: EvoConfig, instance: string, number: string, text: string, quoted?: QuotedRef) {
  return evo(cfg, `/message/sendText/${instance}`, { number, text, ...(quoted ? { quoted } : {}) });
}

export function markRead(
  cfg: EvoConfig,
  instance: string,
  readMessages: { remoteJid: string; fromMe: boolean; id: string }[]
) {
  return evo(cfg, `/chat/markMessageAsRead/${instance}`, { readMessages });
}

// Reage a uma mensagem com um emoji. Envie reactionMessage: "" para remover
// a reação já enviada (mesma convenção do próprio WhatsApp).
export function sendReaction(
  cfg: EvoConfig,
  instance: string,
  reactionKey: { remoteJid: string; fromMe: boolean; id: string },
  reactionMessage: string
) {
  return evo(cfg, `/message/sendReaction/${instance}`, { reactionKey, reactionMessage });
}

// --- Gerenciamento de instâncias (adicionar novo WhatsApp) ------------------

// Cria uma nova instância Baileys no Evolution. Retorna o QR (se já disponível).
export function createInstance(cfg: EvoConfig, instance: string) {
  return evo(cfg, `/instance/create`, {
    instanceName: instance,
    qrcode: true,
    integration: "WHATSAPP-BAILEYS",
  });
}

// Pede o QR code (base64) para parear o número. Chame repetidamente até conectar.
export function connectInstance(cfg: EvoConfig, instance: string) {
  return evo(cfg, `/instance/connect/${instance}`, undefined, "GET");
}

// Estado da conexão: 'open' (conectado), 'connecting', 'close'.
export async function connectionState(cfg: EvoConfig, instance: string): Promise<string> {
  const json = await evo(cfg, `/instance/connectionState/${instance}`, undefined, "GET").catch(() => null);
  return json?.instance?.state ?? json?.state ?? "unknown";
}
