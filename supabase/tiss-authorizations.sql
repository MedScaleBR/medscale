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
    if (new.id, new.account_id, new.workspace_id, new.patient_id, new.insurer_id, new.parent_id, new.type,
        new.provider_guide_number, new.created_at)
       is distinct from
       (old.id, old.account_id, old.workspace_id, old.patient_id, old.insurer_id, old.parent_id, old.type,
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

-- ============================================================
-- 5. RPCs — toda escrita passa por aqui, com o evento na mesma transação
-- ============================================================
create or replace function public.tiss_authorization_require_billing(p_account_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.accounts where id = p_account_id and 'billing' = any(modules)) then
    raise exception 'billing_module_disabled' using errcode = '42501';
  end if;
end; $$;

-- Trava a linha (FOR UPDATE). Outra account: not_found (não revela que
-- existe). Mesma account sem owner/admin: forbidden (P1, como tiss_guides).
-- O lock de um member é desfeito com o rollback do próprio erro.
create or replace function public.tiss_authorization_lock(p_id uuid)
returns public.tiss_authorizations language plpgsql security definer set search_path = '' as $$
declare a public.tiss_authorizations%rowtype;
begin
  if auth.uid() is null then raise exception 'tiss_authorization_forbidden' using errcode = '42501'; end if;
  select * into a from public.tiss_authorizations
    where id = p_id and account_id = any(public.my_account_ids())
    for update;
  if not found then raise exception 'tiss_authorization_not_found' using errcode = 'P0002'; end if;
  if not public.is_account_admin(a.account_id) then
    raise exception 'tiss_authorization_forbidden' using errcode = '42501';
  end if;
  perform public.tiss_authorization_require_billing(a.account_id);
  return a;
end; $$;

-- Substitui todos os itens. O tipo do item vem do tipo da autorização; os
-- CHECKs da tabela validam limites do XSD e o trigger força a account.
create or replace function public.tiss_authorization_write_items(p_authorization_id uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_account uuid;
begin
  select case when type = 'opme_request' then 'opme' else 'procedure' end, account_id
    into v_kind, v_account
    from public.tiss_authorizations where id = p_authorization_id;
  delete from public.tiss_authorization_items where authorization_id = p_authorization_id;
  insert into public.tiss_authorization_items (
    authorization_id, account_id, position, kind, table_code, code, description, quantity_requested,
    manufacturer_option, requested_value_cents, anvisa_registration, manufacturer_reference, operating_authorization
  )
  select p_authorization_id, v_account, x.ord::int, v_kind,
         x.item ->> 'table_code',
         btrim(x.item ->> 'code'),
         btrim(x.item ->> 'description'),
         (x.item ->> 'quantity_requested')::int,
         nullif(x.item ->> 'manufacturer_option', ''),
         (x.item ->> 'requested_value_cents')::bigint,
         nullif(btrim(x.item ->> 'anvisa_registration'), ''),
         nullif(btrim(x.item ->> 'manufacturer_reference'), ''),
         nullif(btrim(x.item ->> 'operating_authorization'), '')
  from jsonb_array_elements(p_items) with ordinality as x(item, ord);
end; $$;

create or replace function public.tiss_authorization_log(p_id uuid, p_event text, p_from text, p_to text, p_data jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.tiss_authorization_events (authorization_id, account_id, event, from_status, to_status, actor_id, data)
  select a.id, a.account_id, p_event, p_from, p_to, auth.uid(), coalesce(p_data, '{}'::jsonb)
  from public.tiss_authorizations a where a.id = p_id;
$$;

-- Profissionais solicitantes: membros ativos com CRM da account do workspace.
-- profiles tem RLS "só o próprio"; aqui saem só os campos de identificação do
-- TISS (R3: nada de telefone/e-mail — são digitados na autorização). Só owner/admin.
create or replace function public.tiss_authorization_professionals(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_account uuid;
begin
  select account_id into v_account from public.workspaces
    where id = p_workspace_id and id = any(public.my_workspace_ids());
  if not found or not public.is_account_admin(v_account) then
    raise exception 'tiss_authorization_forbidden' using errcode = '42501';
  end if;
  perform public.tiss_authorization_require_billing(v_account);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'full_name', p.full_name, 'crm', p.crm, 'crm_uf', p.crm_uf, 'cbo_code', p.cbo_code
    ) order by p.full_name)
    from public.profiles p
    join public.memberships m on m.user_id = p.id
    where m.account_id = v_account and m.status = 'active' and nullif(btrim(p.crm), '') is not null
  ), '[]'::jsonb);
end; $$;

-- Cria a solicitação já numerada por next_tiss_number(insurer, 'guide') — o
-- mesmo contador das guias (D4/P4). payload e missing_fields vêm do servidor
-- Next (lib/billing/authorizations); aqui só se garante o que não pode ser
-- forjado: owner/admin, módulo, operadora TISS completa, payload da mesma
-- operadora, pai do OPME, draft sem itens.
create or replace function public.create_tiss_authorization(
  p_workspace_id   uuid,
  p_patient_id     uuid,
  p_insurer_id     uuid,
  p_type           text,
  p_appointment_id uuid,
  p_parent_id      uuid,
  p_payload        jsonb,
  p_missing_fields text[],
  p_items          jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w         public.workspaces%rowtype;
  i         public.health_insurers%rowtype;
  v_parent  public.tiss_authorizations%rowtype;
  v_number  bigint;
  v_id      uuid;
  v_missing text[] := coalesce(p_missing_fields, '{}');
  v_status  text;
begin
  if auth.uid() is null then raise exception 'tiss_authorization_forbidden' using errcode = '42501'; end if;
  select * into w from public.workspaces where id = p_workspace_id and id = any(public.my_workspace_ids());
  if not found or not public.is_account_admin(w.account_id) then
    raise exception 'tiss_authorization_forbidden' using errcode = '42501';
  end if;
  perform public.tiss_authorization_require_billing(w.account_id);

  if p_type is null or p_type not in ('sp_sadt_request','hospitalization_request','opme_request')
     or jsonb_typeof(p_payload) is distinct from 'object'
     or jsonb_typeof(p_items) is distinct from 'array'
     or p_payload ->> 'type' is distinct from p_type then
    raise exception 'tiss_authorization_invalid' using errcode = '22023';
  end if;

  if (p_type = 'opme_request') <> (p_parent_id is not null) then
    raise exception 'tiss_authorization_parent_invalid' using errcode = '22023';
  end if;
  if p_parent_id is not null then
    -- FOR SHARE: um cancelamento simultâneo do pai espera esta transação.
    select * into v_parent from public.tiss_authorizations
      where id = p_parent_id and account_id = w.account_id
      for share;
    if not found or v_parent.status = 'cancelled' or v_parent.workspace_id <> w.id then
      raise exception 'tiss_authorization_parent_invalid' using errcode = '22023';
    end if;
  end if;

  -- Trava a linha da operadora (mesmo lock de ensure_tiss_guide_for_appointment)
  -- e confere a identidade TISS antes de consumir número.
  select * into i from public.health_insurers
    where id = p_insurer_id and account_id = w.account_id
    for update;
  if not found or i.ans_registry is null or i.provider_code is null then
    raise exception 'tiss_insurer_incomplete' using errcode = '22023';
  end if;
  if p_payload #>> '{insurer,ans_registry}' is distinct from i.ans_registry
     or p_payload #>> '{insurer,provider_code}' is distinct from i.provider_code then
    raise exception 'tiss_authorization_payload_mismatch' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) = 0 and not ('items' = any(v_missing)) then
    v_missing := array_append(v_missing, 'items');
  end if;
  v_status := case when cardinality(v_missing) = 0 then 'ready' else 'draft' end;

  -- D4/P4: a função existente, sem alteração. Ela repete is_account_admin e o
  -- módulo; auth.uid()/auth.role() vêm dos GUCs da sessão, que o security
  -- definer não troca. Se o insert abaixo falhar, o rollback devolve o número.
  v_number := public.next_tiss_number(i.id, 'guide');

  insert into public.tiss_authorizations (
    account_id, workspace_id, patient_id, insurer_id, appointment_id, parent_id, type, status,
    provider_guide_number, payload, missing_fields, created_by, updated_by
  ) values (
    w.account_id, w.id, p_patient_id, i.id, p_appointment_id, p_parent_id, p_type, v_status,
    v_number::text, p_payload, v_missing, auth.uid(), auth.uid()
  ) returning id into v_id;

  perform public.tiss_authorization_write_items(v_id, p_items);
  perform public.tiss_authorization_log(v_id, 'created', null, v_status,
    jsonb_build_object('type', p_type, 'provider_guide_number', v_number::text));

  return jsonb_build_object('id', v_id, 'status', v_status, 'provider_guide_number', v_number::text);
end; $$;

-- Conteúdo (payload, itens, data da solicitação): só em draft/ready e com o
-- updated_at que o usuário viu (concorrência otimista). Status recalculado.
create or replace function public.update_tiss_authorization(
  p_id                  uuid,
  p_expected_updated_at timestamptz,
  p_payload             jsonb,
  p_missing_fields      text[],
  p_items               jsonb default null,
  p_requested_at        date default null,
  p_event               text default 'updated'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a         public.tiss_authorizations%rowtype;
  v_from    text;
  v_missing text[] := coalesce(p_missing_fields, '{}');
  v_status  text;
begin
  if p_event is null or p_event not in ('updated', 'refreshed')
     or jsonb_typeof(p_payload) is distinct from 'object'
     or (p_items is not null and jsonb_typeof(p_items) <> 'array') then
    raise exception 'tiss_authorization_invalid' using errcode = '22023';
  end if;
  a := public.tiss_authorization_lock(p_id);
  if a.status not in ('draft', 'ready') then
    raise exception 'tiss_authorization_not_editable' using errcode = 'P0001';
  end if;
  if a.updated_at is distinct from p_expected_updated_at then
    raise exception 'tiss_authorization_changed' using errcode = 'P0001';
  end if;
  if p_payload ->> 'type' is distinct from a.type then
    raise exception 'tiss_authorization_invalid' using errcode = '22023';
  end if;
  -- Operadora do payload: a que já estava no snapshot ou a atual ("Recarregar dados").
  if (p_payload #>> '{insurer,ans_registry}', p_payload #>> '{insurer,provider_code}')
       is distinct from (a.payload #>> '{insurer,ans_registry}', a.payload #>> '{insurer,provider_code}')
     and not exists (
       select 1 from public.health_insurers
       where id = a.insurer_id
         and ans_registry = p_payload #>> '{insurer,ans_registry}'
         and provider_code = p_payload #>> '{insurer,provider_code}'
     ) then
    raise exception 'tiss_authorization_payload_mismatch' using errcode = '22023';
  end if;

  if p_items is not null then
    perform public.tiss_authorization_write_items(a.id, p_items);
  end if;
  if not exists (select 1 from public.tiss_authorization_items where authorization_id = a.id)
     and not ('items' = any(v_missing)) then
    v_missing := array_append(v_missing, 'items');
  end if;

  v_from := a.status;
  v_status := case when cardinality(v_missing) = 0 then 'ready' else 'draft' end;
  update public.tiss_authorizations set
    payload = p_payload,
    missing_fields = v_missing,
    status = v_status,
    requested_at = coalesce(p_requested_at, requested_at),
    updated_by = auth.uid()
  where id = a.id
  returning * into a;

  perform public.tiss_authorization_log(a.id, p_event, v_from, v_status, '{}'::jsonb);
  if p_items is not null then
    perform public.tiss_authorization_log(a.id, 'items_changed', null, null,
      jsonb_build_object('count', jsonb_array_length(p_items)));
  end if;
  if v_from = 'draft' and v_status = 'ready' then
    perform public.tiss_authorization_log(a.id, 'ready', v_from, v_status, '{}'::jsonb);
  end if;
  return jsonb_build_object('id', a.id, 'status', a.status, 'updated_at', a.updated_at);
end; $$;

-- D3: ready → sent; draft|ready|sent|under_review|pending_info → cancelled.
-- Papel: owner/admin, conferido em tiss_authorization_lock (P1).
create or replace function public.transition_tiss_authorization(
  p_id uuid, p_to text, p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.tiss_authorizations%rowtype; v_from text;
begin
  if p_to is null or p_to not in ('sent', 'cancelled') then
    raise exception 'tiss_authorization_invalid_transition' using errcode = '22023';
  end if;
  a := public.tiss_authorization_lock(p_id);
  if a.updated_at is distinct from p_expected_updated_at then
    raise exception 'tiss_authorization_changed' using errcode = 'P0001';
  end if;
  v_from := a.status;
  if p_to = 'sent' and v_from <> 'ready' then
    raise exception 'tiss_authorization_invalid_transition' using errcode = 'P0001';
  end if;
  if p_to = 'cancelled' and v_from not in ('draft', 'ready', 'sent', 'under_review', 'pending_info') then
    raise exception 'tiss_authorization_invalid_transition' using errcode = 'P0001';
  end if;
  update public.tiss_authorizations set
    status = p_to,
    sent_at = case when p_to = 'sent' then now() else sent_at end,
    updated_by = auth.uid()
  where id = a.id
  returning * into a;
  perform public.tiss_authorization_log(a.id, p_to, v_from, p_to, '{}'::jsonb);
  return jsonb_build_object('id', a.id, 'status', a.status, 'updated_at', a.updated_at);
end; $$;

-- D6: resposta registrada à mão. dm_statusSolicitacao → status (D3).
-- R1: owner/admin podem registrar de novo sobre authorized/partially_authorized/
-- denied (correção de digitação); nunca a partir de draft/ready/cancelled.
create or replace function public.record_tiss_authorization_response(
  p_id                    uuid,
  p_expected_updated_at   timestamptz,
  p_status_code           text,
  p_operator_guide_number text,
  p_password              text,
  p_authorization_date    date,
  p_password_valid_until  date,
  p_items                 jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a      public.tiss_authorizations%rowtype;
  v_from text;
  v_to   text;
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
begin
  v_to := case p_status_code
    when '1' then 'authorized'
    when '2' then 'under_review'
    when '3' then 'denied'
    when '4' then 'pending_info'
    when '5' then 'pending_info'
    when '6' then 'cancelled'
    when '7' then 'partially_authorized'
  end;
  if v_to is null or jsonb_typeof(v_items) <> 'array' then
    raise exception 'tiss_authorization_invalid' using errcode = '22023';
  end if;
  a := public.tiss_authorization_lock(p_id);
  if a.updated_at is distinct from p_expected_updated_at then
    raise exception 'tiss_authorization_changed' using errcode = 'P0001';
  end if;
  v_from := a.status;
  if v_from not in ('sent', 'under_review', 'pending_info', 'authorized', 'partially_authorized', 'denied') then
    raise exception 'tiss_authorization_invalid_transition' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_items) x
    where not exists (
      select 1 from public.tiss_authorization_items it
      where it.authorization_id = a.id and it.id::text = x ->> 'id'
    )
  ) then
    raise exception 'tiss_authorization_item_not_found' using errcode = '22023';
  end if;

  update public.tiss_authorization_items it set
    quantity_authorized    = (x.item ->> 'quantity_authorized')::int,
    authorized_value_cents = (x.item ->> 'authorized_value_cents')::bigint
  from jsonb_array_elements(v_items) as x(item)
  where it.authorization_id = a.id and it.id::text = x.item ->> 'id';

  update public.tiss_authorizations set
    status                = v_to,
    response_status_code  = p_status_code,
    operator_guide_number = nullif(btrim(p_operator_guide_number), ''),
    password              = nullif(btrim(p_password), ''),
    authorization_date    = p_authorization_date,
    password_valid_until  = p_password_valid_until,
    responded_at          = now(),
    updated_by            = auth.uid()
  where id = a.id
  returning * into a;

  perform public.tiss_authorization_log(a.id, 'response_recorded', v_from, v_to, jsonb_build_object(
    'status_code', p_status_code,
    'operator_guide_number', a.operator_guide_number,
    'password', a.password,
    'authorization_date', a.authorization_date,
    'password_valid_until', a.password_valid_until
  ));
  return jsonb_build_object('id', a.id, 'status', a.status, 'updated_at', a.updated_at);
end; $$;

-- O XML não é guardado (D5); o download só deixa rastro do hash gerado.
create or replace function public.log_tiss_authorization_xml(p_id uuid, p_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.tiss_authorizations%rowtype;
begin
  if coalesce(p_hash, '') !~ '^[a-f0-9]{32}$' then
    raise exception 'tiss_authorization_invalid' using errcode = '22023';
  end if;
  a := public.tiss_authorization_lock(p_id);
  if a.status = 'draft' then
    raise exception 'tiss_authorization_incomplete' using errcode = 'P0001';
  end if;
  perform public.tiss_authorization_log(a.id, 'xml_generated', null, null, jsonb_build_object('hash', p_hash));
end; $$;

revoke all on function public.tiss_authorization_require_billing(uuid) from public, anon, authenticated;
revoke all on function public.tiss_authorization_lock(uuid) from public, anon, authenticated;
revoke all on function public.tiss_authorization_write_items(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.tiss_authorization_log(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.enforce_tiss_authorization() from public, anon, authenticated;
revoke all on function public.enforce_tiss_authorization_item() from public, anon, authenticated;
revoke all on function public.enforce_tiss_authorization_event() from public, anon, authenticated;

revoke all on function public.tiss_authorization_professionals(uuid) from public, anon;
grant execute on function public.tiss_authorization_professionals(uuid) to authenticated;
revoke all on function public.create_tiss_authorization(uuid, uuid, uuid, text, uuid, uuid, jsonb, text[], jsonb) from public, anon;
grant execute on function public.create_tiss_authorization(uuid, uuid, uuid, text, uuid, uuid, jsonb, text[], jsonb) to authenticated;
revoke all on function public.update_tiss_authorization(uuid, timestamptz, jsonb, text[], jsonb, date, text) from public, anon;
grant execute on function public.update_tiss_authorization(uuid, timestamptz, jsonb, text[], jsonb, date, text) to authenticated;
revoke all on function public.transition_tiss_authorization(uuid, text, timestamptz) from public, anon;
grant execute on function public.transition_tiss_authorization(uuid, text, timestamptz) to authenticated;
revoke all on function public.record_tiss_authorization_response(uuid, timestamptz, text, text, text, date, date, jsonb) from public, anon;
grant execute on function public.record_tiss_authorization_response(uuid, timestamptz, text, text, text, date, date, jsonb) to authenticated;
revoke all on function public.log_tiss_authorization_xml(uuid, text) from public, anon;
grant execute on function public.log_tiss_authorization_xml(uuid, text) to authenticated;

-- END TISS AUTHORIZATIONS
