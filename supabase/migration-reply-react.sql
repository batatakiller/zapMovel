-- ZapMóvel — responder (citar mensagem) e reações (emoji)
-- Cole no SQL Editor do Supabase e execute.

-- 1) Responder: cada mensagem pode citar outra (guarda só o id citado; o
-- conteúdo é buscado em zap_messages na hora de exibir, sem duplicar dado).
alter table public.zap_messages
  add column if not exists quoted_message_id text;

-- 2) Reações: tabela própria — cada (mensagem, quem reagiu) tem no máximo
-- uma reação ativa (upsert substitui; emoji vazio/null = removida).
create table if not exists public.zap_reactions (
  id                bigint generated always as identity primary key,
  instance          text not null,
  remote_jid        text not null,
  target_message_id text not null,          -- message_id da mensagem reagida
  reactor_jid       text not null,          -- quem reagiu: jid do contato, ou 'me' (você)
  from_me           boolean not null default false,
  emoji             text,                   -- null/'' = reação removida
  msg_timestamp     timestamptz not null default now(),
  unique (instance, target_message_id, reactor_jid)
);

create index if not exists zap_reactions_target on public.zap_reactions (instance, target_message_id);
create index if not exists zap_reactions_jid on public.zap_reactions (instance, remote_jid);

alter table public.zap_reactions enable row level security;
drop policy if exists "authenticated read reactions" on public.zap_reactions;
create policy "authenticated read reactions" on public.zap_reactions
  for select to authenticated using (true);

do $$
begin
  alter publication supabase_realtime add table public.zap_reactions;
exception when duplicate_object then null;
end $$;

alter table public.zap_reactions replica identity full;
