-- Agendamento terceirizado — unidades que dependem de uma clínica parceira
-- (ex.: IAD) para confirmar o horário. Ver
-- docs/superpowers/specs/2026-10-22-agendamento-terceirizado-design.md.
--
-- Rodar avulso no SQL Editor do Supabase (schema.sql é script de reset).
-- Idempotente: pode ser reexecutado.
--
-- Rode o PASSO 1 sozinho primeiro e depois o restante. appointments.status é
-- CHECK (não ENUM), então não há a restrição de transação do ALTER TYPE — o
-- passo fica isolado só para que uma falha nele não deixe o resto pela metade.

-- ============================================================
-- PASSO 1 — status novo em appointments.status (CHECK)
-- ============================================================
-- A constraint original é inline e sem nome explícito; derruba qualquer CHECK
-- de status antes de recriar com nome fixo (se o nome automático divergir em
-- algum banco, um "drop constraint if exists" silencioso deixaria a antiga
-- barrando o valor novo).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) ilike '%agendado%'
  loop
    execute format('alter table public.appointments drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.appointments add constraint appointments_status_check
  check (status in ('agendado','confirmado','realizado','cancelado','no_show','pendente_confirmacao_externa'));

-- ============================================================
-- PASSO 2 — o restante
-- ============================================================

-- Unidades: opt-in por unidade. Telefone só com dígitos e DDI (5571999990000).
alter table public.workspaces
  add column if not exists is_outsourced boolean not null default false,
  add column if not exists external_clinic_phone text;

alter table public.workspaces drop constraint if exists workspaces_external_clinic_phone_check;
alter table public.workspaces add constraint workspaces_external_clinic_phone_check
  check (external_clinic_phone is null or external_clinic_phone ~ '^55\d{10,11}$');

-- Controle do pendente (solicitação enviada / equipe já avisada do atraso).
alter table public.appointments
  add column if not exists external_requested_at timestamptz,
  add column if not exists external_escalated_at timestamptz;

create index if not exists idx_appointments_pending_external
  on public.appointments (workspace_id, status)
  where status = 'pendente_confirmacao_externa';

-- Nascimento — já existe no schema; mantido por segurança.
alter table public.patients add column if not exists birth_date date;

-- Avisos operacionais da clínica parceira vão para handoff_logs sem paciente
-- (resposta ambígua, configuração inválida).
alter table public.handoff_logs alter column patient_phone drop not null;

-- Auditoria da troca com a clínica parceira. Escrita só por service role
-- (webhook/agent/cron com createAdminClient) — sem policy de insert/update.
create table if not exists public.clinic_confirmations (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  appointment_id  uuid references public.appointments(id) on delete set null,
  direction       text not null check (direction in ('outbound', 'inbound')),
  raw_text        text not null,
  classification  text check (classification in ('confirmacao', 'negacao', 'ambiguo')),
  whatsapp_id     text unique,
  created_at      timestamptz not null default now()
);

alter table public.clinic_confirmations enable row level security;

drop policy if exists "clinic_confirmations: workspace members read" on public.clinic_confirmations;
create policy "clinic_confirmations: workspace members read" on public.clinic_confirmations
  for select using (workspace_id = any(public.my_workspace_ids()));

create index if not exists idx_clinic_conf_workspace on public.clinic_confirmations (workspace_id, created_at desc);
create index if not exists idx_clinic_conf_appointment on public.clinic_confirmations (appointment_id);
