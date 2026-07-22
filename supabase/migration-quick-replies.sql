-- ZapMóvel — respostas rápidas (atalhos "/palavra" que inserem um texto
-- pronto na conversa, como o WhatsApp Business).
-- Cole no SQL Editor do Supabase e execute.

create table if not exists public.zap_quick_replies (
  id          bigint generated always as identity primary key,
  shortcut    text not null,              -- ex.: "horario" (sem "/", sem espaços)
  message     text not null,              -- texto completo inserido no campo de mensagem
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (shortcut)
);

-- App de uso pessoal/pequena equipe: qualquer usuário logado lê e gerencia
-- (não há dado sensível aqui — são só modelos de texto).
alter table public.zap_quick_replies enable row level security;
drop policy if exists "authenticated manage quick replies" on public.zap_quick_replies;
create policy "authenticated manage quick replies" on public.zap_quick_replies
  for all to authenticated using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table public.zap_quick_replies;
exception when duplicate_object then null;
end $$;
