-- Clara configurável por unidade: modo de agenda, dados a coletar e
-- instruções próprias. Sem configuração, toda unidade segue como hoje.
--
-- Rodar avulso no SQL Editor do Supabase (schema.sql é script de reset).
-- Idempotente: pode ser reexecutado. Aplicar ANTES do deploy do código.

-- ============================================================
-- 1. Configuração da Clara por unidade
-- ============================================================
alter table public.workspaces
  add column if not exists scheduling_mode text not null default 'internal',
  add column if not exists intake_fields text[] not null default '{}',
  add column if not exists bot_instructions text,
  add column if not exists bot_settings_updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists bot_settings_updated_at timestamptz;

alter table public.workspaces drop constraint if exists workspaces_scheduling_mode_check;
alter table public.workspaces add constraint workspaces_scheduling_mode_check
  check (scheduling_mode in ('internal', 'external'));

alter table public.workspaces drop constraint if exists workspaces_intake_fields_check;
alter table public.workspaces add constraint workspaces_intake_fields_check
  check (intake_fields <@ array['full_name','birth_date','insurance','cpf','email','reason','preference']::text[]);

alter table public.workspaces drop constraint if exists workspaces_bot_instructions_check;
alter table public.workspaces add constraint workspaces_bot_instructions_check
  check (bot_instructions is null or char_length(bot_instructions) <= 1000);

-- ============================================================
-- 2. Dados do paciente (birth_date e email já existem; mantidos por segurança)
-- ============================================================
alter table public.patients add column if not exists birth_date date;
alter table public.patients add column if not exists email text;
alter table public.patients add column if not exists insurance_card_number text;
alter table public.patients add column if not exists cpf text;

alter table public.patients drop constraint if exists patients_cpf_check;
alter table public.patients add constraint patients_cpf_check
  check (cpf is null or cpf ~ '^\d{11}$');

-- ============================================================
-- 3. Solicitação de agendamento (unidades com agenda externa)
-- ============================================================
-- trigger_reason é text sem CHECK: 'external_scheduling' entra sem alteração.
-- Pendente = trigger_reason 'external_scheduling' com resolved_at nulo.
alter table public.handoff_logs
  add column if not exists summary jsonb,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.profiles(id) on delete set null;

create index if not exists idx_handoff_logs_open_requests
  on public.handoff_logs (conversation_id, sent_at desc)
  where trigger_reason = 'external_scheduling';

-- Motivo da consulta em unidade 'internal' fica na própria consulta.
alter table public.appointments add column if not exists reason text;

-- ============================================================
-- 4. Só a equipe MedScale altera a configuração da Clara
-- ============================================================
-- owner/admin podem dar UPDATE em workspaces (endereço etc. em /locais), então
-- a RLS sozinha não protege estas colunas. O bloqueio vale só para requisições
-- com JWT de usuário (authenticated/anon) que não sejam staff MedScale:
-- service role (crons, admin client) e o SQL Editor passam.
create or replace function public.protect_workspace_bot_settings()
returns trigger language plpgsql as $$
begin
  if (
       new.scheduling_mode is distinct from old.scheduling_mode
    or new.intake_fields is distinct from old.intake_fields
    or new.bot_instructions is distinct from old.bot_instructions
    or new.bot_settings_updated_by is distinct from old.bot_settings_updated_by
    or new.bot_settings_updated_at is distinct from old.bot_settings_updated_at
  )
  and coalesce(auth.role(), '') in ('authenticated', 'anon')
  and not public.is_medscale_admin() then
    raise exception 'Somente a equipe MedScale pode alterar a configuração da Clara.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_protect_bot_settings on public.workspaces;
create trigger workspaces_protect_bot_settings
  before update on public.workspaces
  for each row execute function public.protect_workspace_bot_settings();

-- Conferência (opcional): member lê handoff_logs da própria unidade.
-- select polname, pg_get_expr(polqual, polrelid) from pg_policy
--   where polrelid = 'public.handoff_logs'::regclass;
