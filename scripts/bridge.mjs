// Ponte Evolution -> Supabase (zap_messages), com suporte a VÁRIAS contas.
// Para cada instância AO VIVO cadastrada em zap_accounts (kind='live'):
//   1) Tenta WebSocket (tempo real — requer WEBSOCKET_ENABLED=true no Evolution).
//   2) Se o socket não responder, faz polling do findMessages a cada POLL_MS.
// Novas contas adicionadas no app são detectadas a cada ACCOUNTS_REFRESH_MS.
// Rode junto com o dev server: npm run bridge

import { io } from "socket.io-client";
import {
  normalizeUpsert,
  normStatus,
  upsertRows,
  findMessages,
  listLiveInstances,
  getEvolutionConfig,
  cacheMediaForRow,
  supabase,
} from "./evo-common.mjs";

const POLL_MS = Number(process.env.POLL_MS ?? 3000);
const ACCOUNTS_REFRESH_MS = Number(process.env.ACCOUNTS_REFRESH_MS ?? 30000);

// Um "worker" cuida de uma única instância (socket + fallback de polling).
class InstanceWorker {
  constructor(instance) {
    this.instance = instance;
    this.mode = "connecting";
    this.pollTimer = null;
    this.wsFailures = 0;
    this.socket = null;
  }

  log(msg) {
    console.log(`[bridge:${this.instance}] ${msg}`);
  }

  async saveUpsert(data) {
    const row = normalizeUpsert(data?.messages?.[0] ?? data, this.instance);
    if (!row) return;
    try {
      await upsertRows([row]);
      this.log(`${row.from_me ? "→" : "←"} ${row.remote_jid}: ${String(row.content).slice(0, 60)}`);
      cacheMediaForRow(row).catch((e) => this.log(`erro ao cachear mídia: ${e.message}`));
    } catch (e) {
      this.log(`erro ao gravar: ${e.message}`);
    }
  }

  async saveUpdate(data) {
    const items = Array.isArray(data) ? data : [data];
    for (const u of items) {
      const id = u?.keyId ?? u?.key?.id;
      if (!id || u?.status === undefined) continue;
      const { error } = await supabase
        .from("zap_messages")
        .update({ status: normStatus(u.status) })
        .eq("instance", this.instance)
        .eq("message_id", id);
      if (error) this.log(`erro status: ${error.message}`);
    }
  }

  async pollOnce() {
    try {
      const { records } = await findMessages(this.instance, 1, 30);
      const rows = (records ?? []).map((r) => normalizeUpsert(r, this.instance)).filter(Boolean);
      const n = await upsertRows(rows);
      if (process.env.DEBUG) this.log(`poll: ${n} mensagens sincronizadas`);
      for (const row of rows) cacheMediaForRow(row).catch((e) => this.log(`erro ao cachear mídia: ${e.message}`));
    } catch (e) {
      this.log(`poll falhou: ${e.message}`);
    }
  }

  startPolling() {
    if (this.pollTimer) return;
    this.mode = "polling";
    this.log(`modo POLLING ativo (${POLL_MS}ms). Para tempo real, defina WEBSOCKET_ENABLED=true no Evolution.`);
    this.pollTimer = setInterval(() => this.pollOnce(), POLL_MS);
    this.pollOnce();
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async start() {
    const cfg = await getEvolutionConfig(this.instance);
    if (!cfg.url || !cfg.apikey) {
      this.log(`sem servidor Evolution configurado (nem próprio, nem padrão do .env) — worker parado`);
      return;
    }
    const url = `${cfg.url}/${this.instance}`;
    this.log(`tentando websocket em ${url} ...`);
    this.socket = io(url, { transports: ["websocket"], reconnection: true, reconnectionDelay: 5000 });

    this.socket.on("connect", () => {
      this.wsFailures = 0;
      this.mode = "websocket";
      this.stopPolling();
      this.log(`modo WEBSOCKET ativo (tempo real, id ${this.socket.id})`);
    });
    this.socket.on("disconnect", (r) => {
      this.log(`websocket desconectado: ${r}`);
      this.startPolling();
    });
    this.socket.on("connect_error", () => {
      this.wsFailures++;
      if (this.wsFailures === 2) this.startPolling();
    });
    this.socket.on("messages.upsert", (p) => this.saveUpsert(p?.data ?? p));
    this.socket.on("send.message", (p) => this.saveUpsert(p?.data ?? p));
    this.socket.on("messages.update", (p) => this.saveUpdate(p?.data ?? p));
  }

  stop() {
    this.stopPolling();
    this.socket?.close();
  }
}

// ---------- gerência das contas ----------
const workers = new Map(); // instance -> InstanceWorker

async function syncWorkers() {
  const live = await listLiveInstances();
  const wanted = new Set(live);

  // adiciona workers para instâncias novas
  for (const instance of wanted) {
    if (!workers.has(instance)) {
      const w = new InstanceWorker(instance);
      workers.set(instance, w);
      w.start();
    }
  }
  // remove workers de contas que sumiram
  for (const [instance, w] of workers) {
    if (!wanted.has(instance)) {
      w.stop();
      workers.delete(instance);
      console.log(`[bridge] conta '${instance}' removida — worker parado`);
    }
  }
}

console.log("[bridge] iniciando ponte multi-conta ...");
await syncWorkers();
const accountsTimer = setInterval(syncWorkers, ACCOUNTS_REFRESH_MS);

process.on("SIGINT", () => {
  clearInterval(accountsTimer);
  for (const w of workers.values()) w.stop();
  process.exit(0);
});
