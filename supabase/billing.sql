-- Migração incremental: Faturamento de convênios TISS (módulo "billing"),
-- fases 1 e 2 — cadastro de operadoras, convênio do paciente, guias e lotes XML.
--
-- Rode isto no SQL Editor do Supabase — NÃO rode supabase/schema.sql inteiro,
-- pois aquele arquivo é "drop and recreate" e apagaria todos os dados.
-- Idempotente: pode ser reexecutado.
--
-- O conteúdo abaixo também já foi incorporado em supabase/schema.sql, que
-- continua sendo a fonte de verdade para reconstruções completas do zero.
--
-- Depois de rodar, adicione o job 'tiss-batches' de supabase/cron.sql.

-- ============================================================
-- 1. OPERADORAS (por account) + TABELA DE PROCEDIMENTOS TUSS
-- ============================================================
create table if not exists public.health_insurers (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts(id) on delete cascade,
  name                  text not null,
  -- ANS e código do prestador só existem com o módulo billing: sem ele o
  -- convênio é só o nome que a Clara informa ao paciente.
  ans_registry          text check (ans_registry ~ '^\d{6}$'),
  provider_code         text,                    -- código do prestador na operadora
  tiss_version          text not null default '4.03.00',
  default_consult_guide text not null default 'consulta'
                        check (default_consult_guide in ('consulta','sp_sadt')),
  batch_weekdays        int[] not null default '{1,2,3,4,5}', -- 0=domingo, fuso SP
  batch_hour            int not null default 18 check (batch_hour between 0 and 23),
  -- O XSD da ANS aceita no máximo 100 guias em guiasTISS.
  max_guides_per_batch  int not null default 100 check (max_guides_per_batch between 1 and 100),
  next_guide_number     bigint not null default 1,
  next_batch_number     bigint not null default 1,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- Bancos criados antes de ANS/código ficarem opcionais.
alter table public.health_insurers alter column ans_registry drop not null;
alter table public.health_insurers alter column provider_code drop not null;
alter table public.health_insurers drop constraint if exists health_insurers_account_id_ans_registry_key;
create unique index if not exists health_insurers_account_ans_unique
  on public.health_insurers (account_id, ans_registry) where ans_registry is not null;

create table if not exists public.insurer_procedures (
  id          uuid primary key default gen_random_uuid(),
  insurer_id  uuid not null references public.health_insurers(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade, -- desnormalizado p/ RLS
  tuss_code   text not null,
  description text not null,
  price_cents int  not null check (price_cents >= 0),
  guide_type  text not null check (guide_type in ('consulta','sp_sadt')),
  is_active   boolean not null default true,
  unique (insurer_id, tuss_code)
);

-- ============================================================
-- 2. CONVÊNIO DO PACIENTE
-- ============================================================
create table if not exists public.patient_insurances (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  patient_id  uuid not null references public.patients(id) on delete cascade,
  insurer_id  uuid not null references public.health_insurers(id) on delete restrict,
  card_number text not null,
  plan_name   text,
  valid_until date,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (patient_id, insurer_id, card_number)
);

create index if not exists idx_patient_insurances_patient on public.patient_insurances(patient_id);

-- account_id de insurer_procedures é sempre o da operadora, e o de
-- patient_insurances precisa bater com o do paciente e o da operadora — sem
-- isto um INSERT com account_id forjado passaria pela RLS apontando para a
-- operadora/paciente de outra account.
create or replace function public.enforce_billing_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'insurer_procedures' then
    select account_id into new.account_id from public.health_insurers where id = new.insurer_id;
  elsif tg_table_name = 'patient_insurances' then
    if not exists (select 1 from public.health_insurers where id = new.insurer_id and account_id = new.account_id)
       or not exists (select 1 from public.patients where id = new.patient_id and account_id = new.account_id) then
      raise exception 'patient_insurances: paciente e operadora precisam ser da mesma account';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_insurer_procedures_account on public.insurer_procedures;
create trigger trg_insurer_procedures_account
  before insert or update on public.insurer_procedures
  for each row execute procedure public.enforce_billing_account();

drop trigger if exists trg_patient_insurances_account on public.patient_insurances;
create trigger trg_patient_insurances_account
  before insert or update on public.patient_insurances
  for each row execute procedure public.enforce_billing_account();

-- ============================================================
-- 3. COLUNAS NOVAS EM TABELAS EXISTENTES
-- appointments.health_plan (texto) continua sendo gravado com o nome da
-- operadora nas consultas de convênio — é o que mantém a consulta fora do
-- ciclo de receita e nas contagens por plano. insurer_id guarda a operadora
-- mesmo sem carteirinha: a guia nasce 'draft' e a carteirinha é completada
-- depois em /faturamento.
-- ============================================================
alter table public.appointments
  add column if not exists billing_type         text not null default 'particular',
  add column if not exists insurer_id           uuid references public.health_insurers(id) on delete set null,
  add column if not exists patient_insurance_id uuid references public.patient_insurances(id) on delete set null,
  add column if not exists insurer_procedure_id uuid references public.insurer_procedures(id) on delete set null,
  add column if not exists authorization_number text,
  add column if not exists authorization_date   date;

alter table public.workspaces
  add column if not exists cnes       text,
  add column if not exists cnpj       text,
  add column if not exists legal_name text;

alter table public.profiles
  add column if not exists crm_uf   text,
  add column if not exists cbo_code text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_billing_type_check') then
    alter table public.appointments
      add constraint appointments_billing_type_check check (billing_type in ('particular','convenio'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workspaces_cnes_check') then
    alter table public.workspaces
      add constraint workspaces_cnes_check check (cnes is null or cnes ~ '^\d{7}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workspaces_cnpj_check') then
    alter table public.workspaces
      add constraint workspaces_cnpj_check check (cnpj is null or cnpj ~ '^\d{14}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_crm_uf_check') then
    alter table public.profiles
      add constraint profiles_crm_uf_check check (crm_uf is null or crm_uf ~ '^[A-Z]{2}$');
  end if;
end $$;

create index if not exists idx_appointments_billing
  on public.appointments(account_id, status, scheduled_at) where billing_type = 'convenio';

-- ============================================================
-- 4. GUIAS E LOTES
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tiss_guide_status') then
    create type public.tiss_guide_status as enum ('draft','ready','batched','sent','cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'tiss_batch_status') then
    create type public.tiss_batch_status as enum ('generated','sent','error');
  end if;
end $$;

create table if not exists public.tiss_batches (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  insurer_id    uuid not null references public.health_insurers(id) on delete restrict,
  batch_number  bigint not null,
  tiss_version  text not null,
  guide_type    text not null check (guide_type in ('consulta','sp_sadt')), -- um lote TISS só tem um tipo de guia
  status        public.tiss_batch_status not null default 'generated',
  xml_path      text,          -- bucket privado 'tiss-batches'; nunca exposto ao client
  hash_md5      text,
  guide_count   int not null default 0,
  total_cents   bigint not null default 0,
  error_message text,          -- só mensagem do validador, sem dados de paciente
  created_by    uuid references public.profiles(id) on delete set null, -- null = cron
  sent_at       timestamptz,
  sent_by       uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (insurer_id, batch_number)
);

create table if not exists public.tiss_guides (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts(id) on delete cascade,
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  appointment_id        uuid not null unique references public.appointments(id) on delete restrict,
  insurer_id            uuid not null references public.health_insurers(id) on delete restrict,
  batch_id              uuid references public.tiss_batches(id) on delete set null,
  guide_type            text not null check (guide_type in ('consulta','sp_sadt')),
  provider_guide_number text not null,
  status                public.tiss_guide_status not null default 'draft',
  payload               jsonb not null,   -- snapshot tipado (lib/billing/types.ts#GuidePayload)
  missing_fields        text[] not null default '{}',
  total_cents           int not null default 0,
  service_date          date not null,    -- data do atendimento no fuso de SP
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (insurer_id, provider_guide_number)
);

create index if not exists idx_tiss_guides_status   on public.tiss_guides(account_id, status);
create index if not exists idx_tiss_guides_insurer  on public.tiss_guides(insurer_id, status);
create index if not exists idx_tiss_batches_insurer on public.tiss_batches(insurer_id, created_at desc);

-- ============================================================
-- 5. NUMERAÇÃO ATÔMICA (guia e lote, sequenciais por operadora)
-- UPDATE ... RETURNING trava a linha da operadora: duas guias simultâneas
-- nunca recebem o mesmo número. Só o service_role chama (lib/billing).
-- ============================================================
create or replace function public.next_tiss_number(p_insurer_id uuid, p_kind text)
returns bigint language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  if p_kind = 'guide' then
    update public.health_insurers set next_guide_number = next_guide_number + 1
      where id = p_insurer_id returning next_guide_number - 1 into n;
  elsif p_kind = 'batch' then
    update public.health_insurers set next_batch_number = next_batch_number + 1
      where id = p_insurer_id returning next_batch_number - 1 into n;
  else
    raise exception 'invalid kind %', p_kind;
  end if;
  if n is null then raise exception 'insurer not found'; end if;
  return n;
end; $$;

revoke execute on function public.next_tiss_number(uuid, text) from public, anon, authenticated;
grant execute on function public.next_tiss_number(uuid, text) to service_role;

-- Fechamento do lote numa única transação: trava as guias, confere que todas
-- continuam 'ready' e sem lote, grava o lote e marca as guias como 'batched'.
-- Se outra execução (cron duplicado, "Gerar lote agora" simultâneo) pegou
-- alguma guia antes, levanta exceção e nada muda — o chamador apaga o XML
-- que já subiu para o storage.
create or replace function public.finalize_tiss_batch(
  p_account_id   uuid,
  p_insurer_id   uuid,
  p_batch_number bigint,
  p_tiss_version text,
  p_guide_type   text,
  p_xml_path     text,
  p_hash_md5     text,
  p_total_cents  bigint,
  p_created_by   uuid,
  p_guide_ids    uuid[]
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_batch_id uuid;
  v_locked   int;
begin
  select count(*) into v_locked from (
    select id from public.tiss_guides
    where id = any(p_guide_ids)
      and insurer_id = p_insurer_id
      and account_id = p_account_id
      and status = 'ready'
      and batch_id is null
    for update
  ) g;

  if v_locked <> coalesce(array_length(p_guide_ids, 1), 0) then
    raise exception 'tiss_guides_changed';
  end if;

  insert into public.tiss_batches (
    account_id, insurer_id, batch_number, tiss_version, guide_type, status,
    xml_path, hash_md5, guide_count, total_cents, created_by
  ) values (
    p_account_id, p_insurer_id, p_batch_number, p_tiss_version, p_guide_type, 'generated',
    p_xml_path, p_hash_md5, v_locked, p_total_cents, p_created_by
  ) returning id into v_batch_id;

  update public.tiss_guides
    set status = 'batched', batch_id = v_batch_id
    where id = any(p_guide_ids);

  return v_batch_id;
end; $$;

revoke execute on function public.finalize_tiss_batch(uuid, uuid, bigint, text, text, text, text, bigint, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.finalize_tiss_batch(uuid, uuid, bigint, text, text, text, text, bigint, uuid, uuid[])
  to service_role;

-- "Marcar como enviado": lote e guias na mesma transação. SECURITY INVOKER —
-- roda com o client do usuário (createClient), então a RLS de admin vale.
create or replace function public.mark_tiss_batch_sent(p_batch_id uuid)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  update public.tiss_batches
    set status = 'sent', sent_at = now(), sent_by = auth.uid()
    where id = p_batch_id and status = 'generated';
  if not found then return false; end if;

  update public.tiss_guides set status = 'sent'
    where batch_id = p_batch_id and status = 'batched';
  return true;
end; $$;

revoke execute on function public.mark_tiss_batch_sent(uuid) from public, anon;
grant execute on function public.mark_tiss_batch_sent(uuid) to authenticated, service_role;

-- ============================================================
-- 6. RLS
-- Guias e lotes: só owner/admin (is_account_admin). Operadoras e procedimentos:
-- qualquer membro lê (seletor da agenda), só owner/admin escreve. Convênio do
-- paciente: qualquer membro (a recepção cadastra ao agendar).
-- ============================================================
alter table public.health_insurers    enable row level security;
alter table public.insurer_procedures enable row level security;
alter table public.patient_insurances enable row level security;
alter table public.tiss_batches       enable row level security;
alter table public.tiss_guides        enable row level security;

drop policy if exists "health_insurers: members read" on public.health_insurers;
create policy "health_insurers: members read" on public.health_insurers
  for select using (account_id = any(public.my_account_ids()));
drop policy if exists "health_insurers: admin write" on public.health_insurers;
create policy "health_insurers: admin write" on public.health_insurers
  for all using (public.is_account_admin(account_id)) with check (public.is_account_admin(account_id));

drop policy if exists "insurer_procedures: members read" on public.insurer_procedures;
create policy "insurer_procedures: members read" on public.insurer_procedures
  for select using (account_id = any(public.my_account_ids()));
drop policy if exists "insurer_procedures: admin write" on public.insurer_procedures;
create policy "insurer_procedures: admin write" on public.insurer_procedures
  for all using (public.is_account_admin(account_id)) with check (public.is_account_admin(account_id));

drop policy if exists "patient_insurances: account members" on public.patient_insurances;
create policy "patient_insurances: account members" on public.patient_insurances
  for all using (account_id = any(public.my_account_ids()))
  with check (account_id = any(public.my_account_ids()));

drop policy if exists "tiss_guides: admin only" on public.tiss_guides;
create policy "tiss_guides: admin only" on public.tiss_guides
  for all using (public.is_account_admin(account_id)) with check (public.is_account_admin(account_id));

drop policy if exists "tiss_batches: admin only" on public.tiss_batches;
create policy "tiss_batches: admin only" on public.tiss_batches
  for all using (public.is_account_admin(account_id)) with check (public.is_account_admin(account_id));

-- ============================================================
-- 7. TRIGGERS updated_at
-- ============================================================
drop trigger if exists trg_health_insurers_updated_at on public.health_insurers;
create trigger trg_health_insurers_updated_at
  before update on public.health_insurers
  for each row execute procedure public.handle_updated_at();

drop trigger if exists trg_patient_insurances_updated_at on public.patient_insurances;
create trigger trg_patient_insurances_updated_at
  before update on public.patient_insurances
  for each row execute procedure public.handle_updated_at();

drop trigger if exists trg_tiss_guides_updated_at on public.tiss_guides;
create trigger trg_tiss_guides_updated_at
  before update on public.tiss_guides
  for each row execute procedure public.handle_updated_at();

-- ============================================================
-- 8. GRANTS
-- ============================================================
grant all on public.health_insurers, public.insurer_procedures, public.patient_insurances,
  public.tiss_batches, public.tiss_guides to authenticated, service_role;

-- ============================================================
-- 9. STORAGE — bucket privado dos XMLs de lote
-- Sem policy para usuários de propósito: upload e download passam só pelo
-- service_role, e o usuário recebe uma signed URL de 5 minutos gerada em
-- /api/billing/batches/[id]/download depois da checagem de papel.
-- Caminho: {account_id}/{insurer_id}/{batch_number}.xml
-- ============================================================
insert into storage.buckets (id, name, public)
values ('tiss-batches', 'tiss-batches', false)
on conflict (id) do nothing;


-- Ajuste incremental para instalações que já executaram billing.sql.
-- O mesmo bloco está em billing.sql e schema.sql.
-- BEGIN BILLING AUTHENTICATED OPERATIONS

-- Apenas os dados profissionais necessários para o snapshot. A RLS de
-- profiles continua privada; membros não recebem estes dados pelo RPC.
create or replace function public.tiss_professional_for_appointment(p_appointment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.appointments%rowtype;
begin
  select * into a from public.appointments where id = p_appointment_id;
  if not found then return null; end if;
  if auth.role() is distinct from 'service_role' and (
    not public.is_account_admin(a.account_id)
    or not (a.workspace_id = any(public.my_workspace_ids()))
  ) then raise exception 'billing_forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.accounts where id = a.account_id and 'billing' = any(modules)) then
    raise exception 'billing_module_disabled' using errcode = '42501';
  end if;
  return (select jsonb_build_object(
    'full_name', p.full_name, 'crm', p.crm, 'crm_uf', p.crm_uf, 'cbo_code', p.cbo_code
  ) from public.profiles p where p.id = a.doctor_id and exists (
    select 1 from public.memberships m where m.user_id = p.id and m.account_id = a.account_id
  ));
end; $$;
revoke all on function public.tiss_professional_for_appointment(uuid) from public, anon;
grant execute on function public.tiss_professional_for_appointment(uuid) to authenticated, service_role;

-- Membros podem disparar a geração ao concluir uma consulta acessível.
-- Nenhum payload, carteirinha, CID ou nome sai desta função. O lock do
-- agendamento e a inserção ficam na mesma transação, inclusive a numeração.
create or replace function public.ensure_tiss_guide_for_appointment(p_appointment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.appointments%rowtype;
  i public.health_insurers%rowtype;
  pi public.patient_insurances%rowtype;
  pr public.insurer_procedures%rowtype;
  w public.workspaces%rowtype;
  prof public.profiles%rowtype;
  v_insurer_id uuid;
  v_guide_id uuid;
  v_number bigint;
  v_type text;
  v_date date;
  v_name text;
  v_cid text;
  v_payload jsonb;
  v_missing text[] := '{}';
  v_status public.tiss_guide_status;
begin
  select * into a from public.appointments
    where id = p_appointment_id and (
      auth.role() = 'service_role' or workspace_id = any(public.my_workspace_ids())
    ) for update;
  if not found then return jsonb_build_object('status', 'skipped', 'reason', 'not_found'); end if;
  if a.billing_type <> 'convenio' then return jsonb_build_object('status', 'skipped', 'reason', 'not_convenio'); end if;
  if a.status <> 'realizado' then return jsonb_build_object('status', 'skipped', 'reason', 'not_realizado'); end if;
  if not exists (select 1 from public.accounts where id = a.account_id and 'billing' = any(modules)) then
    return jsonb_build_object('status', 'skipped', 'reason', 'module_off');
  end if;
  select id into v_guide_id from public.tiss_guides where appointment_id = a.id;
  if found then return jsonb_build_object('status', 'exists', 'guideId', v_guide_id); end if;

  select * into pi from public.patient_insurances
    where id = a.patient_insurance_id and account_id = a.account_id and patient_id = a.patient_id;
  select * into pr from public.insurer_procedures where id = a.insurer_procedure_id and account_id = a.account_id;
  v_insurer_id := coalesce(a.insurer_id, pi.insurer_id, pr.insurer_id);
  select * into i from public.health_insurers where id = v_insurer_id and account_id = a.account_id;
  if not found then return jsonb_build_object('status', 'skipped', 'reason', 'no_insurer'); end if;
  if i.ans_registry is null or i.provider_code is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'no_insurer');
  end if;
  if pi.insurer_id is distinct from i.id then pi := null; end if;
  if pr.insurer_id is distinct from i.id then pr := null; end if;
  select * into w from public.workspaces where id = a.workspace_id and account_id = a.account_id;
  if not found then return jsonb_build_object('status', 'skipped', 'reason', 'not_found'); end if;
  select * into prof from public.profiles p where p.id = a.doctor_id and exists (
    select 1 from public.memberships m where m.user_id = p.id and m.account_id = a.account_id
  );
  select full_name into v_name from public.patients where id = a.patient_id and account_id = a.account_id;
  select medical_record_final #>> '{soap,A,cid10}' into v_cid from public.transcriptions
    where appointment_id = a.id and account_id = a.account_id and workspace_id = a.workspace_id
      and status = 'signed' order by signed_at desc limit 1;
  v_type := coalesce(pr.guide_type, i.default_consult_guide);
  v_date := (a.scheduled_at at time zone 'America/Sao_Paulo')::date;
  v_payload := jsonb_build_object(
    'insurer', jsonb_build_object('ans_registry', i.ans_registry, 'provider_code', i.provider_code, 'tiss_version', i.tiss_version),
    'provider', jsonb_build_object('cnes', nullif(btrim(w.cnes), ''), 'cnpj', nullif(btrim(w.cnpj), ''), 'legal_name', nullif(btrim(w.legal_name), '')),
    'professional', jsonb_build_object('name', coalesce(prof.full_name, ''), 'crm', nullif(btrim(prof.crm), ''), 'crm_uf', nullif(btrim(prof.crm_uf), ''), 'cbo_code', nullif(btrim(prof.cbo_code), '')),
    'beneficiary', jsonb_build_object('card_number', nullif(btrim(pi.card_number), ''), 'name', coalesce(v_name, a.patient_name), 'valid_until', pi.valid_until),
    'service', jsonb_build_object(
      'date', v_date, 'guide_type', v_type, 'is_return', a.type = 'retorno',
      'tuss_code', nullif(btrim(pr.tuss_code), ''), 'description', nullif(btrim(pr.description), ''), 'price_cents', coalesce(pr.price_cents, 0),
      'authorization_number', nullif(btrim(a.authorization_number), ''), 'authorization_date', a.authorization_date, 'cid10', nullif(btrim(v_cid), '')
    )
  );
  -- Mesmas regras de computeMissingFields em lib/billing/guides.ts;
  -- consulta e SP/SADT da versão 4.03.00 não exigem CID.
  if v_payload #>> '{beneficiary,card_number}' is null then v_missing := array_append(v_missing, 'beneficiary.card_number'); end if;
  if coalesce(v_payload #>> '{provider,cnes}', '') !~ '^\d{7}$' then v_missing := array_append(v_missing, 'provider.cnes'); end if;
  if v_type = 'sp_sadt' and v_payload #>> '{provider,legal_name}' is null then v_missing := array_append(v_missing, 'provider.legal_name'); end if;
  if coalesce(v_payload #>> '{professional,crm}', '') !~ '\d' then v_missing := array_append(v_missing, 'professional.crm'); end if;
  if coalesce(v_payload #>> '{professional,crm_uf}', '') <> all(array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']) then
    v_missing := array_append(v_missing, 'professional.crm_uf');
  end if;
  if coalesce(v_payload #>> '{professional,cbo_code}', '') !~ '^\d{6}$' then v_missing := array_append(v_missing, 'professional.cbo_code'); end if;
  if v_payload #>> '{service,tuss_code}' is null then v_missing := array_append(v_missing, 'service.tuss_code'); end if;
  if v_type = 'sp_sadt' and v_payload #>> '{service,description}' is null then v_missing := array_append(v_missing, 'service.description'); end if;
  if v_type = 'sp_sadt' and v_payload #>> '{service,authorization_number}' is not null and a.authorization_date is null then
    v_missing := array_append(v_missing, 'service.authorization_date');
  end if;
  v_status := case when cardinality(v_missing) = 0 then 'ready'::public.tiss_guide_status else 'draft'::public.tiss_guide_status end;
  update public.health_insurers set next_guide_number = next_guide_number + 1
    where id = i.id returning next_guide_number - 1 into v_number;
  insert into public.tiss_guides (
    account_id, workspace_id, appointment_id, insurer_id, guide_type, provider_guide_number,
    status, payload, missing_fields, total_cents, service_date
  ) values (a.account_id, a.workspace_id, a.id, i.id, v_type, v_number::text,
    v_status, v_payload, v_missing, coalesce(pr.price_cents, 0), v_date) returning id into v_guide_id;
  return jsonb_build_object('status', 'created', 'guideId', v_guide_id, 'guideStatus', v_status,
    'accountId', a.account_id, 'guideType', v_type, 'hasMissingFields', cardinality(v_missing) > 0);
end; $$;
revoke all on function public.ensure_tiss_guide_for_appointment(uuid) from public, anon;
grant execute on function public.ensure_tiss_guide_for_appointment(uuid) to authenticated, service_role;

-- Numeração de lotes manuais: autorização dentro da função, inclusive
-- quando chamada diretamente via PostgREST, sem a rota Next.js.
create or replace function public.next_tiss_number(p_insurer_id uuid, p_kind text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare n bigint; v_account_id uuid;
begin
  select account_id into v_account_id from public.health_insurers where id = p_insurer_id;
  if not found then raise exception 'insurer not found'; end if;
  if auth.role() is distinct from 'service_role' and not public.is_account_admin(v_account_id) then
    raise exception 'billing_forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.accounts where id = v_account_id and 'billing' = any(modules)) then
    raise exception 'billing_module_disabled' using errcode = '42501';
  end if;
  if p_kind = 'guide' then
    update public.health_insurers set next_guide_number = next_guide_number + 1 where id = p_insurer_id returning next_guide_number - 1 into n;
  elsif p_kind = 'batch' then
    update public.health_insurers set next_batch_number = next_batch_number + 1 where id = p_insurer_id returning next_batch_number - 1 into n;
  else raise exception 'invalid kind'; end if;
  return n;
end; $$;
revoke all on function public.next_tiss_number(uuid, text) from public, anon;
grant execute on function public.next_tiss_number(uuid, text) to authenticated, service_role;

-- Retira a assinatura antiga para não deixar um caminho sem conferência
-- dos snapshots. O novo RPC usa RLS e locks em ordem determinística.
drop function if exists public.finalize_tiss_batch(uuid, uuid, bigint, text, text, text, text, bigint, uuid, uuid[]);
create or replace function public.finalize_tiss_batch(
  p_account_id uuid, p_insurer_id uuid, p_batch_number bigint, p_tiss_version text,
  p_guide_type text, p_xml_path text, p_hash_md5 text, p_total_cents bigint,
  p_created_by uuid, p_guide_ids uuid[], p_expected_updated_at jsonb
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_batch_id uuid; v_locked int; v_total bigint;
begin
  if auth.role() is distinct from 'service_role' and (
    not public.is_account_admin(p_account_id) or p_created_by is distinct from auth.uid()
  ) then raise exception 'billing_forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.accounts where id = p_account_id and 'billing' = any(modules)) then
    raise exception 'billing_module_disabled' using errcode = '42501';
  end if;
  if not exists (select 1 from public.health_insurers where id = p_insurer_id and account_id = p_account_id and tiss_version = p_tiss_version) then
    raise exception 'billing_insurer_mismatch';
  end if;
  if coalesce(cardinality(p_guide_ids), 0) = 0
    or p_xml_path is distinct from p_account_id::text || '/' || p_insurer_id::text || '/' || p_batch_number::text || '.xml'
    or coalesce(p_hash_md5, '') !~ '^[a-f0-9]{32}$' then raise exception 'billing_invalid_batch'; end if;
  select count(*), coalesce(sum(total_cents), 0) into v_locked, v_total from (
    select id, total_cents from public.tiss_guides where id = any(p_guide_ids)
      and insurer_id = p_insurer_id and account_id = p_account_id
      and guide_type = p_guide_type and status = 'ready' and batch_id is null
      and updated_at = (p_expected_updated_at ->> id::text)::timestamptz
    order by id for update
  ) g;
  if v_locked <> cardinality(p_guide_ids) then raise exception 'tiss_guides_changed'; end if;
  if v_total <> p_total_cents then raise exception 'billing_total_mismatch'; end if;
  insert into public.tiss_batches (
    account_id, insurer_id, batch_number, tiss_version, guide_type, status,
    xml_path, hash_md5, guide_count, total_cents, created_by
  ) values (p_account_id, p_insurer_id, p_batch_number, p_tiss_version, p_guide_type,
    'generated', p_xml_path, p_hash_md5, v_locked, v_total, p_created_by) returning id into v_batch_id;
  update public.tiss_guides set status = 'batched', batch_id = v_batch_id where id = any(p_guide_ids);
  return v_batch_id;
end; $$;
revoke all on function public.finalize_tiss_batch(uuid, uuid, bigint, text, text, text, text, bigint, uuid, uuid[], jsonb) from public, anon;
grant execute on function public.finalize_tiss_batch(uuid, uuid, bigint, text, text, text, text, bigint, uuid, uuid[], jsonb) to authenticated, service_role;

-- END BILLING AUTHENTICATED OPERATIONS
