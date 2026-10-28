-- ============================================================
-- Simulador da Clara e modelos de configuração (/admin/clara)
-- Rodar no SQL Editor (dev, depois prod). Idempotente.
-- Pré-requisito: migration_clara_config_unidade.sql já aplicada.
-- ============================================================

-- 1. Custo do simulador separado do custo de atendimento do cliente.
--    O nome da origem é o provider (não há coluna "source" em cost_events);
--    metadata leva { source: 'simulator', staff_user_id } — o staff_user_id
--    também serve de contador do limite de 30 mensagens/minuto.
alter table public.cost_events drop constraint if exists cost_events_provider_check;
alter table public.cost_events add constraint cost_events_provider_check check (provider in (
  'claude_agendamento',
  'claude_simulador',
  'claude_financeiro',
  'claude_soap',
  'whisper',
  'whatsapp_conversation'
));

create index if not exists idx_cost_events_simulator_user
  on public.cost_events ((metadata->>'staff_user_id'), created_at desc)
  where provider = 'claude_simulador';

-- 2. Modelos de configuração da Clara (globais da MedScale, sem account).
create table if not exists public.bot_presets (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  description      text,
  scheduling_mode  text not null default 'internal' check (scheduling_mode in ('internal', 'external')),
  intake_fields    text[] not null default '{}'
    check (intake_fields <@ array['full_name','birth_date','insurance','cpf','email','reason','preference']),
  bot_instructions text check (bot_instructions is null or char_length(bot_instructions) <= 1000),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.bot_presets enable row level security;
drop policy if exists "medscale admins manage bot presets" on public.bot_presets;
create policy "medscale admins manage bot presets"
  on public.bot_presets for all
  using (public.is_medscale_admin()) with check (public.is_medscale_admin());

grant all on public.bot_presets to service_role;
grant select, insert, update, delete on public.bot_presets to authenticated;

drop trigger if exists trg_bot_presets_updated_at on public.bot_presets;
create trigger trg_bot_presets_updated_at
  before update on public.bot_presets
  for each row execute procedure public.handle_updated_at();

-- 3. Referência do modelo na unidade (cópia, não vínculo).
alter table public.workspaces
  add column if not exists bot_preset_id uuid references public.bot_presets(id) on delete set null;

-- 4. bot_preset_id entra no trigger que protege as colunas da Clara.
--    Excluir um modelo zera bot_preset_id nas unidades via FK; quem exclui é
--    staff MedScale, então o trigger deixa passar.
create or replace function public.protect_workspace_bot_settings()
returns trigger language plpgsql as $$
begin
  if (
       new.scheduling_mode is distinct from old.scheduling_mode
    or new.intake_fields is distinct from old.intake_fields
    or new.bot_instructions is distinct from old.bot_instructions
    or new.bot_preset_id is distinct from old.bot_preset_id
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

-- 5. Modelos iniciais.
insert into public.bot_presets (name, description, scheduling_mode, intake_fields) values
  ('Clínica com agenda própria',
   'A Clara oferece horários e agenda direto pela agenda da MedScale',
   'internal', '{}'),
  ('Médico em clínicas terceiras',
   'O médico atende pela agenda de clínicas parceiras; a Clara coleta os dados e a equipe confirma o horário com a clínica',
   'external', '{full_name,birth_date,insurance,preference}')
on conflict (name) do nothing;
