# Diagnóstico: Mensagens Não São Recebidas/Enviadas

## 1. Verificar Status Geral
Acesse: `http://localhost:3000/api/health`

Isso mostra:
- ✅ Variáveis de ambiente configuradas
- ✅ Conexão com banco de dados (Supabase)
- ✅ Conexão com Evolution API

## 2. Configuração do Arquivo .env.local

Certifique-se de que você tem TODAS estas variáveis definidas:

```
EVOLUTION_URL=https://seu-servidor-evolution.com
EVOLUTION_INSTANCE=super
EVOLUTION_APIKEY=sua-chave-api-aqui
SUPABASE_URL=sua-url-supabase
SUPABASE_SERVICE_ROLE_KEY=sua-chave-secreta
WEBHOOK_FORWARD_URL=https://seu-n8n/webhook/zapmavel  # opcional
```

## 3. Modos de Sincronização

O aplicativo tenta sincronizar mensagens em 3 modos (em ordem de preferência):

### ① WebSocket (Tempo Real - IDEAL)
- Requer: `WEBSOCKET_ENABLED=true` no servidor Evolution
- Comando para rodar: `npm run bridge`
- Se funcionar: você verá "modo WEBSOCKET ativo" no console

### ② Polling (Fallback a cada 3s)
- Ativado automaticamente se WebSocket falhar
- Comando para rodar: `npm run bridge`
- Se funcionar: você verá "modo POLLING ativo" no console

### ③ Webhook (Integração com n8n)
- Recebe eventos do Evolution API
- É automático (precisa apenas de `WEBHOOK_FORWARD_URL`)
- URL deve estar acessível publicamente

## 4. Passos para Resolver

### Opção A: Modo Desenvolvimento (Recomendado)
```bash
# Terminal 1: Dev server
npm run dev

# Terminal 2: Bridge (sincronização em tempo real/polling)
npm run bridge
```

Isso ativa dois modos simultâneos:
- Dev server recebe webhooks
- Bridge sincroniza via WebSocket ou polling

### Opção B: Modo Produção
- Implante no Vercel (Next.js suporta totalmente)
- Configure variáveis de ambiente no Vercel
- O webhook automático funciona sem o bridge

## 5. Checklist de Problemas Comuns

- [ ] Evolution API está rodando? (verifique `EVOLUTION_URL`)
- [ ] Instância existe? (verifique `EVOLUTION_INSTANCE`)
- [ ] Chave API está correta? (verifique `EVOLUTION_APIKEY`)
- [ ] Supabase está acessível? (verifique `SUPABASE_URL`)
- [ ] Tabela `zap_messages` existe? (verifique console do Supabase)
- [ ] Você rodou `npm run bridge`? (necessário para modo desenvolvimento)
- [ ] WebSocket está habilitado? (configure no Evolution API se quiser tempo real)
- [ ] Permissões de firewall/rede estão OK?

## 6. Debugging

### Ver logs do bridge
```bash
DEBUG=1 npm run bridge
```

### Ver logs do Evolution (se disponível)
Verifique console do servidor Evolution API

### Ver registros no banco
```sql
SELECT * FROM zap_messages ORDER BY msg_timestamp DESC LIMIT 10;
```

### Ver eventos webhook
Procure por requisições POST em `/api/webhook` nos logs do Next.js

## 7. Teste Rápido

Envie uma mensagem de teste via curl:

```bash
curl -X POST http://localhost:3000/api/send \
  -H "Content-Type: application/json" \
  -d '{
    "jid": "5521999999999@s.whatsapp.net",
    "text": "Teste"
  }'
```

Se funcionar, você verá um JSON com o ID da mensagem.

---

**Ainda com problemas?** Verifique:
1. `/api/health` para diagnóstico automático
2. Console do navegador (F12) para erros de rede
3. Logs do terminal (npm run dev e npm run bridge)
4. Logs do Supabase (abra o projeto no painel)
