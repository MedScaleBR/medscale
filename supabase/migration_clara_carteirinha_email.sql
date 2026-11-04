-- Clara: convênio antes da unidade, foto da carteirinha e aviso por e-mail.
--
-- Pré-requisitos (já em prod em 2026-11-03): migration_clara_config_unidade.sql,
-- migration_clara_simulador_modelos.sql e migration_convenios_por_unidade.sql
-- (health_insurer_workspaces já existe: não é recriada aqui).
--
-- Rodar avulso no SQL Editor do Supabase (schema.sql é script de reset).
-- Idempotente. Aplicar ANTES do deploy do código.
--
-- Depois, no Dashboard → Storage, criar o bucket privado 'insurance-cards'
-- (o insert no fim deste arquivo já cria; conferir): Public = false,
-- limite 10 MB, MIME image/jpeg, image/png, application/pdf. Sem policy de
-- leitura para usuários: o acesso é só por signed URL gerada no servidor.

-- ============================================================
-- 1. Convênio antes da unidade (por account)
-- ============================================================
alter table public.bot_config
  add column if not exists ask_insurance_first boolean not null default false;

-- owner/admin dão UPDATE em bot_config (tela da Clara); esta coluna é só da MedScale.
create or replace function public.protect_bot_config_medscale_columns()
returns trigger language plpgsql as $$
begin
  if new.ask_insurance_first is distinct from old.ask_insurance_first
  and coalesce(auth.role(), '') in ('authenticated', 'anon')
  and not public.is_medscale_admin() then
    raise exception 'Somente a equipe MedScale pode alterar a configuração da Clara.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists bot_config_protect_medscale_columns on public.bot_config;
create trigger bot_config_protect_medscale_columns
  before update on public.bot_config
  for each row execute function public.protect_bot_config_medscale_columns();

-- ============================================================
-- 2. Foto da carteirinha
-- ============================================================
alter table public.workspaces drop constraint if exists workspaces_intake_fields_check;
alter table public.workspaces add constraint workspaces_intake_fields_check
  check (intake_fields <@ array['full_name','birth_date','insurance','insurance_card_photo','cpf','email','reason','preference']::text[]);

alter table public.bot_presets drop constraint if exists bot_presets_intake_fields_check;
alter table public.bot_presets add constraint bot_presets_intake_fields_check
  check (intake_fields <@ array['full_name','birth_date','insurance','insurance_card_photo','cpf','email','reason','preference']::text[]);

-- Modelo "Médico em clínicas terceiras" passa a pedir a foto.
update public.bot_presets
   set intake_fields = array_append(intake_fields, 'insurance_card_photo')
 where name = 'Médico em clínicas terceiras'
   and not ('insurance_card_photo' = any(intake_fields));

create table if not exists public.conversation_attachments (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  workspace_id      uuid references public.workspaces(id) on delete set null,
  conversation_id   uuid not null references public.conversations(id) on delete cascade,
  kind              text not null check (kind in ('insurance_card')),
  storage_path      text not null,
  mime_type         text not null,
  size_bytes        int  not null,
  whatsapp_media_id text,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists idx_conv_attachments_conversation
  on public.conversation_attachments (conversation_id);
create index if not exists idx_conv_attachments_retention
  on public.conversation_attachments (created_at) where deleted_at is null;

alter table public.conversation_attachments enable row level security;

-- Mesma visibilidade de conversations. INSERT/UPDATE só pelo service role
-- (webhook e cron): não há policy de escrita para usuários.
drop policy if exists "conversation_attachments: workspace members read" on public.conversation_attachments;
create policy "conversation_attachments: workspace members read" on public.conversation_attachments
  for select using (
    exists (
      select 1 from public.conversations c
       where c.id = conversation_id
         and c.workspace_id = any(public.my_workspace_ids())
    )
  );

grant select on public.conversation_attachments to authenticated;
grant all on public.conversation_attachments to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('insurance-cards', 'insurance-cards', false, 10485760,
        array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================
-- 3. Aviso da solicitação por e-mail
-- ============================================================
alter table public.workspaces
  add column if not exists notification_emails text[] not null default '{}';

alter table public.workspaces drop constraint if exists workspaces_notification_emails_check;
alter table public.workspaces add constraint workspaces_notification_emails_check
  check (cardinality(notification_emails) <= 5);

alter table public.handoff_logs add column if not exists email_sent_at timestamptz;

-- notification_emails entra no trigger que protege as colunas da Clara.
create or replace function public.protect_workspace_bot_settings()
returns trigger language plpgsql as $$
begin
  if (
       new.scheduling_mode is distinct from old.scheduling_mode
    or new.intake_fields is distinct from old.intake_fields
    or new.bot_instructions is distinct from old.bot_instructions
    or new.bot_preset_id is distinct from old.bot_preset_id
    or new.notification_emails is distinct from old.notification_emails
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
