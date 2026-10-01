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
