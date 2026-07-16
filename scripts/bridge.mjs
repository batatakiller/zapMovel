// Ponte Evolution -> Supabase (zap_messages).
// 1) Tenta WebSocket (tempo real instantâneo — requer WEBSOCKET_ENABLED=true no servidor Evolution).
// 2) Se o socket não responder, faz polling do findMessages a cada POLL_MS (padrão 3s).
// Rode junto com o dev server: npm run bridge

import { io } from "socket.io-client";
import { EVOLUTION_URL, INSTANCE, normalizeUpsert, normStatus, upsertRows, findMessages, supabase } from "./evo-common.mjs";

const POLL_MS = Number(process.env.POLL_MS ?? 3000);
let mode = "connecting"; // connecting | websocket | polling
let pollTimer = null;

async function saveUpsert(data) {
  const row = normalizeUpsert(data?.messages?.[0] ?? data);
  if (!row) return;
  try {
    await upsertRows([row]);
    console.log(`[bridge] ${row.from_me ? "→" : "←"} ${row.remote_jid}: ${String(row.content).slice(0, 60)}`);
  } catch (e) {
    console.error("[bridge] erro ao gravar:", e.message);
  }
}

async function saveUpdate(data) {
  const items = Array.isArray(data) ? data : [data];
  for (const u of items) {
    const id = u?.keyId ?? u?.key?.id;
    if (!id || u?.status === undefined) continue;
    const { error } = await supabase
      .from("zap_messages")
      .update({ status: normStatus(u.status) })
      .eq("instance", INSTANCE)
      .eq("message_id", id);
    if (error) console.error("[bridge] erro status:", error.message);
  }
}

// ---------- polling ----------
async function pollOnce() {
  try {
    const { records } = await findMessages(1, 30);
    const rows = (records ?? []).map(normalizeUpsert);
    const n = await upsertRows(rows);
    if (process.env.DEBUG) console.log(`[bridge] poll: ${n} mensagens sincronizadas`);
  } catch (e) {
    console.error("[bridge] poll falhou:", e.message);
  }
}

function startPolling() {
  if (pollTimer) return;
  mode = "polling";
  console.log(`[bridge] modo POLLING ativo (${POLL_MS}ms). Para tempo real instantâneo, defina WEBSOCKET_ENABLED=true no servidor Evolution.`);
  pollTimer = setInterval(pollOnce, POLL_MS);
  pollOnce();
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ---------- websocket ----------
const url = `${EVOLUTION_URL}/${INSTANCE}`;
console.log(`[bridge] tentando websocket em ${url} ...`);
const socket = io(url, { transports: ["websocket"], reconnection: true, reconnectionDelay: 5000 });

let wsFailures = 0;

socket.on("connect", () => {
  wsFailures = 0;
  mode = "websocket";
  stopPolling();
  console.log(`[bridge] modo WEBSOCKET ativo (tempo real instantâneo, id ${socket.id})`);
});

socket.on("disconnect", (r) => {
  console.log(`[bridge] websocket desconectado: ${r}`);
  startPolling();
});

socket.on("connect_error", () => {
  wsFailures++;
  if (wsFailures === 2) startPolling(); // não espera demais para começar a sincronizar
});

socket.on("messages.upsert", (p) => saveUpsert(p?.data ?? p));
socket.on("send.message", (p) => saveUpsert(p?.data ?? p));
socket.on("messages.update", (p) => saveUpdate(p?.data ?? p));

process.on("SIGINT", () => { stopPolling(); socket.close(); process.exit(0); });
