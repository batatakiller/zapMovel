# ZapMóvel

Suas várias contas de WhatsApp em um só lugar (via Evolution API v2) — Next.js + Supabase Realtime (Self-Hosted na VPS), instalável no celular como PWA. Suporta **múltiplos números ao vivo** e **importação de backups do Android** para não perder conversas de aparelhos formatados.

## Arquitetura

```
Evolution API (N instâncias) ─(websocket/polling)─▶ bridge (multi-conta) ─▶ Supabase VPS (zap_messages)
                                                                               │ Realtime
App Next.js (PWA, caixa unificada) ◀───────────────────────────────────────────┘
App ──POST /api/send {instance}──▶ Evolution REST (apikey só no servidor)
Backup Android (msgstore.db) ──scripts/import-msgstore.mjs──▶ Supabase VPS (conta de arquivo)
```

- Cada número é uma **conta** (`zap_accounts`): `live` (conectada via Evolution/QR) ou `archive` (histórico importado, só leitura). Tudo aparece numa caixa unificada com etiqueta/cor por conta.
- O banco de dados roda em uma instância **Supabase Self-Hosted na VPS** (`147.15.99.72`), garantindo tráfego e armazenamento ilimitados para o histórico de conversas.
- Veja a documentação detalhada da infraestrutura em [docs/BANCO-DADOS-VPS.md](docs/BANCO-DADOS-VPS.md).

## Para rodar (Desenvolvimento Local)

1. **Variáveis de ambiente** — configure em `.env.local` as chaves do Supabase VPS e da Evolution API (veja [docs/BANCO-DADOS-VPS.md](docs/BANCO-DADOS-VPS.md)).
2. **Criar login de usuário** (se necessário):
   ```bash
   node scripts/create-user.mjs seu@email.com SuaSenhaForte
   ```
3. Em dois terminais:
   ```bash
   npm run dev      # interface em http://localhost:3000
   npm run bridge   # sincroniza todas as contas em tempo real
   ```

## Várias contas de WhatsApp

- **Adicionar um número ao vivo:** no app, ícone 👤 → "Adicionar um WhatsApp", escaneie o QR. O bridge detecta a conta nova automaticamente (a cada 30s, sem reiniciar).
- **Importar backup de aparelho antigo:** veja [docs/IMPORTAR-BACKUP.md](docs/IMPORTAR-BACKUP.md) — `npm run import -- ./msgstore.db --instance zap-antigo --media "/caminho/WhatsApp"`.
- **Número em outro servidor Evolution:** por padrão toda conta usa o servidor Evolution do `.env.local`. Se um número específico mora em outro servidor (outra VPS/Coolify), abra "⚙️ Avançado" no formulário de criação (ou o ✏️ de uma conta já criada) e informe a URL + apikey daquele servidor — fica salvo só no banco, nunca exposto ao navegador.
- **Conta cujo webhook já aponta para outro bot (n8n etc.):** veja [docs/BRIDGE-COOLIFY.md](docs/BRIDGE-COOLIFY.md). Ele sincroniza via WebSocket/polling sem tocar em nenhum webhook existente.

## Mídia

- **Ver fotos**: as bolhas de imagem/figurinha carregam via `GET /api/media?id=<message_id>`, que busca o base64 no Evolution (`getBase64FromMediaMessage`) e responde com cache imutável. Clique na imagem abre em tela cheia.
- **Enviar fotos**: botão 📎 na conversa. A imagem é comprimida no navegador (máx. 1600px, JPEG 82%) antes do upload — evita o limite de 4,5MB do body na Vercel — e sai via `POST /message/sendMedia` do Evolution. O texto digitado no campo vira legenda.
- Áudio/vídeo/documento aparecem como rótulo (🎤 Áudio etc.) por enquanto.

## No celular / PWA

Acesse `https://zapmovel.vercel.app`, faça login e use "Adicionar à tela de início" (vira app com notificações e suporte a PWA).
