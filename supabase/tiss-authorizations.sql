-- Migração incremental: Autorizações TISS 4.03.00 — Solicitação de SP/SADT,
-- Solicitação de Internação e Anexo de Solicitação de OPME (módulo "billing").
--
-- Rode no SQL Editor do Supabase DEPOIS de supabase/billing.sql. NÃO rode
-- supabase/schema.sql inteiro: aquele arquivo é "drop and recreate".
-- Idempotente e aditiva: cria só tabelas, funções, triggers e policies novas.
-- Não altera tiss_guides, tiss_batches, appointments, profiles nem as funções
-- do faturamento. O número da solicitação vem de next_tiss_number(insurer,
-- 'guide') — a função existente, chamada sem alteração (mesmo contador das
-- guias). Acesso: só owner/admin (is_account_admin), como guias e lotes.
--
-- O bloco entre BEGIN/END abaixo está idêntico em supabase/schema.sql
-- (tests/billing/authorizations-database.test.ts confere).

-- BEGIN TISS AUTHORIZATIONS

-- ============================================================
-- 1. TABELAS
-- ============================================================
-- Cabeçalho da solicitação. A "categoria" é a própria tabela: autorizações
-- nunca entram em tiss_guides, então createBatchesForInsurer não as enxerga.
-- patient_id/insurer_id/parent_id usam NO ACTION (padrão) e não RESTRICT: ao
-- apagar uma account, a cascata remove paciente, operadora e autorizações no
-- mesmo comando, e NO ACTION só confere no fim do comando.
create table if not exists public.tiss_authorizations (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts(id) on delete cascade,
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  patient_id            uuid not null references public.patients(id),
  insurer_id            uuid not null references public.health_insurers(id),
  appointment_id        uuid references public.appointments(id) on delete set null,
  parent_id             uuid references public.tiss_authorizations(id),
  type                  text not null
                        check (type in ('sp_sadt_request','hospitalization_request','opme_request')),
  status                text not null default 'draft'
                        check (status in ('draft','ready','sent','under_review','pending_info',
                                          'authorized','partially_authorized','denied','cancelled')),
  -- next_guide_number da operadora; vira numeroGuiaPrestador (st_texto20),
  -- sequencialTransacao e numeroLote do anexo (st_texto12).
  provider_guide_number text not null check (provider_guide_number ~ '^[0-9]{1,12}$'),
  payload               jsonb not null check (jsonb_typeof(payload) = 'object'),
  missing_fields        text[] not null default '{}',
  -- Resposta da operadora (D6, registrada à mão). Tamanhos do XSD (st_texto20).
  operator_guide_number text check (operator_guide_number is null or char_length(operator_guide_number) between 1 and 20),
  password              text check (password is null or char_length(password) between 1 and 20),
  authorization_date    date,
  password_valid_until  date,
  response_status_code  text check (response_status_code is null or response_status_code in ('1','2','3','4','5','6','7')),
  requested_at          date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  sent_at               timestamptz,
  responded_at          timestamptz,
  created_by            uuid references public.profiles(id) on delete set null,
  updated_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint tiss_authorizations_insurer_number_key unique (insurer_id, provider_guide_number),
  constraint tiss_authorizations_parent_by_type check ((type = 'opme_request') = (parent_id is not null)),
  constraint tiss_authorizations_parent_not_self check (parent_id is distinct from id),
  constraint tiss_authorizations_ready_complete check (status <> 'ready' or cardinality(missing_fields) = 0),
  constraint tiss_authorizations_draft_incomplete check (status <> 'draft' or cardinality(missing_fields) > 0)
);

-- Procedimentos (SP/SADT, Internação) ou materiais (OPME) solicitados.
-- Limites = XSD: codigoTabela dm_tabela, codigoProcedimento st_texto10,
-- descricaoProcedimento st_texto150, quantidadeSolicitada st_numerico3,
-- valorSolicitado st_decimal10-2 (até 99.999.999,99), registroANVISA
-- st_texto15, codigoRefFabricante st_texto60, autorizacaoFuncionamento st_texto30.
create table if not exists public.tiss_authorization_items (
  id                      uuid primary key default gen_random_uuid(),
  authorization_id        uuid not null references public.tiss_authorizations(id) on delete cascade,
  account_id              uuid not null references public.accounts(id) on delete cascade,
  position                int  not null check (position between 1 and 999),
  kind                    text not null check (kind in ('procedure','opme')),
  table_code              text not null check (table_code in ('00','18','19','20','22','90','98')),
  code                    text not null check (char_length(code) between 1 and 10),
  description             text not null check (char_length(description) between 1 and 150),
  quantity_requested      int  not null check (quantity_requested between 1 and 999),
  quantity_authorized     int  check (quantity_authorized between 0 and 999),
  manufacturer_option     text check (manufacturer_option in ('1','2','3')),
  requested_value_cents   bigint check (requested_value_cents between 0 and 9999999999),
  authorized_value_cents  bigint check (authorized_value_cents between 0 and 9999999999),
  anvisa_registration     text check (char_length(anvisa_registration) between 1 and 15),
  manufacturer_reference  text check (char_length(manufacturer_reference) between 1 and 60),
  operating_authorization text check (char_length(operating_authorization) between 1 and 30),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint tiss_authorization_items_position_key unique (authorization_id, position),
  constraint tiss_authorization_items_opme_fields check (
    (kind = 'opme' and manufacturer_option is not null)
    or (kind = 'procedure' and manufacturer_option is null and requested_value_cents is null
        and authorized_value_cents is null and anvisa_registration is null
        and manufacturer_reference is null and operating_authorization is null)
  )
);

-- Histórico append-only. data: só números/senha devolvidos pela operadora e
-- metadados (tipo, contagem, hash) — nada de nome, carteirinha ou CID.
create table if not exists public.tiss_authorization_events (
  id               bigint generated always as identity primary key,
  authorization_id uuid not null references public.tiss_authorizations(id) on delete cascade,
  account_id       uuid not null references public.accounts(id) on delete cascade,
  event            text not null check (event in ('created','updated','items_changed','refreshed','ready',
                                                  'sent','response_recorded','cancelled','xml_generated')),
  from_status      text,
  to_status        text,
  actor_id         uuid references public.profiles(id) on delete set null,
  data             jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at       timestamptz not null default now()
);

create index if not exists idx_tiss_authorizations_account_status
  on public.tiss_authorizations(account_id, status, requested_at desc);
create index if not exists idx_tiss_authorizations_patient on public.tiss_authorizations(patient_id);
create index if not exists idx_tiss_authorizations_parent
  on public.tiss_authorizations(parent_id) where parent_id is not null;
create index if not exists idx_tiss_authorizations_appointment
  on public.tiss_authorizations(appointment_id) where appointment_id is not null;
create index if not exists idx_tiss_authorization_events_authorization
  on public.tiss_authorization_events(authorization_id, id);

-- ============================================================
-- 2. INTEGRIDADE (triggers)
-- ============================================================
-- Insert: paciente, operadora, unidade e agendamento da mesma account; OPME
-- só debaixo de SP/SADT ou Internação do mesmo paciente e operadora.
-- Update: identidade imutável. appointment_id e created_by só podem virar
-- null (on delete set null de appointments/profiles).
create or replace function public.enforce_tiss_authorization()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.tiss_authorizations%rowtype;
begin
  if tg_op = 'UPDATE' then
    if (new.account_id, new.workspace_id, new.patient_id, new.insurer_id, new.parent_id, new.type,
        new.provider_guide_number, new.created_at)
       is distinct from
       (old.account_id, old.workspace_id, old.patient_id, old.insurer_id, old.parent_id, old.type,
        old.provider_guide_number, old.created_at)
       or (new.appointment_id is distinct from old.appointment_id and new.appointment_id is not null)
       or (new.created_by is distinct from old.created_by and new.created_by is not null) then
      raise exception 'tiss_authorization_immutable' using errcode = '55000';
    end if;
    return new;
  end if;

  if not exists (select 1 from public.workspaces where id = new.workspace_id and account_id = new.account_id)
     or not exists (select 1 from public.patients where id = new.patient_id and account_id = new.account_id)
     or not exists (select 1 from public.health_insurers where id = new.insurer_id and account_id = new.account_id) then
    raise exception 'tiss_authorization_account_mismatch' using errcode = '23514';
  end if;
  if new.appointment_id is not null and not exists (
    select 1 from public.appointments
    where id = new.appointment_id and account_id = new.account_id
      and workspace_id = new.workspace_id and patient_id = new.patient_id
  ) then
    raise exception 'tiss_authorization_appointment_mismatch' using errcode = '23514';
  end if;
  if new.parent_id is not null then
    select * into p from public.tiss_authorizations where id = new.parent_id;
    if not found
       or p.type not in ('sp_sadt_request','hospitalization_request')
       or p.account_id <> new.account_id
       or p.patient_id <> new.patient_id
       or p.insurer_id <> new.insurer_id then
      raise exception 'tiss_authorization_parent_invalid' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;

-- Item: account sempre a da autorização; 'opme' só em opme_request e
-- 'procedure' só nas outras; o item não troca de autorização.
create or replace function public.enforce_tiss_authorization_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_type text; v_account uuid;
begin
  if tg_op = 'UPDATE' and new.authorization_id <> old.authorization_id then
    raise exception 'tiss_authorization_immutable' using errcode = '55000';
  end if;
  select type, account_id into v_type, v_account
    from public.tiss_authorizations where id = new.authorization_id;
  if not found then raise exception 'tiss_authorization_not_found' using errcode = '23503'; end if;
  new.account_id := v_account;
  if (v_type = 'opme_request') <> (new.kind = 'opme') then
    raise exception 'tiss_authorization_item_kind' using errcode = '23514';
  end if;
  return new;
end; $$;

-- Evento: account sempre a da autorização; nenhuma alteração depois de
-- gravado, exceto o "on delete set null" de actor_id quando o usuário some.
create or replace function public.enforce_tiss_authorization_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select account_id into new.account_id from public.tiss_authorizations where id = new.authorization_id;
    return new;
  end if;
  if old.actor_id is not null and new.actor_id is null
     and (new.id, new.authorization_id, new.account_id, new.event, new.from_status, new.to_status, new.data, new.created_at)
         is not distinct from
         (old.id, old.authorization_id, old.account_id, old.event, old.from_status, old.to_status, old.data, old.created_at) then
    return new;
  end if;
  raise exception 'tiss_authorization_events_append_only' using errcode = '55000';
end; $$;

drop trigger if exists trg_tiss_authorizations_enforce on public.tiss_authorizations;
create trigger trg_tiss_authorizations_enforce
  before insert or update on public.tiss_authorizations
  for each row execute procedure public.enforce_tiss_authorization();
drop trigger if exists trg_tiss_authorizations_updated_at on public.tiss_authorizations;
create trigger trg_tiss_authorizations_updated_at
  before update on public.tiss_authorizations
  for each row execute procedure public.handle_updated_at();

drop trigger if exists trg_tiss_authorization_items_enforce on public.tiss_authorization_items;
create trigger trg_tiss_authorization_items_enforce
  before insert or update on public.tiss_authorization_items
  for each row execute procedure public.enforce_tiss_authorization_item();
drop trigger if exists trg_tiss_authorization_items_updated_at on public.tiss_authorization_items;
create trigger trg_tiss_authorization_items_updated_at
  before update on public.tiss_authorization_items
  for each row execute procedure public.handle_updated_at();

drop trigger if exists trg_tiss_authorization_events_enforce on public.tiss_authorization_events;
create trigger trg_tiss_authorization_events_enforce
  before insert or update on public.tiss_authorization_events
  for each row execute procedure public.enforce_tiss_authorization_event();

-- ============================================================
-- 3. RLS — leitura só owner/admin (mesma regra de tiss_guides/tiss_batches);
-- member não lê nada. Escrita só pelos RPCs (não há policy de escrita).
-- ============================================================
alter table public.tiss_authorizations      enable row level security;
alter table public.tiss_authorization_items  enable row level security;
alter table public.tiss_authorization_events enable row level security;

drop policy if exists "tiss_authorizations: admin read" on public.tiss_authorizations;
create policy "tiss_authorizations: admin read" on public.tiss_authorizations
  for select using (public.is_account_admin(account_id));

-- account_id dos itens/eventos é forçado pelo trigger para o da autorização.
drop policy if exists "tiss_authorization_items: admin read" on public.tiss_authorization_items;
create policy "tiss_authorization_items: admin read" on public.tiss_authorization_items
  for select using (public.is_account_admin(account_id));

drop policy if exists "tiss_authorization_events: admin read" on public.tiss_authorization_events;
create policy "tiss_authorization_events: admin read" on public.tiss_authorization_events
  for select using (public.is_account_admin(account_id));

-- ============================================================
-- 4. GRANTS — o schema.sql dá ALL em tabelas novas a authenticated por
-- default privileges; aqui fica só SELECT (a RLS filtra). Sem anon.
-- ============================================================
revoke all on public.tiss_authorizations, public.tiss_authorization_items, public.tiss_authorization_events from anon;
revoke insert, update, delete, truncate on
  public.tiss_authorizations, public.tiss_authorization_items, public.tiss_authorization_events from authenticated;
grant select on
  public.tiss_authorizations, public.tiss_authorization_items, public.tiss_authorization_events to authenticated;
grant all on
  public.tiss_authorizations, public.tiss_authorization_items, public.tiss_authorization_events to service_role;

-- END TISS AUTHORIZATIONS
