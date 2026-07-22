# ZapMóvel

Suas várias contas de WhatsApp em um só lugar (via Evolution API v2) — Next.js + Supabase Realtime, instalável no celular como PWA. Suporta **múltiplos números ao vivo** e **importação de backups do Android** para não perder conversas de aparelhos formatados.

## Arquitetura

```
Evolution API (N instâncias) ─(websocket/polling)─▶ bridge (multi-conta) ─▶ Supabase (zap_messages)
                                                                               │ Realtime
App Next.js (PWA, caixa unificada) ◀────────────────────────────────────────────┘
App ──POST /api/send {instance}──▶ Evolution REST (apikey só no servidor)
Backup Android (msgstore.db) ──scripts/import-msgstore.mjs──▶ Supabase (conta de arquivo)
```

- Cada número é uma **conta** (`zap_accounts`): `live` (conectada via Evolution/QR) ou `archive` (histórico importado, só leitura). Tudo aparece numa caixa unificada com etiqueta/cor por conta.
- A coluna `instance` de `zap_messages` identifica a conta; a unicidade `(instance, message_id)` isola cada número.
- O webhook do Evolution **continua apontando para o n8n** (bot intacto). O app recebe mensagens pelo bridge.
- `app/api/webhook` existe como alternativa para produção: aponte o webhook do Evolution para ele e defina `WEBHOOK_FORWARD_URL` que o payload é reenviado ao n8n (o bot continua funcionando).

## Para rodar (primeira vez)

1. **Criar as tabelas** — cole [supabase/migration.sql](supabase/migration.sql) e depois [supabase/migration-multi.sql](supabase/migration-multi.sql) no SQL Editor do Supabase e execute.
2. **Anon key** — copie em Dashboard → Settings → API Keys → `anon public` e cole em `.env.local` na variável `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. **Criar seu login**: `node scripts/create-user.mjs seu@email.com SuaSenhaForte`
4. **Importar histórico** (opcional): `npm run backfill` (todas as contas ao vivo; `PAGES=100` para mais histórico)
5. Em dois terminais:
   ```bash
   npm run dev      # interface em http://localhost:3000
   npm run bridge   # sincroniza todas as contas em tempo real
   ```

## Várias contas de WhatsApp

- **Adicionar um número ao vivo:** no app, ícone 👤 → "Adicionar um WhatsApp", escaneie o QR. O bridge detecta a conta nova automaticamente (a cada 30s, sem reiniciar).
- **Importar backup de aparelho antigo:** veja [docs/IMPORTAR-BACKUP.md](docs/IMPORTAR-BACKUP.md) — `npm run import -- ./msgstore.db --instance zap-antigo --media "/caminho/WhatsApp"`.

## Mídia

- **Ver fotos**: as bolhas de imagem/figurinha carregam via `GET /api/media?id=<message_id>`, que busca o base64 no Evolution (`getBase64FromMediaMessage`) e responde com cache imutável. Clique na imagem abre em tela cheia.
- **Enviar fotos**: botão 📎 na conversa. A imagem é comprimida no navegador (máx. 1600px, JPEG 82%) antes do upload — evita o limite de 4,5MB do body na Vercel — e sai via `POST /message/sendMedia` do Evolution. O texto digitado no campo vira legenda.
- Áudio/vídeo/documento aparecem como rótulo (🎤 Áudio etc.) por enquanto.

## Latência

O bridge tenta WebSocket primeiro. Como o servidor Evolution está com `WEBSOCKET_ENABLED=false`, ele cai no **polling a cada 3s** (delay máximo ~3s). Para tempo real instantâneo (<300ms), no Coolify do servidor Evolution defina:

```
WEBSOCKET_ENABLED=true
```

e reinicie o container — o bridge detecta e troca para websocket sozinho.

## No celular

Na mesma rede Wi-Fi: acesse `http://IP_DO_MAC:3000`, faça login e use "Adicionar à tela de início" (vira app). Para usar fora de casa: deploy na Vercel (UI + `/api/*`) e rode o bridge em qualquer VPS (ex.: o mesmo Coolify do Evolution) — ou mude o webhook do Evolution para `https://seuapp.vercel.app/api/webhook` com `WEBHOOK_FORWARD_URL` apontando para o n8n.
