const BASE = process.env.EVOLUTION_URL!;
const APIKEY = process.env.EVOLUTION_APIKEY!;

// Instância padrão (mantém compatibilidade com quem chamar sem passar instance).
export const instanceName = process.env.EVOLUTION_INSTANCE ?? "super";

async function evo(path: string, body?: unknown, method = "POST") {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", apikey: APIKEY },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Evolution ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

export function sendText(instance: string, number: string, text: string) {
  return evo(`/message/sendText/${instance}`, { number, text });
}

export function markRead(
  instance: string,
  readMessages: { remoteJid: string; fromMe: boolean; id: string }[]
) {
  return evo(`/chat/markMessageAsRead/${instance}`, { readMessages });
}

// --- Gerenciamento de instâncias (adicionar novo WhatsApp) ------------------

// Cria uma nova instância Baileys no Evolution. Retorna o QR (se já disponível).
export function createInstance(instance: string) {
  return evo(`/instance/create`, {
    instanceName: instance,
    qrcode: true,
    integration: "WHATSAPP-BAILEYS",
  });
}

// Pede o QR code (base64) para parear o número. Chame repetidamente até conectar.
export function connectInstance(instance: string) {
  return evo(`/instance/connect/${instance}`, undefined, "GET");
}

// Estado da conexão: 'open' (conectado), 'connecting', 'close'.
export async function connectionState(instance: string): Promise<string> {
  const json = await evo(`/instance/connectionState/${instance}`, undefined, "GET").catch(() => null);
  return json?.instance?.state ?? json?.state ?? "unknown";
}
