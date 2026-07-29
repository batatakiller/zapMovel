import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToAll } from "./push";
import { assinaturaConteudo, jidToLabel, maisProxima } from "./normalize";

// Uma mensagem vinda do aparelho. Duas origens a produzem:
//   'msgstore' — scripts/android/sync_msgstore.py, a fonte de verdade
//   'notif'    — o app companion lendo a notificação, rápido e provisório
export type AndroidMessage = {
  instance: string;
  remote_jid: string;
  message_id: string;
  from_me: boolean;
  push_name: string | null;
  type: string;
  content: string | null;
  status: string;
  msg_timestamp: number; // epoch em milissegundos
  quoted_message_id: string | null;
  dedupe_key: string;
  origin: "msgstore" | "notif";
  media_path: string | null;
  mime_type: string | null;
  sender_jid: string | null;
  phone: string | null; // só existe quando o contato está na agenda do aparelho
  is_group: boolean;
};

export type IngestResult = {
  received: number;
  inserted: number;
  reconciled: number; // linhas provisórias da notificação corrigidas
  updated: number; // linhas que já existiam com o id real
  jids: number;
};

// A camada de notificação grava a mensagem em segundos, mas sem o id real do
// WhatsApp — ela inventa um id sintético e guarda a dedupe_key. Quando o
// msgstore chega com a verdade, precisamos ATUALIZAR aquela linha em vez de
// inserir uma nova, senão cada mensagem apareceria duas vezes na conversa.
export async function normalizeAndroidBatch(
  db: SupabaseClient,
  messages: AndroidMessage[]
): Promise<IngestResult> {
  const instance = messages[0].instance;
  // um lote nunca deve misturar contas — a reconciliação abaixo assume uma só
  if (messages.some((m) => m.instance !== instance)) {
    throw new Error("um lote deve conter mensagens de uma única instância");
  }

  // Um upsert não pode tocar a mesma linha duas vezes: se o lote trouxer o
  // mesmo message_id repetido, o Postgres rejeita a instrução inteira. A última
  // ocorrência vence — num lote ordenado por _id, é a mais recente.
  const porId = new Map<string, AndroidMessage>();
  for (const m of messages) porId.set(m.message_id, m);
  messages = [...porId.values()];

  // A notificação é provisória por natureza: ela chega em segundos, mas sem id
  // real, sem mídia e sem citação. Se a mensagem já está no banco — não importa
  // por qual origem — a versão de lá é igual ou melhor, e sobrescrevê-la seria
  // uma regressão. Então o fluxo da notificação só INSERE o que falta.
  if (messages[0].origin === "notif") {
    return ingestNotif(db, instance, messages);
  }

  const messageIds = [...new Set(messages.map((m) => m.message_id))];
  const dedupeKeys = [...new Set(messages.map((m) => m.dedupe_key).filter(Boolean))];

  // Quem já está no banco com o id real? (sync rodou de novo sobre o mesmo trecho)
  const existing = await selectIn<{ message_id: string }>(
    db,
    "message_id",
    messageIds,
    (q) => q.select("message_id").eq("instance", instance),
    "consulta de existentes"
  );
  const alreadyReal = new Set(existing.map((r) => r.message_id));

  // Quais linhas provisórias da notificação correspondem a este lote?
  const provisional = await selectIn<{ id: number; dedupe_key: string | null }>(
    db,
    "dedupe_key",
    dedupeKeys,
    (q) => q.select("id,dedupe_key").eq("instance", instance).eq("origin", "notif"),
    "consulta de provisórias"
  );

  const notifRowByKey = new Map<string, number>();
  for (const r of provisional) {
    // se houver mais de uma provisória com a mesma chave, a primeira ganha e a
    // outra permanece — some no próximo ciclo, quando sua própria chave casar
    if (r.dedupe_key && !notifRowByKey.has(r.dedupe_key)) notifRowByKey.set(r.dedupe_key, r.id);
  }

  // Rede de segurança para o timestamp. A dedupe_key trunca no segundo, então
  // basta a notificação e o msgstore discordarem em 1 segundo — ou a bolha
  // otimista ter sido criada antes do WhatsApp de fato enviar — para as chaves
  // não baterem e a mensagem duplicar. Aqui procuramos a provisória pelo
  // conteúdo dentro de uma janela de tempo, que é robusto a esse desencontro.
  const semChave = messages.filter(
    (m) => !m.dedupe_key || !notifRowByKey.has(m.dedupe_key)
  );
  // Cada chave guarda TODAS as provisórias com aquele conteúdo, com o instante
  // de cada uma. Guardar só a primeira não funciona para mídia: o conteúdo ali
  // é sempre o mesmo rótulo ("📷 Foto"), então dez fotos de uma conversa caem
  // na mesma chave — uma reconciliava e as outras nove viravam linha duplicada.
  const JANELA = 180_000; // 3 minutos
  const porConteudo = new Map<string, { id: number; ts: number }[]>();
  if (semChave.length) {
    const jids = [...new Set(semChave.map((m) => m.remote_jid))];
    const instantes = semChave.map((m) => m.msg_timestamp);
    const { data: candidatas } = await db
      .from("zap_messages")
      .select("id,remote_jid,from_me,content,msg_timestamp")
      .eq("instance", instance)
      .eq("origin", "notif")
      .in("remote_jid", jids.slice(0, 100))
      .gte("msg_timestamp", new Date(Math.min(...instantes) - JANELA).toISOString())
      .lte("msg_timestamp", new Date(Math.max(...instantes) + JANELA).toISOString());

    for (const c of candidatas ?? []) {
      // mesma assinatura do eco: a linha provisória guarda o texto como a
      // notificação o entregou, sem formatação e possivelmente cortado, e o
      // msgstore guarda o original — comparar cru nunca casava as duas
      const chave = `${c.remote_jid}|${c.from_me}|${assinaturaConteudo(c.content)}`;
      const lista = porConteudo.get(chave);
      const item = { id: c.id, ts: new Date(c.msg_timestamp).getTime() };
      if (lista) lista.push(item);
      else porConteudo.set(chave, [item]);
    }
  }

  const acharProvisoria = (m: AndroidMessage, usadas: Set<number>) =>
    maisProxima(
      porConteudo.get(`${m.remote_jid}|${m.from_me}|${assinaturaConteudo(m.content)}`),
      m.msg_timestamp,
      usadas,
      JANELA
    );

  const toReconcile: { id: number; row: ReturnType<typeof toRow> }[] = [];
  const toUpsert: Record<string, unknown>[] = []; // upsert por (instance, message_id)
  const usedNotifRows = new Set<number>();

  for (const m of messages) {
    const row = toRow(m);
    // primeiro a chave exata; se ela não casar, cai na busca por conteúdo
    const notifId =
      (m.dedupe_key ? notifRowByKey.get(m.dedupe_key) : undefined) ??
      acharProvisoria(m, usedNotifRows);

    // Só reconcilia se o id real ainda não existir — do contrário o UPDATE
    // colidiria com a unicidade (instance, message_id).
    if (notifId !== undefined && !alreadyReal.has(m.message_id) && !usedNotifRows.has(notifId)) {
      usedNotifRows.add(notifId);
      toReconcile.push({ id: notifId, row });
    } else {
      toUpsert.push(row);
    }
  }

  // Precisa ser UPDATE, e não upsert: `id` é GENERATED ALWAYS, então o
  // INSERT ... ON CONFLICT do PostgREST é rejeitado ao receber um id explícito.
  // Atualizar no lugar (em vez de apagar e reinserir) mantém a linha estável
  // para o Realtime — a bolha na conversa é corrigida sem sumir e voltar.
  if (toReconcile.length) {
    // A linha provisória pode já ter o arquivo no bucket (a notificação sobe a
    // mídia na hora). O raw do msgstore não conhece esse campo, então
    // sobrescrevê-lo cegamente apagaria a referência e a foto sumiria da
    // conversa. Por isso o raw anterior é preservado por baixo do novo.
    const ids = toReconcile.map((r) => r.id);
    const anteriores = new Map<number, Record<string, unknown>>();
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { data } = await db
        .from("zap_messages")
        .select("id,raw")
        .in("id", ids.slice(i, i + IN_CHUNK));
      for (const r of data ?? []) anteriores.set(r.id, (r.raw as Record<string, unknown>) ?? {});
    }

    const CONCURRENCY = 8;
    for (let i = 0; i < toReconcile.length; i += CONCURRENCY) {
      const results = await Promise.all(
        toReconcile.slice(i, i + CONCURRENCY).map(({ id, row }) => {
          const antigo = anteriores.get(id) ?? {};
          const mesclado = { ...antigo, ...((row.raw as object) ?? {}) };
          // media_stored só existe no antigo; não deixar o novo apagá-lo
          if (antigo.media_stored) mesclado.media_stored = antigo.media_stored;
          return db.from("zap_messages").update({ ...row, raw: mesclado }).eq("id", id);
        })
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(`reconciliação: ${failed.error.message}`);
    }
  }
  if (toUpsert.length) {
    const { error } = await db
      .from("zap_messages")
      .upsert(toUpsert, { onConflict: "instance,message_id", ignoreDuplicates: false });
    if (error) throw new Error(`upsert zap_messages: ${error.message}`);
  }

  const jids = await upsertJidMap(db, instance, messages);

  return {
    received: messages.length,
    inserted: toUpsert.filter((r) => !alreadyReal.has(r.message_id as string)).length,
    updated: toUpsert.filter((r) => alreadyReal.has(r.message_id as string)).length,
    reconciled: toReconcile.length,
    jids,
  };
}

// Grava o que a notificação viu, sem nunca pisar no que já existe. A chave é a
// dedupe_key: se ela já aparece no banco, a mensagem já foi registrada (pela
// própria notificação antes, ou pelo msgstore) e não há nada a fazer.
async function ingestNotif(
  db: SupabaseClient,
  instance: string,
  messages: AndroidMessage[]
): Promise<IngestResult> {
  const dedupeKeys = [...new Set(messages.map((m) => m.dedupe_key).filter(Boolean))];

  const existentes = await selectIn<{ id: number; dedupe_key: string | null; type: string }>(
    db,
    "dedupe_key",
    dedupeKeys,
    (q) => q.select("id,dedupe_key,type").eq("instance", instance),
    "consulta de dedupe"
  );
  const jaExiste = new Map(existentes.map((r) => [r.dedupe_key, r]));

  // Rede de segurança contra o eco: depois de responder pelo ZapMóvel, o
  // WhatsApp reescreve a notificação incluindo a mensagem que VOCÊ mandou, e
  // ela chega aqui marcada como recebida — a conversa mostrava tudo duas vezes.
  // O agente já filtra isso, mas quem depende de uma versão antiga do app não
  // deve poluir o histórico.
  const recebidas = messages.filter((m) => !m.from_me);
  const ecos = new Set<string>();
  if (recebidas.length) {
    const JANELA = 10 * 60_000;
    const instantes = recebidas.map((m) => m.msg_timestamp);
    const { data: enviadas } = await db
      .from("zap_messages")
      .select("remote_jid,content")
      .eq("instance", instance)
      .eq("from_me", true)
      .gte("msg_timestamp", new Date(Math.min(...instantes) - JANELA).toISOString())
      .lte("msg_timestamp", new Date(Math.max(...instantes) + JANELA).toISOString());

    const minhas = new Set(
      (enviadas ?? []).map((r) => `${r.remote_jid}|${assinaturaConteudo(r.content)}`)
    );
    for (const m of recebidas) {
      if (minhas.has(`${m.remote_jid}|${assinaturaConteudo(m.content)}`)) ecos.add(m.dedupe_key);
    }
  }

  const novas = messages.filter((m) => !jaExiste.has(m.dedupe_key) && !ecos.has(m.dedupe_key));
  if (novas.length) {
    const { error } = await db
      .from("zap_messages")
      .upsert(novas.map(toRow), { onConflict: "instance,message_id", ignoreDuplicates: true });
    if (error) throw new Error(`insert notif: ${error.message}`);
  }

  // A notificação de uma foto chega duas vezes: primeiro sem a mídia (ainda
  // baixando) e depois com ela. Como as duas têm a mesma dedupe_key, a segunda
  // seria descartada e a imagem se perderia — a mensagem ficaria como texto
  // para sempre. Aqui promovemos a linha ao tipo certo quando a mídia aparece.
  const promover = messages.filter((m) => {
    const anterior = jaExiste.get(m.dedupe_key);
    return anterior && anterior.type === "text" && m.type !== "text";
  });
  for (const m of promover) {
    const anterior = jaExiste.get(m.dedupe_key)!;
    const { error } = await db
      .from("zap_messages")
      .update({ type: m.type, content: m.content })
      .eq("id", anterior.id);
    if (error) throw new Error(`promover mídia: ${error.message}`);
  }

  // Avisa os aparelhos. Só aqui, no caminho da notificação: é a camada que
  // chega em segundos. O msgstore vem depois, com mensagem que você já viu —
  // notificar de novo seria repetir um aviso velho.
  await Promise.all(
    novas
      .filter((m) => !m.from_me)
      .map((m) =>
        sendPushToAll({
          title: m.push_name || jidToLabel(m.remote_jid),
          body: m.content ?? "Nova mensagem",
          jid: m.remote_jid,
          instance: m.instance,
        }).catch((e) => console.error("push:", e?.message))
      )
  );

  const jids = await upsertJidMap(db, instance, messages);
  return {
    received: messages.length,
    inserted: novas.length,
    updated: 0,
    reconciled: 0,
    jids,
  };
}

// O PostgREST serializa `.in()` na URL. Com um lote de 500 chaves de 40 chars a
// URL passa de 20 KB e a requisição é recusada antes de chegar ao banco — o
// sintoma é um "fetch failed" que não parece ter nada a ver com o tamanho.
// Fatiar mantém cada URL pequena, ao custo de algumas idas a mais.
const IN_CHUNK = 100;

async function selectIn<T>(
  db: SupabaseClient,
  column: string,
  values: string[],
  build: (q: any) => any,
  contexto: string
): Promise<T[]> {
  if (!values.length) return [];
  const out: T[] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const { data, error } = await build(db.from("zap_messages")).in(
      column,
      values.slice(i, i + IN_CHUNK)
    );
    if (error) throw new Error(`${contexto}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

function toRow(m: AndroidMessage) {
  // 85% das mensagens são texto puro, e para elas o raw seria só um punhado de
  // nulos — em 650 mil linhas isso vira dezenas de MB à toa. Só guardamos raw
  // quando há algo de fato a guardar.
  const raw =
    m.media_path || m.sender_jid || m.is_group
      ? {
          media_path: m.media_path,
          mime_type: m.mime_type,
          sender_jid: m.sender_jid,
          is_group: m.is_group,
        }
      : null;

  return {
    instance: m.instance,
    remote_jid: m.remote_jid,
    message_id: m.message_id,
    from_me: m.from_me,
    push_name: m.push_name,
    type: m.type,
    content: m.content,
    status: m.status,
    msg_timestamp: new Date(m.msg_timestamp || Date.now()).toISOString(),
    quoted_message_id: m.quoted_message_id,
    origin: m.origin,
    dedupe_key: m.dedupe_key,
    // media_path/mime_type ficam no raw: é o que o passo de upload de mídia usa
    // para achar o arquivo em /sdcard e mandar para o bucket chat_media
    raw,
  };
}

// Acumula o que se sabe sobre cada conversa LID. O telefone e o nome vêm da
// wa_address_book do aparelho, que é o único lugar onde o vínculo LID↔telefone
// sobreviveu — mas ela só cobre quem está salvo na agenda (~30-45% das
// conversas ativas). Para o resto, phone/nome ficam nulos até a notificação ou
// a tela do chat preencherem.
async function upsertJidMap(
  db: SupabaseClient,
  instance: string,
  messages: AndroidMessage[]
): Promise<number> {
  const origem = messages[0].origin; // registra de onde o nome/telefone veio
  type Info = { display_name: string | null; phone: string | null };
  const byLid = new Map<string, Info>();

  for (const m of messages) {
    if (!m.remote_jid.endsWith("@lid")) continue;
    const prev = byLid.get(m.remote_jid);
    // dentro do lote, o que tem informação vence o que não tem
    byLid.set(m.remote_jid, {
      display_name: m.push_name ?? prev?.display_name ?? null,
      phone: m.phone ?? prev?.phone ?? null,
    });
  }
  if (!byLid.size) return 0;

  const rows = [...byLid].map(([lid, v]) => ({
    instance,
    lid,
    display_name: v.display_name,
    phone: v.phone,
    // o jid completo só faz sentido quando temos o número
    jid: v.phone ? `${onlyDigits(v.phone)}@s.whatsapp.net` : null,
    source: origem,
    updated_at: new Date().toISOString(),
  }));

  // Sobrescrever com nulo apagaria um nome/telefone já descoberto antes, então
  // só quem traz informação faz update; o resto apenas registra o LID se ainda
  // não existir, para a conversa constar no mapa.
  const comDados = rows.filter((r) => r.display_name || r.phone);
  const semDados = rows.filter((r) => !r.display_name && !r.phone);

  if (comDados.length) {
    const { error } = await db.from("zap_jid_map").upsert(comDados, { onConflict: "instance,lid" });
    if (error) throw new Error(`upsert zap_jid_map: ${error.message}`);
  }
  if (semDados.length) {
    const { error } = await db
      .from("zap_jid_map")
      .upsert(semDados, { onConflict: "instance,lid", ignoreDuplicates: true });
    if (error) throw new Error(`insert zap_jid_map: ${error.message}`);
  }
  return rows.length;
}

// A agenda guarda o número como o usuário digitou ("+55 11 95410-2891",
// "11954102891"). O jid do WhatsApp só aceita dígitos.
function onlyDigits(s: string) {
  return s.replace(/\D/g, "");
}
