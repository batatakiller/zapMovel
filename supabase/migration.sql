-- ZapMovel — tabela de mensagens + realtime
-- Cole este arquivo inteiro no SQL Editor do Supabase e execute.

create table if not exists public.zap_messages (
  id bigint generated always as identity primary key,
  instance text not null default 'super',
  remote_jid text not null,                -- ex.: 5521994333955@s.whatsapp.net
  message_id text not null,                -- id da mensagem no WhatsApp (dedupe)
  from_me boolean not null default false,
  push_name text,                          -- nome de exibição do contato
  type text not null default 'text',       -- text | image | audio | video | document | sticker | other
  content text,                            -- texto ou legenda
  status text default 'received',          -- received | pending | sent | delivered | read
  msg_timestamp timestamptz not null default now(),
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (instance, message_id)
);

create index if not exists zap_messages_jid_ts on public.zap_messages (remote_jid, msg_timestamp desc);
create index if not exists zap_messages_ts on public.zap_messages (msg_timestamp desc);

-- Segurança: só usuário logado lê; escrita apenas pelo servidor (service_role ignora RLS)
alter table public.zap_messages enable row level security;

drop policy if exists "authenticated read" on public.zap_messages;
create policy "authenticated read" on public.zap_messages
  for select to authenticated using (true);

-- Realtime: publica INSERT/UPDATE da tabela
do $$
begin
  alter publication supabase_realtime add table public.zap_messages;
exception when duplicate_object then null;
end $$;

alter table public.zap_messages replica identity full;
