# Bridge como serviço persistente no Coolify

O app em si (Next.js) roda na Vercel, mas a Vercel é serverless — não dá para
manter uma conexão WebSocket ou um loop de polling rodando o tempo todo lá.
Por isso, contas cujo webhook do Evolution já aponta para outro lugar (ex.:
um bot de negócio em produção) não chegam ao ZapMóvel automaticamente.

Solução: rodar `scripts/bridge.mjs` como um serviço à parte, sempre ligado,
no mesmo VPS/Coolify que já hospeda o servidor Evolution. Ele **não mexe em
nenhum webhook** — descobre sozinho todas as contas `live` cadastradas em
`zap_accounts` (a cada 30s) e sincroniza cada uma via WebSocket (se o
Evolution tiver `WEBSOCKET_ENABLED=true`) ou polling a cada 3s (senão).

## 1. Criar o serviço no Coolify

1. **New Resource → Application → Public/Private Git Repository** e aponte
   para este repositório (`github.com/batatakiller/zapMovel`), branch `main`.
2. **Build Pack:** escolha **Dockerfile**. No campo do nome/caminho do
   Dockerfile, informe `Dockerfile.bridge` (não é o Dockerfile padrão — é um
   arquivo à parte, só para este serviço; o app principal continua na Vercel).
3. **Portas:** este serviço não expõe HTTP nenhum (é só um worker em segundo
   plano) — desative healthcheck de porta/HTTP se o Coolify pedir, ou marque
   como "sem porta exposta".

## 2. Variáveis de ambiente

Configure exatamente as mesmas do `.env.local` do projeto (Settings →
Environment Variables no Coolify):

| Variável | Obrigatória | Valor |
|---|:-:|---|
| `SUPABASE_URL` | sim | mesma do projeto |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | mesma do projeto |
| `EVOLUTION_URL` | sim | servidor Evolution padrão (sem barra no final) |
| `EVOLUTION_APIKEY` | sim | apikey padrão |
| `EVOLUTION_INSTANCE` | não | `super` (usado só se `zap_accounts` estiver vazia) |
| `POLL_MS` | não | intervalo do polling em ms (padrão 3000) |
| `ACCOUNTS_REFRESH_MS` | não | com que frequência relê `zap_accounts` (padrão 30000) |
| `DEBUG` | não | `1` para logar cada ciclo de polling |

Contas com servidor Evolution próprio (definido na tela ✏️ editar de cada
conta no app) são detectadas automaticamente — não precisa configurar nada
extra aqui para elas.

## 3. Deploy e verificação

Após o deploy, veja os logs do serviço no Coolify. Você deve ver, para cada
conta cadastrada:

```
[bridge] iniciando ponte multi-conta ...
[bridge:super] modo POLLING ativo (3000ms). ...
[bridge:AJU] modo POLLING ativo (3000ms). ...
[bridge:11991234443] modo POLLING ativo (3000ms). ...
```

(ou `modo WEBSOCKET ativo`, se `WEBSOCKET_ENABLED=true` no servidor Evolution
correspondente).

Adicionar um WhatsApp novo pelo app **não exige redeploy** — o serviço relê
`zap_accounts` a cada 30s e passa a sincronizar a conta nova sozinho.

## Isso conflita com o webhook que já existe (ex.: `super` → ZapMóvel, `AJU` →
n8n)?

Não. O bridge só *lê* do Evolution e grava em `zap_messages` com `upsert` por
`(instance, message_id)` — rodar bridge e webhook ao mesmo tempo para a
mesma conta é seguro e idempotente, não duplica nada. Os bots de negócio que
já usam webhook (evoaju, oftalmos) continuam funcionando exatamente como
antes, sem nenhuma alteração.
