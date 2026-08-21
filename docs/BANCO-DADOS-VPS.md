# Banco de Dados Self-Hosted (Supabase na VPS)

Documentação da migração do banco de dados do **ZapMóvel** para a VPS própria.

---

## 📌 Contexto e Motivação

O **ZapMóvel** anteriormente compartilhava o projeto no **Supabase Cloud** com a Central Automática de Vendas.
Devido ao alto volume de tráfego gerado pelo WhatsApp (mais de 26.000 mensagens em `zap_messages`, sincronização de mídias e conexões WebSocket via **Supabase Realtime**), o plano Free do Supabase Cloud atingia frequentemente os limites de **Egress (5 GB)** e **Armazenamento (500 MB)**.

Em **21/ago/2026**, o banco do ZapMóvel foi isolado e migrado para a instância **Supabase Self-Hosted** que roda na VPS (`147.15.99.72`).

---

## 🏗️ Arquitetura Atual

* **VPS (147.15.99.72):**
  * **Evolution API:** Roda localmente na VPS (`api-nw0kw8so8408c8goks0soocs`).
  * **Supabase Self-Hosted (Docker/Coolify):**
    * Postgres: `supabase-db-fqvwullaljkovvbzdbwckfci` (porta interna 5432)
    * API Gateway (Kong): `http://supabasekong-pegadado.147.15.99.72.sslip.io`
    * Realtime, GoTrue Auth, PostgREST e Studio integrados.
* **Frontend / App (Coolify VPS):**
  * Deploy de produção: `https://zapmovel.supersoftware.info` (Projeto `SuperSoftware`, container `zapmovel`).
  * Proxy `/db`: Configurado no `next.config.ts` para redirecionar chamadas do navegador (`/db/*`) para o Kong na VPS, evitando bloqueios de *Mixed Content* (HTTPS ➔ HTTP).

---

## 🔑 Variáveis de Ambiente (`.env.local` e Vercel)

```env
# Evolution API (VPS)
EVOLUTION_URL=http://evo-nw0kw8so8408c8goks0soocs.147.15.99.72.sslip.io
EVOLUTION_INSTANCE=super
EVOLUTION_APIKEY=309252D9473C-46A0-8EE0-BD368E42810B

# Supabase Servidor (VPS)
SUPABASE_URL=http://supabasekong-pegadado.147.15.99.72.sslip.io
SUPABASE_SERVICE_ROLE_KEY=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc4NzE3NjA4MCwiZXhwIjo0OTQyODQ5NjgwLCJyb2xlIjoic2VydmljZV9yb2xlIn0.mCJPOXKtAqSjFlQwcToyAPKw45Ub5TXPdFc3FnQry6E

# Supabase Navegador (VPS)
NEXT_PUBLIC_SUPABASE_URL=http://supabasekong-pegadado.147.15.99.72.sslip.io
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc4NzE3NjA4MCwiZXhwIjo0OTQyODQ5NjgwLCJyb2xlIjoiYW5vbiJ9.HgNFXLvozGS0Yecyhas2NLANY0gYBz57AbAxQckuBcI

# Webhook Forward (n8n)
WEBHOOK_FORWARD_URL=https://n8n.supersoftware.info/webhook/superbot
```

---

## 🔒 Autenticação (Supabase Auth / GoTrue)

A autenticação do app utiliza o GoTrue da instância Supabase na VPS:
* **Usuário Admin:** `danielpclandia@gmail.com`
* **Criar/Resetar Usuários via CLI:**
  ```bash
  node scripts/create-user.mjs email@exemplo.com NovaSenha123
  ```
* **Alterar senha de usuário existente via Node:**
  ```javascript
  import { supabase } from "./scripts/evo-common.mjs";
  await supabase.auth.admin.updateUserById("USER_ID", { password: "NovaSenha" });
  ```

---

## 📦 Tabelas no Banco da VPS

* `public.zap_accounts`: Cadastro das contas de WhatsApp (instâncias Evolution e Android).
* `public.zap_messages`: Histórico unificado de mensagens com suporte a Realtime.
* `public.zap_quick_replies`: Modelos de respostas rápidas (`/atalho`).
* `public.zap_reactions`: Reações com emoji por mensagem.
* `public.push_subscriptions`: Inscrições de Web Push dos navegadores/PWA.
* `public.zap_account_secrets`: URLs e API Keys customizadas por conta.
* `public.zap_outbox` / `public.zap_jid_map`: Filas e mapeamentos para transporte Android.
