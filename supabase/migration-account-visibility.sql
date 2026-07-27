-- ZapMóvel — esconder contas do painel e escolher a conta padrão
-- Cole no SQL Editor do Supabase e execute. Idempotente.

-- `enabled=false` tira a conta do painel sem apagar nada: as mensagens
-- continuam no banco e a conta volta a aparecer se for reativada. É diferente
-- de excluir, que é irreversível.
alter table public.zap_accounts
  add column if not exists enabled boolean not null default true;

-- `is_default=true` marca qual conta o painel já abre filtrada. No máximo uma
-- por vez — o índice único garante isso mesmo se duas requisições concorrerem.
alter table public.zap_accounts
  add column if not exists is_default boolean not null default false;

create unique index if not exists zap_accounts_uma_padrao
  on public.zap_accounts (is_default)
  where is_default;

comment on column public.zap_accounts.enabled is
  'false esconde a conta do painel sem apagar as mensagens';
comment on column public.zap_accounts.is_default is
  'conta que o painel abre já filtrada; no máximo uma';
