# ZapMóvel

WhatsApp pessoal via Evolution API v2 (instância `super`) — Next.js + Supabase Realtime, instalável no celular como PWA.

## Arquitetura

```
Evolution API ──(websocket OU polling)──▶ bridge (scripts/bridge.mjs) ──▶ Supabase (zap_messages)
                                                                              │ Realtime
App Next.js (PWA) ◀───────────────────────────────────────────────────────────┘
App ──POST /api/send──▶ Evolution REST (apikey só no servidor)
```

- O webhook do Evolution **continua apontando para o n8n** (bot intacto). O app recebe mensagens pelo bridge.
- `app/api/webhook` existe como alternativa para produção: aponte o webhook do Evolution para ele e defina `WEBHOOK_FORWARD_URL` que o payload é reenviado ao n8n (o bot continua funcionando).

## Para rodar (primeira vez)

1. **Criar a tabela** — cole [supabase/migration.sql](supabase/migration.sql) no SQL Editor do Supabase e execute.
2. **Anon key** — copie em Dashboard → Settings → API Keys → `anon public` e cole em `.env.local` na variável `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. **Criar seu login**: `node scripts/create-user.mjs seu@email.com SuaSenhaForte`
4. **Importar histórico** (opcional): `npm run backfill` (usa `PAGES=100` para mais histórico)
5. Em dois terminais:
   ```bash
   npm run dev      # interface em http://localhost:3000
   npm run bridge   # sincroniza mensagens em tempo real
   ```

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
