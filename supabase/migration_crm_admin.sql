-- Migração incremental: CRM admin (notas + tarefas por account)
-- Rode isto no SQL Editor do Supabase — NÃO rode supabase/schema.sql
-- inteiro, pois aquele arquivo é "drop and recreate" e apagaria todos os
-- dados existentes. Este arquivo só ADICIONA as duas tabelas novas.
--
-- O conteúdo abaixo também já foi incorporado em supabase/schema.sql, que
-- continua sendo a fonte de verdade para reconstruções completas do zero.

create table public.account_notes (
  id          uuid default uuid_generate_v4() primary key,
  account_id  uuid references public.accounts(id) on delete cascade not null,
  type        text not null default 'note'
              check (type in ('note','call','email','meeting')),
  body        text not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.account_tasks (
  id            uuid default uuid_generate_v4() primary key,
  account_id    uuid references public.accounts(id) on delete cascade not null,
  title         text not null,
  description   text,
  due_date      date,
  assigned_to   uuid references auth.users(id) on delete set null,
  status        text not null default 'pending' check (status in ('pending','done')),
  created_by    uuid references auth.users(id) on delete set null,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_account_notes_account   on public.account_notes(account_id, created_at desc);
create index idx_account_tasks_account   on public.account_tasks(account_id, status);
create index idx_account_tasks_assignee  on public.account_tasks(assigned_to, status, due_date);

create trigger trg_account_notes_updated_at
  before update on public.account_notes
  for each row execute procedure public.handle_updated_at();

create trigger trg_account_tasks_updated_at
  before update on public.account_tasks
  for each row execute procedure public.handle_updated_at();

alter table public.account_notes enable row level security;
alter table public.account_tasks enable row level security;

create policy "account_notes: medscale admin full" on public.account_notes
  for all using (public.is_medscale_admin());

create policy "account_tasks: medscale admin full" on public.account_tasks
  for all using (public.is_medscale_admin());

-- Necessário pois este projeto concede grants explícitos por tabela (ver
-- seção 14 de schema.sql) em vez de depender dos grants automáticos do
-- Table Editor do Supabase.
grant all on public.account_notes to authenticated, service_role;
grant all on public.account_tasks to authenticated, service_role;
