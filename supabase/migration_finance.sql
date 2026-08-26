-- Migração incremental: Agente Financeiro (lançamentos PF/PJ via WhatsApp)
-- Rode isto no SQL Editor do Supabase — NÃO rode supabase/schema.sql
-- inteiro, pois aquele arquivo é "drop and recreate" e apagaria todos os
-- dados existentes. Este arquivo só ADICIONA as tabelas novas.
--
-- O conteúdo abaixo também já foi incorporado em supabase/schema.sql, que
-- continua sendo a fonte de verdade para reconstruções completas do zero.

-- papel = owner do usuário atual num account. Distinto de is_account_admin
-- (que também aceita 'admin') porque o painel financeiro e os lançamentos
-- de finance_entries são exclusivos do owner — médicos frequentemente
-- convidam sócios/secretárias como 'admin' e esses dados são pessoais.
create or replace function public.is_account_owner(p_account_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.memberships
    where account_id = p_account_id
      and user_id    = auth.uid()
      and status     = 'active'
      and role       = 'owner'
  )
$$;

create table public.finance_entries (
  id                uuid default uuid_generate_v4() primary key,
  account_id        uuid references public.accounts(id) on delete cascade not null,
  recorded_by_phone text not null,
  type              text not null check (type in ('pf','pj')),
  description       text,
  amount            numeric(12, 2) not null check (amount > 0),
  category          text,
  raw_message       text not null,
  entry_date        date not null default current_date,
  created_at        timestamptz not null default now()
);

create table public.finance_sessions (
  phone             text primary key,
  account_id        uuid references public.accounts(id) on delete cascade not null,
  pending_entry     jsonb,
  last_message_at   timestamptz not null default now()
);

create index idx_finance_entries_account  on public.finance_entries(account_id, entry_date desc);
create index idx_finance_entries_type     on public.finance_entries(account_id, type);

alter table public.finance_entries  enable row level security;
alter table public.finance_sessions enable row level security;

-- finance_entries: dado financeiro pessoal — exclusivo do owner do account,
-- não estendido a admin/member como o restante dos dados operacionais.
create policy "finance_entries: owner only" on public.finance_entries
  for all using (public.is_account_owner(account_id));

-- finance_sessions: contexto de conversa do bot financeiro — só o webhook
-- (service role) acessa; sem policy tenant-facing (using (false) nega tudo
-- para authenticated/anon, service role ignora RLS de qualquer forma).
create policy "finance_sessions: service role only" on public.finance_sessions
  for all using (false);

-- Necessário pois este projeto concede grants explícitos por tabela (ver
-- seção 14 de schema.sql) em vez de depender dos grants automáticos do
-- Table Editor do Supabase.
grant all on public.finance_entries to authenticated, service_role;
grant all on public.finance_sessions to authenticated, service_role;
