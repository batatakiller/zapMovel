-- ZapMóvel — transporte via aparelho Android (WhatsApp Business no tablet)
-- Cole este arquivo inteiro no SQL Editor do Supabase e execute.
-- É seguro rodar em cima do banco já existente (idempotente).
--
-- Contexto: mensagens passam a chegar por duas camadas de confiança diferentes.
--   1) notificação do Android  -> tempo real, mas sem id real do WhatsApp e sem
--      o telefone (o WhatsApp só expõe um identificador '<n>@lid').
--   2) msgstore.db do aparelho -> a verdade: id real, citação, status, telefone.
-- A camada 2 corrige as linhas da camada 1 em vez de duplicá-las.

-- 1) Procedência das mensagens -----------------------------------------------
alter table public.zap_messages
  add column if not exists origin     text not null default 'evolution',
  add column if not exists dedupe_key text;

comment on column public.zap_messages.origin is
  'evolution | notif (provisório, veio da notificação) | msgstore (definitivo, veio do backup)';
comment on column public.zap_messages.dedupe_key is
  'sha1(instance|jid|epoch_s|from_me|texto) — casa a linha provisória com a definitiva';

-- a reconciliação procura por (instance, remote_jid, dedupe_key)
create index if not exists zap_messages_dedupe
  on public.zap_messages (instance, remote_jid, dedupe_key)
  where dedupe_key is not null;

-- ...e varre as provisórias pendentes de correção
create index if not exists zap_messages_origin_ts
  on public.zap_messages (instance, origin, msg_timestamp desc)
  where origin = 'notif';

-- 2) Mapa lid -> telefone ----------------------------------------------------
-- A notificação entrega '209311070421082@lid', que identifica a conversa mas não
-- o número. Sem esta tradução dá para responder (Direct Reply), mas não para
-- iniciar conversa nem casar com o histórico vindo do Evolution.
create table if not exists public.zap_jid_map (
  instance     text not null,
  lid          text not null,                    -- 209311070421082@lid
  jid          text,                             -- 5548984371469@s.whatsapp.net
  phone        text,
  display_name text,
  source       text not null default 'msgstore', -- msgstore | notif | manual
  updated_at   timestamptz not null default now(),
  primary key (instance, lid)
);

create index if not exists zap_jid_map_jid on public.zap_jid_map (instance, jid);

alter table public.zap_jid_map enable row level security;
drop policy if exists "authenticated read jid_map" on public.zap_jid_map;
create policy "authenticated read jid_map" on public.zap_jid_map
  for select to authenticated using (true);

-- 3) Fila de saída -----------------------------------------------------------
-- O tablet não recebe requisição: ele puxa. /api/send enfileira aqui e o agente
-- no aparelho consome. Também é onde mora o throttle — envio em rajada é o que
-- mais chama atenção do WhatsApp.
create table if not exists public.zap_outbox (
  id          bigint generated always as identity primary key,
  instance    text not null,
  remote_jid  text not null,                 -- aceita '<n>@lid' ou jid normal
  kind        text not null default 'text',  -- text | media
  content     text,
  media_path  text,                          -- caminho no bucket chat_media
  caption     text,
  status      text not null default 'queued',-- queued | sending | sent | failed
  attempts    int  not null default 0,
  claimed_at  timestamptz,
  sent_at     timestamptz,
  message_id  text,                          -- id real, quando o agente confirmar
  error       text,
  created_at  timestamptz not null default now()
);

-- fila por conta, mais antigo primeiro
create index if not exists zap_outbox_pending
  on public.zap_outbox (instance, created_at)
  where status in ('queued', 'sending');

alter table public.zap_outbox enable row level security;
drop policy if exists "authenticated read outbox" on public.zap_outbox;
create policy "authenticated read outbox" on public.zap_outbox
  for select to authenticated using (true);

do $$
begin
  alter publication supabase_realtime add table public.zap_outbox;
exception when duplicate_object then null;
end $$;

-- Reserva atômica: dois agentes (ou duas chamadas do mesmo) nunca pegam a mesma
-- linha. 'skip locked' faz o concorrente pular em vez de esperar.
create or replace function public.zap_outbox_claim(p_instance text, p_limit int default 1)
returns setof public.zap_outbox
language sql
security definer
set search_path = public
as $$
  update public.zap_outbox o
     set status     = 'sending',
         claimed_at = now(),
         attempts   = o.attempts + 1
   where o.id in (
     select id from public.zap_outbox
      where instance = p_instance
        and (status = 'queued'
             -- devolve à fila o que travou em 'sending' há mais de 5 min
             or (status = 'sending' and claimed_at < now() - interval '5 minutes'))
        and attempts < 5
      order by created_at
      limit p_limit
      for update skip locked
   )
  returning o.*;
$$;

revoke all on function public.zap_outbox_claim(text, int) from public, anon, authenticated;

-- 4) Transporte por conta ----------------------------------------------------
-- Permite migrar um número por vez: as contas antigas seguem no Evolution
-- enquanto uma conta nova roda pelo tablet.
alter table public.zap_accounts
  add column if not exists transport text not null default 'evolution';

comment on column public.zap_accounts.transport is
  'evolution (Baileys via Evolution API) | android (WhatsApp Business no aparelho)';
