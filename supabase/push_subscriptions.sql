-- ZapMóvel — inscrições de Web Push (uma por dispositivo)
-- Cole no SQL Editor do Supabase e execute.

create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

-- sem políticas: só o servidor (service_role) lê/escreve
alter table public.push_subscriptions enable row level security;
