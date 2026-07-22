-- ZapMóvel — servidor Evolution por conta (para números hospedados em
-- servidores/instâncias Evolution diferentes do padrão do .env).
-- Cole no SQL Editor do Supabase e execute. Requer migration-multi.sql antes.

create table if not exists public.zap_account_secrets (
  instance         text primary key references public.zap_accounts(instance) on delete cascade,
  evolution_url    text,   -- ex.: https://evolution2.meuservidor.com — vazio = usa o padrão do .env
  evolution_apikey text,   -- apikey daquele servidor Evolution — vazio = usa o padrão do .env
  updated_at       timestamptz not null default now()
);

-- Sem políticas de leitura: só o servidor (service_role, que ignora RLS) lê ou
-- escreve. A apikey NUNCA deve ser exposta ao navegador — nem o cliente
-- autenticado tem select aqui (mesmo padrão de push_subscriptions).
alter table public.zap_account_secrets enable row level security;
