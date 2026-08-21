# ZapMóvel

Caixa unificada para múltiplas contas de WhatsApp via Evolution API v2 (e Android backups) construída em Next.js (App Router) + Supabase Realtime + PWA.

---

## 🗄️ Banco de Dados (Supabase Self-Hosted na VPS)

- **Instância Ativa:** Supabase Self-Hosted no Coolify da VPS (`147.15.99.72`).
- **Gateway Kong:** `http://supabasekong-pegadado.147.15.99.72.sslip.io`
- **Proxy Same-Origin (`/db`):** No navegador, o client (`lib/supabase-browser.ts`) consome via `${window.location.origin}/db`, com rewrite no `next.config.ts`. Isso evita bloqueios de *Mixed Content* (HTTPS ➔ HTTP) na Vercel e celulares.
- **Isolamento:** O ZapMóvel **NÃO** usa mais o Supabase Cloud para não estourar o limite de Egress e Storage da Central Automática de Vendas.
- **Doc completa:** Ver [`docs/BANCO-DADOS-VPS.md`](docs/BANCO-DADOS-VPS.md).

---

## 🔐 Autenticação (Supabase Auth / GoTrue)

- Login por e-mail e senha gerenciado pelo Supabase Auth na VPS.
- Usuário principal: `danielpclandia@gmail.com`.
- Gerenciar usuários: `node scripts/create-user.mjs email@exemplo.com Senha`.

---

## 🚀 Produção e Deploy (VPS Coolify)

- **URL Oficial de Produção:** `https://zapmovel.supersoftware.info`
- **Ambiente:** VPS Oracle (`147.15.99.72`), Coolify (Projeto `SuperSoftware`, aplicação `zapmovel`).
- **Deploy:** Deploy automático via `git push origin main` (ou via API/painel do Coolify).
- **Vercel:** Desativada permanentemente em favor do deploy local full-stack na VPS.
