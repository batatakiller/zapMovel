// Verifica o desempate por tempo da reconciliação notif↔msgstore.
//   node scripts/check-reconcile.ts
//
// O caso real: a conversa 142542028959971@lid recebeu duas fotos em 20
// segundos. As duas têm o mesmo conteúdo ("📷 Foto"), então competem pela mesma
// chave. Sem o desempate por tempo, a primeira reconciliava e a segunda virava
// linha duplicada — foi assim que 17 fotos duplicaram no banco.
import { strict as assert } from "node:assert";
import { maisProxima } from "../lib/normalize.ts";

const JANELA = 180_000;
const t = (s: string) => new Date(`2026-07-27T${s}Z`).getTime();

// duas provisórias de foto, 20s de diferença
const candidatas = [
  { id: 1, ts: t("19:28:42") },
  { id: 2, ts: t("19:29:02") },
];

// cada mensagem do msgstore casa com a provisória do seu próprio instante,
// mesmo o conteúdo sendo idêntico nas duas
const usadas = new Set<number>();
const primeira = maisProxima(candidatas, t("19:28:42"), usadas, JANELA);
assert.equal(primeira, 1, "a foto das 19:28:42 tem de casar com a provisória dela");
usadas.add(primeira!);

const segunda = maisProxima(candidatas, t("19:29:02"), usadas, JANELA);
assert.equal(segunda, 2, "a segunda foto não pode duplicar — casa com a outra provisória");

// esgotadas as candidatas, uma terceira foto não rouba nenhuma
usadas.add(segunda!);
assert.equal(
  maisProxima(candidatas, t("19:29:10"), usadas, JANELA),
  undefined,
  "sem provisória livre o retorno é undefined, e a linha entra como nova"
);

// desencontro de relógio dentro da janela ainda casa (é a razão do fallback existir)
assert.equal(maisProxima(candidatas, t("19:28:44"), new Set(), JANELA), 1);

// fora da janela, não: a foto de ontem não pode casar com a de hoje
assert.equal(
  maisProxima(candidatas, t("21:00:00"), new Set(), JANELA),
  undefined,
  "fora da janela de 3 min não pode casar"
);

assert.equal(maisProxima(undefined, t("19:28:42"), new Set(), JANELA), undefined);

console.log("ok — reconciliação desempata por tempo e não duplica mídia");
