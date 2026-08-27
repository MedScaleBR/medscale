-- Migração incremental: Ciclo de Receita Automático (módulo "revenue_cycle")
-- Ver prompts/CICLO_RECEITA_COMO_FUNCIONA.md para o desenho completo.
--
-- Rode isto no SQL Editor do Supabase — NÃO rode supabase/schema.sql inteiro,
-- pois aquele arquivo é "drop and recreate" e apagaria todos os dados. Este
-- arquivo só ADICIONA a tabela procedure_catalog e colunas novas em
-- revenue_entries e appointments. Idempotente: pode ser reexecutado.
--
-- O conteúdo abaixo também já foi incorporado em supabase/schema.sql, que
-- continua sendo a fonte de verdade para reconstruções completas do zero.

-- ============================================================
-- 1. CATÁLOGO DE PROCEDIMENTOS (por workspace)
-- Hoje procedimentos/preços ficam em bot_config.procedures (text[]) como texto
-- livre, só para o prompt da Maria. O ciclo financeiro precisa de nome + preço
-- estruturados. bot_config continua funcionando em paralelo — a Maria não quebra.
-- ============================================================
create table if not exists public.procedure_catalog (
  id            uuid default uuid_generate_v4() primary key,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null,
  code          text,                 -- código interno da clínica (opcional)
  default_price numeric(10,2) not null,
  duration_min  int,                  -- duração em minutos (alimenta o agendador)
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.procedure_catalog enable row level security;

create index if not exists idx_procedure_catalog_workspace
  on public.procedure_catalog(workspace_id, is_active);

-- Leitura/escrita por qualquer membro da workspace: o bot e a /agenda precisam
-- ler os preços, e o cadastro (create/update) é restringido a owner na camada
-- de API (ver app/api/procedures). Não é dado sensível como revenue_entries —
-- é só a tabela de preços de tabela.
drop policy if exists "procedure_catalog: workspace members" on public.procedure_catalog;
create policy "procedure_catalog: workspace members"
  on public.procedure_catalog for all
  using (workspace_id = any(public.my_workspace_ids()));

drop trigger if exists trg_procedure_catalog_updated_at on public.procedure_catalog;
create trigger trg_procedure_catalog_updated_at
  before update on public.procedure_catalog
  for each row execute procedure public.handle_updated_at();

grant all on public.procedure_catalog to authenticated, service_role;

-- ============================================================
-- 2. ENRIQUECER revenue_entries
-- A coluna `status` (previsto/confirmado/cancelado) já existente é mantida por
-- compatibilidade; `payment_status` abaixo é o novo campo canônico do ciclo.
-- appointment_id, payment_method e notes já existem no schema atual.
-- ============================================================
alter table public.revenue_entries
  add column if not exists patient_id     uuid references public.patients(id) on delete set null,
  add column if not exists procedure_id   uuid references public.procedure_catalog(id) on delete set null,
  add column if not exists procedure_name text,            -- snapshot do nome no momento do lançamento
  add column if not exists payment_status text not null default 'pending',
  add column if not exists due_date       date,            -- data esperada de recebimento
  add column if not exists paid_at        timestamptz,     -- quando o pagamento foi confirmado
  add column if not exists installments   int not null default 1,
  add column if not exists source         text not null default 'manual';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'revenue_entries_payment_status_check'
  ) then
    alter table public.revenue_entries
      add constraint revenue_entries_payment_status_check
      check (payment_status in ('pending','realized','paid','cancelled','refunded'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'revenue_entries_source_check'
  ) then
    alter table public.revenue_entries
      add constraint revenue_entries_source_check
      check (source in ('bot','manual','whatsapp_agent'));
  end if;

  -- payment_method já existe como texto livre; passa a ser validado. NOT VALID
  -- para não quebrar caso haja linhas antigas fora da lista — só vale para
  -- inserts/updates a partir de agora.
  if not exists (
    select 1 from pg_constraint where conname = 'revenue_entries_payment_method_check'
  ) then
    alter table public.revenue_entries
      add constraint revenue_entries_payment_method_check
      check (payment_method is null or payment_method in (
        'pix','cartao_credito','cartao_debito','dinheiro','transferencia','outro'
      )) not valid;
  end if;
end $$;

create index if not exists idx_revenue_entries_appointment on public.revenue_entries(appointment_id);
create index if not exists idx_revenue_entries_payment_status
  on public.revenue_entries(workspace_id, payment_status, due_date);

-- ============================================================
-- 3. SNAPSHOT DE PROCEDIMENTO/PREÇO EM appointments
-- `price` já existe. Snapshots são imutáveis: se o médico mudar o preço do
-- procedimento depois, os agendamentos passados não mudam retroativamente.
-- ============================================================
alter table public.appointments
  add column if not exists procedure_id   uuid references public.procedure_catalog(id) on delete set null,
  add column if not exists procedure_name text;

-- ============================================================
-- 4. PREFERÊNCIAS DO CICLO DE RECEITA (por workspace)
-- Alimenta o cron /api/cron/daily-revenue-summary e a tela
-- /configuracoes/receita. Exclusivo do owner (RLS), como revenue_entries.
-- ============================================================
create table if not exists public.revenue_settings (
  workspace_id                     uuid primary key references public.workspaces(id) on delete cascade,
  account_id                       uuid not null references public.accounts(id) on delete cascade,
  daily_summary_enabled            boolean not null default true,
  daily_summary_hour               int not null default 20 check (daily_summary_hour between 0 and 23),
  -- quando true, o resumo só é enviado em dias com pelo menos uma consulta realizada
  daily_summary_only_with_activity boolean not null default false,
  overdue_tolerance_days           int not null default 2 check (overdue_tolerance_days >= 0),
  updated_at                       timestamptz not null default now()
);

alter table public.revenue_settings enable row level security;

drop policy if exists "revenue_settings: owner only" on public.revenue_settings;
create policy "revenue_settings: owner only"
  on public.revenue_settings for all
  using (public.is_account_owner(account_id));

drop trigger if exists trg_revenue_settings_updated_at on public.revenue_settings;
create trigger trg_revenue_settings_updated_at
  before update on public.revenue_settings
  for each row execute procedure public.handle_updated_at();

grant all on public.revenue_settings to authenticated, service_role;
