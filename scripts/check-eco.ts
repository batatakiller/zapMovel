// Verifica a assinatura que barra o eco da notificação.
//   node scripts/check-eco.ts
//
// O caso que motivou isto está preservado abaixo: a mesma mensagem saiu com
// 1857 caracteres e voltou pela notificação com 997, sem os asteriscos do
// negrito. A comparação byte a byte não casava as duas e a conversa mostrava a
// mensagem duas vezes, uma verde e uma branca.
import { strict as assert } from "node:assert";
import { assinaturaConteudo } from "../lib/normalize.ts";

const enviada =
  "🎁 *Sua Licença Oficial - SuperSoftware (6x Office 2024 Professional Plus)*  " +
  "👉 *Licença 1/6:*\n• *Acessar Licença:* https://resgatar.supersoftware.info/" +
  "licenca?id=115acb94-3a1c-41c5-a09e-7edb7b6f906e\n• *Comando de Ativação:*\n" +
  "`comando-longo-que-a-notificacao-corta`".padEnd(900, "x");

// como a notificação devolve: sem formatação, quebras viradas espaço e cortada
const eco = enviada.replace(/[*`]/g, "").replace(/\s+/g, " ").slice(0, 997);

assert.equal(
  assinaturaConteudo(enviada),
  assinaturaConteudo(eco),
  "o eco da notificação precisa casar com a mensagem enviada"
);

// Duas licenças diferentes do MESMO modelo não podem ser confundidas — é o
// risco de cortar a comparação num prefixo. Elas divergem no id, lá pelo
// caractere 150, bem antes do corte em 400.
const outraLicenca = enviada.replace("115acb94-3a1c-41c5-a09e-7edb7b6f906e", "1a781bbe-08b7-44f0-af47-a4be413ee5da");
assert.notEqual(
  assinaturaConteudo(enviada),
  assinaturaConteudo(outraLicenca),
  "duas mensagens do mesmo modelo não podem virar a mesma assinatura"
);

// Mensagem curta: a assinatura não pode mudar o que já funcionava.
assert.equal(assinaturaConteudo("  prefere por la?  "), "prefere por la?");
assert.equal(assinaturaConteudo(null), "");

console.log("ok — assinatura casa o eco e separa mensagens distintas");
