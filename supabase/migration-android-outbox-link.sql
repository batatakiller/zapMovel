-- ZapMóvel — liga a bolha otimista ao item da fila de saída
-- Cole no SQL Editor do Supabase e execute. Idempotente.

-- Quando você envia por uma conta 'android', a mensagem entra na fila e uma
-- linha aparece na conversa na hora, como 'pending'. Esta coluna é o que
-- permite marcar essa linha como enviada quando o aparelho confirma.
alter table public.zap_messages
  add column if not exists outbox_id bigint;

create index if not exists zap_messages_outbox
  on public.zap_messages (outbox_id)
  where outbox_id is not null;
