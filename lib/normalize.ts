// Normaliza payloads do Evolution v2 (webhook ou websocket) para linhas de zap_messages

export type ZapRow = {
  instance: string;
  remote_jid: string;
  message_id: string;
  from_me: boolean;
  push_name: string | null;
  type: string;
  content: string | null;
  status: string;
  msg_timestamp: string;
  raw: unknown;
};

type EvoMessage = {
  key?: { remoteJid?: string; remoteJidAlt?: string; fromMe?: boolean; id?: string };
  pushName?: string;
  message?: Record<string, any>;
  messageType?: string;
  messageTimestamp?: number | string;
  status?: string;
};

// Conversas novas chegam com remoteJid "@lid" (id interno) e o telefone real
// em remoteJidAlt — usa sempre o JID de telefone como identidade do chat.
export function canonicalJid(key?: EvoMessage["key"]): string | null {
  if (!key?.remoteJid) return null;
  const jid = key.remoteJid.endsWith("@lid") && key.remoteJidAlt ? key.remoteJidAlt : key.remoteJid;
  // remove sufixo de dispositivo ("5562...:0@s.whatsapp.net" -> "5562...@s.whatsapp.net")
  return jid.replace(/:\d+@/, "@");
}

const TYPE_MAP: Record<string, { type: string; label: string }> = {
  conversation: { type: "text", label: "" },
  extendedTextMessage: { type: "text", label: "" },
  imageMessage: { type: "image", label: "📷 Foto" },
  videoMessage: { type: "video", label: "🎬 Vídeo" },
  audioMessage: { type: "audio", label: "🎤 Áudio" },
  documentMessage: { type: "document", label: "📄 Documento" },
  stickerMessage: { type: "sticker", label: "💟 Figurinha" },
  contactMessage: { type: "contact", label: "👤 Contato" },
  locationMessage: { type: "location", label: "📍 Localização" },
};

export function extractContent(msg?: Record<string, any>): { type: string; content: string | null } {
  if (!msg) return { type: "other", content: null };
  if (typeof msg.conversation === "string" && msg.conversation) {
    return { type: "text", content: msg.conversation };
  }
  if (msg.extendedTextMessage?.text) {
    return { type: "text", content: msg.extendedTextMessage.text };
  }
  if (msg.reactionMessage) {
    return { type: "reaction", content: `Reagiu com ${msg.reactionMessage.text ?? "👍"}` };
  }
  for (const [k, v] of Object.entries(TYPE_MAP)) {
    if (msg[k]) {
      const caption = msg[k]?.caption;
      return { type: v.type, content: caption ? `${v.label} — ${caption}` : v.label };
    }
  }
  const firstKey = Object.keys(msg)[0] ?? "other";
  return { type: "other", content: `[${firstKey}]` };
}

// STATUS numérico do Baileys: 0/1 pending, 2 sent (server ack), 3 delivered, 4 read
const STATUS_MAP: Record<string, string> = {
  "0": "pending",
  "1": "pending",
  "2": "sent",
  "3": "delivered",
  "4": "read",
  PENDING: "pending",
  SERVER_ACK: "sent",
  DELIVERY_ACK: "delivered",
  READ: "read",
};

export function normalizeStatus(s: unknown): string {
  if (s === undefined || s === null) return "received";
  return STATUS_MAP[String(s)] ?? String(s).toLowerCase();
}

export function normalizeUpsert(instance: string, data: EvoMessage): ZapRow | null {
  const key = data?.key;
  const jid = canonicalJid(key);
  if (!jid || !key?.id) return null;
  // ignora broadcasts/status do WhatsApp
  if (jid === "status@broadcast") return null;

  const { type, content } = extractContent(data.message);
  const ts = data.messageTimestamp ? new Date(Number(data.messageTimestamp) * 1000) : new Date();

  return {
    instance,
    remote_jid: jid,
    message_id: key.id,
    from_me: !!key.fromMe,
    push_name: data.pushName ?? null,
    type,
    content,
    status: key.fromMe ? normalizeStatus(data.status ?? "sent") : "received",
    msg_timestamp: ts.toISOString(),
    raw: data,
  };
}

export function jidToPhone(jid: string): string {
  return jid.replace(/@.*$/, "");
}

export function isGroup(jid: string): boolean {
  return jid.endsWith("@g.us");
}
