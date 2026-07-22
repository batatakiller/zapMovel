-- ZapMóvel — suporte a múltiplas contas de WhatsApp + backups importados
-- Cole este arquivo inteiro no SQL Editor do Supabase e execute.
-- É seguro rodar em cima do banco já existente (idempotente).

-- 1) Cadastro de contas -------------------------------------------------------
-- Cada linha é um "número de WhatsApp" dentro do app. `instance` casa com
-- zap_messages.instance. Contas 'live' ficam conectadas via Evolution (QR);
-- contas 'archive' são só histórico importado de backups (somente leitura).
create table if not exists public.zap_accounts (
  instance    text primary key,                 -- ex.: 'super', 'trabalho', 'arquivo-antigo'
  label       text not null,                     -- nome amigável exibido no app
  color       text not null default '#008069',   -- cor da etiqueta na caixa unificada
  phone       text,                              -- número dono da conta (opcional)
  kind        text not null default 'live',      -- 'live' (Evolution) | 'archive' (importado)
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- Migra a instância única atual para o novo cadastro sem perder nada.
insert into public.zap_accounts (instance, label, color, kind, sort_order)
values (coalesce(nullif(current_setting('app.default_instance', true), ''), 'super'), 'Principal', '#008069', 'live', 0)
on conflict (instance) do nothing;

-- Garante que a instância 'super' (padrão do projeto) exista mesmo sem o setting acima.
insert into public.zap_accounts (instance, label, color, kind, sort_order)
values ('super', 'Principal', '#008069', 'live', 0)
on conflict (instance) do nothing;

-- Rede de segurança: cadastra como 'live' qualquer instância que já tenha
-- mensagens em zap_messages mas ainda não esteja no cadastro de contas.
insert into public.zap_accounts (instance, label, color, kind, sort_order)
select distinct m.instance, m.instance, '#128C7E', 'live', 50
from public.zap_messages m
where not exists (select 1 from public.zap_accounts a where a.instance = m.instance)
on conflict (instance) do nothing;

-- Leitura para usuário logado; escrita só pelo servidor (service_role ignora RLS).
alter table public.zap_accounts enable row level security;
drop policy if exists "authenticated read accounts" on public.zap_accounts;
create policy "authenticated read accounts" on public.zap_accounts
  for select to authenticated using (true);

-- Publica no realtime (novas contas aparecem no app sem recarregar).
do $$
begin
  alter publication supabase_realtime add table public.zap_accounts;
exception when duplicate_object then null;
end $$;

-- 2) Índice por conta em zap_messages ----------------------------------------
-- A tabela zap_messages já tem a coluna `instance` e a unicidade (instance,
-- message_id). Só falta um índice para filtrar por conta com rapidez.
create index if not exists zap_messages_instance_ts
  on public.zap_messages (instance, msg_timestamp desc);

create index if not exists zap_messages_instance_jid_ts
  on public.zap_messages (instance, remote_jid, msg_timestamp desc);
