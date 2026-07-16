const BASE = process.env.EVOLUTION_URL!;
const INSTANCE = process.env.EVOLUTION_INSTANCE!;
const APIKEY = process.env.EVOLUTION_APIKEY!;

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

export function sendText(number: string, text: string) {
  return evo(`/message/sendText/${INSTANCE}`, { number, text });
}

export function markRead(readMessages: { remoteJid: string; fromMe: boolean; id: string }[]) {
  return evo(`/chat/markMessageAsRead/${INSTANCE}`, { readMessages });
}

export const instanceName = INSTANCE;
