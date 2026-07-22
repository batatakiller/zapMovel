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
  quoted_message_id: string | null;
  raw: unknown;
};

export type ReactionRow = {
  instance: string;
  remote_jid: string;
  target_message_id: string;
  reactor_jid: string;
  from_me: boolean;
  emoji: string | null;
  msg_timestamp: string;
};

type EvoMessage = {
  key?: { remoteJid?: string; remoteJidAlt?: string; fromMe?: boolean; id?: string; participant?: string };
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
  for (const [k, v] of Object.entries(TYPE_MAP)) {
    if (msg[k]) {
      const caption = msg[k]?.caption;
      return { type: v.type, content: caption ? `${v.label} — ${caption}` : v.label };
    }
  }
  const firstKey = Object.keys(msg)[0] ?? "other";
  return { type: "other", content: `[${firstKey}]` };
}

// Toda mensagem de conteúdo pode citar outra (responder) — o Baileys guarda
// isso em contextInfo.stanzaId, dentro do wrapper do tipo (extendedTextMessage,
// imageMessage etc.). Guardamos só o id citado; o conteúdo é buscado em
// zap_messages na hora de exibir, sem duplicar dado.
export function extractQuotedId(msg?: Record<string, any>): string | null {
  if (!msg) return null;
  for (const key of Object.keys(msg)) {
    const stanzaId = msg[key]?.contextInfo?.stanzaId;
    if (stanzaId) return stanzaId;
  }
  return null;
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

// Reações chegam como um evento de mensagem próprio (message.reactionMessage),
// nunca devem virar uma linha normal em zap_messages — vão para zap_reactions.
export function extractReaction(instance: string, data: EvoMessage): ReactionRow | null {
  const reaction = data?.message?.reactionMessage;
  const targetId = reaction?.key?.id;
  if (!targetId) return null;

  const jid = canonicalJid(data.key);
  if (!jid) return null;

  const fromMe = !!data.key?.fromMe;
  const reactorJid = fromMe ? "me" : data.key?.participant ?? jid;
  const ts = data.messageTimestamp ? new Date(Number(data.messageTimestamp) * 1000) : new Date();

  return {
    instance,
    remote_jid: jid,
    target_message_id: targetId,
    reactor_jid: reactorJid,
    from_me: fromMe,
    emoji: reaction.text?.trim() || null, // vazio = reação removida
    msg_timestamp: ts.toISOString(),
  };
}

export function normalizeUpsert(instance: string, data: EvoMessage): ZapRow | null {
  const key = data?.key;
  const jid = canonicalJid(key);
  if (!jid || !key?.id) return null;
  // ignora broadcasts/status do WhatsApp
  if (jid === "status@broadcast") return null;
  // reações têm seu próprio caminho (extractReaction) — não viram mensagem
  if (data.message?.reactionMessage) return null;

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
    quoted_message_id: extractQuotedId(data.message),
    raw: data,
  };
}

export function jidToPhone(jid: string): string {
  return jid.replace(/@.*$/, "");
}

export function isGroup(jid: string): boolean {
  return jid.endsWith("@g.us");
}
