-- Convênios e atendimento particular por unidade.
--
-- Cada unidade diz se atende particular (workspaces.accepts_private) e quais
-- convênios aceita (health_insurer_workspaces). A Clara e a Agenda só oferecem
-- o que a unidade aceita.
--
-- Backfill: toda unidade herda o bot_config.accepts_private da account e todo
-- convênio existente fica ligado a todas as unidades ativas — nada muda para
-- quem já usa até a clínica mexer na configuração.
--
-- Rodar avulso no SQL Editor do Supabase (schema.sql é script de reset).
-- Idempotente: pode ser reexecutado (o backfill só roda na primeira vez).
-- Aplicar ANTES do deploy do código.

-- ============================================================
-- 1. Particular por unidade
-- ============================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspaces' and column_name = 'accepts_private'
  ) then
    alter table public.workspaces add column accepts_private boolean not null default true;

    update public.workspaces w
       set accepts_private = b.accepts_private
      from public.bot_config b
     where b.account_id = w.account_id;
  end if;
end $$;

-- ============================================================
-- 2. Convênio ↔ unidade
-- ============================================================
do $$
declare
  is_new boolean := to_regclass('public.health_insurer_workspaces') is null;
begin
  create table if not exists public.health_insurer_workspaces (
    insurer_id   uuid not null references public.health_insurers(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    account_id   uuid not null references public.accounts(id) on delete cascade, -- desnormalizado p/ RLS
    created_at   timestamptz not null default now(),
    primary key (insurer_id, workspace_id)
  );

  if is_new then
    insert into public.health_insurer_workspaces (insurer_id, workspace_id, account_id)
    select i.id, w.id, i.account_id
      from public.health_insurers i
      join public.workspaces w on w.account_id = i.account_id and w.is_active
    on conflict do nothing;
  end if;
end $$;

create index if not exists idx_health_insurer_workspaces_workspace
  on public.health_insurer_workspaces (workspace_id);

-- account_id vem sempre do convênio, e a unidade precisa ser da mesma account:
-- sem isto um INSERT forjado ligaria o convênio a uma unidade de outra account.
create or replace function public.enforce_insurer_workspace_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select account_id into new.account_id from public.health_insurers where id = new.insurer_id;
  if not exists (
    select 1 from public.workspaces where id = new.workspace_id and account_id = new.account_id
  ) then
    raise exception 'Unidade e convênio de accounts diferentes' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_health_insurer_workspaces_account on public.health_insurer_workspaces;
create trigger trg_health_insurer_workspaces_account
  before insert or update on public.health_insurer_workspaces
  for each row execute procedure public.enforce_insurer_workspace_account();

alter table public.health_insurer_workspaces enable row level security;

drop policy if exists "health_insurer_workspaces: members read" on public.health_insurer_workspaces;
create policy "health_insurer_workspaces: members read" on public.health_insurer_workspaces
  for select using (account_id = any(public.my_account_ids()));

drop policy if exists "health_insurer_workspaces: admin write" on public.health_insurer_workspaces;
create policy "health_insurer_workspaces: admin write" on public.health_insurer_workspaces
  for all using (public.is_account_admin(account_id)) with check (public.is_account_admin(account_id));

grant all on public.health_insurer_workspaces to authenticated, service_role;
