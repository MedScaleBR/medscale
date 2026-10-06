import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'

const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ids = {
  account: id(1), workspace: id(2), doctor: id(3), member: id(4), owner: id(5), patient: id(6), insurer: id(7),
  insurance: id(8), appointment: id(9), otherAccount: id(10), otherWorkspace: id(11), otherPatient: id(12),
  otherInsurer: id(13), outsider: id(14), patient2: id(15), procedure: id(16), workspace2: id(17),
}
let db: PGlite
let migration: string

async function asUser(userId: string, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [userId, role])
  await db.exec(`set role ${role}`)
}

async function asSuperuser() {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false)")
}

function payload(type: string) {
  return {
    type,
    insurer: { ans_registry: '999999', provider_code: 'PREST0001', tiss_version: '4.03.00' },
    provider: { cnes: '1234567', cnpj: '12345678000199', legal_name: 'Clínica Fictícia' },
    // phone/email: digitados na autorização (R3), nunca lidos de profiles.
    professional: { id: ids.doctor, name: 'Dra. Fictícia', crm: '123456', crm_uf: 'SP', cbo_code: '225125', phone: '11999990000', email: null },
    beneficiary: { patient_insurance_id: ids.insurance, card_number: 'FICT-CARD-001', newborn: false },
    request: {},
  }
}

// Insere direto como superuser — exercita CHECKs e triggers sem passar pelos RPCs.
async function insertRaw(row: {
  id: string; type: string; number: string; parent?: string | null; patient?: string; insurer?: string
  account?: string; workspace?: string; appointment?: string | null; status?: string; missing?: string[]
}) {
  await asSuperuser()
  await db.query(
    `insert into public.tiss_authorizations (id, account_id, workspace_id, patient_id, insurer_id, appointment_id,
       parent_id, type, status, provider_guide_number, payload, missing_fields)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, array(select jsonb_array_elements_text($12::jsonb)))`,
    [row.id, row.account ?? ids.account, row.workspace ?? ids.workspace, row.patient ?? ids.patient,
     row.insurer ?? ids.insurer, row.appointment ?? null, row.parent ?? null, row.type, row.status ?? 'draft',
     row.number, JSON.stringify(payload(row.type)), JSON.stringify(row.missing ?? ['items'])],
  )
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(await readFile('tests/billing/fixtures/database.sql', 'utf8'))
  await db.exec(await readFile('supabase/billing.sql', 'utf8'))
  // Como em produção: o schema.sql dá ALL em toda tabela nova a authenticated
  // antes desta migration rodar; o revoke explícito dela é que fecha a escrita.
  await db.exec('alter default privileges in schema public grant all on tables to authenticated')
  // O Supabase também dá EXECUTE em funções novas a anon/authenticated.
  await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated')
  migration = await readFile('supabase/tiss-authorizations.sql', 'utf8')
  await db.exec(migration)
}, 30000)

afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await asSuperuser()
  await db.exec('truncate public.accounts, auth.users cascade;')
  await db.exec(`
    insert into auth.users (id) values ('${ids.doctor}'), ('${ids.member}'), ('${ids.owner}'), ('${ids.outsider}');
    insert into public.accounts (id, modules) values ('${ids.account}', array['billing']), ('${ids.otherAccount}', array['billing']);
    insert into public.workspaces (id, account_id, cnes, cnpj, legal_name) values
      ('${ids.workspace}', '${ids.account}', '1234567', '12345678000199', 'Clínica Fictícia'),
      ('${ids.workspace2}', '${ids.account}', '7654321', null, 'Unidade Dois'),
      ('${ids.otherWorkspace}', '${ids.otherAccount}', '1111111', null, 'Outra Clínica');
    insert into public.profiles (id, full_name, crm, crm_uf, cbo_code) values
      ('${ids.doctor}', 'Dra. Fictícia', '123456/SP', 'SP', '225125'),
      ('${ids.member}', 'Recepção Fictícia', null, null, null),
      ('${ids.owner}', 'Gestão Fictícia', null, null, null),
      ('${ids.outsider}', 'Dr. De Fora', '999999', 'RJ', '225125');
    insert into public.memberships (user_id, account_id, role) values
      ('${ids.doctor}', '${ids.account}', 'member'), ('${ids.member}', '${ids.account}', 'member'),
      ('${ids.owner}', '${ids.account}', 'owner'), ('${ids.outsider}', '${ids.otherAccount}', 'owner');
    insert into public.patients (id, account_id, full_name) values
      ('${ids.patient}', '${ids.account}', 'Paciente Fictício'), ('${ids.patient2}', '${ids.account}', 'Paciente Dois'),
      ('${ids.otherPatient}', '${ids.otherAccount}', 'Paciente De Fora');
    insert into public.health_insurers (id, account_id, name, ans_registry, provider_code) values
      ('${ids.insurer}', '${ids.account}', 'Operadora Fictícia', '999999', 'PREST0001'),
      ('${ids.otherInsurer}', '${ids.otherAccount}', 'Operadora De Fora', '888888', 'PREST0002');
    insert into public.insurer_procedures (id, insurer_id, account_id, tuss_code, description, price_cents, guide_type) values
      ('${ids.procedure}', '${ids.insurer}', '${ids.account}', '10101012', 'Consulta', 15000, 'consulta');
    insert into public.patient_insurances (id, account_id, patient_id, insurer_id, card_number) values
      ('${ids.insurance}', '${ids.account}', '${ids.patient}', '${ids.insurer}', 'FICT-CARD-001');
    insert into public.appointments (id, account_id, workspace_id, doctor_id, patient_id, patient_name, scheduled_at,
      status, billing_type, insurer_id, insurer_procedure_id, patient_insurance_id) values
      ('${ids.appointment}', '${ids.account}', '${ids.workspace}', '${ids.doctor}', '${ids.patient}', 'Paciente Fictício',
       '2026-10-05T13:00:00Z', 'agendado', 'convenio', '${ids.insurer}', '${ids.procedure}', '${ids.insurance}');
  `)
})

describe('tiss-authorizations.sql — estrutura, RLS e integridade', () => {
  it('é idempotente', async () => {
    await expect(db.exec(migration)).resolves.toBeDefined()
  })

  it('só owner/admin da própria account leem (P1/P2: member não lê nada, como tiss_guides)', async () => {
    await insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1' })
    await insertRaw({ id: id(101), type: 'sp_sadt_request', number: '1', account: ids.otherAccount,
      workspace: ids.otherWorkspace, patient: ids.otherPatient, insurer: ids.otherInsurer })
    await asSuperuser()
    await db.query(`insert into public.tiss_authorization_items (authorization_id, account_id, position, kind, table_code, code, description, quantity_requested)
      values ($1, $2, 1, 'procedure', '22', '40301010', 'Hemograma', 1)`, [id(100), ids.account])
    await db.query(`insert into public.tiss_authorization_events (authorization_id, account_id, event) values ($1, $2, 'created')`, [id(100), ids.account])
    await asUser(ids.owner)
    expect((await db.query<{ id: string }>('select id from public.tiss_authorizations')).rows.map((r) => r.id)).toEqual([id(100)])
    await asUser(ids.outsider)
    expect((await db.query<{ id: string }>('select id from public.tiss_authorizations')).rows.map((r) => r.id)).toEqual([id(101)])
    for (const user of [ids.member, ids.doctor]) {
      await asUser(user)
      expect((await db.query('select id from public.tiss_authorizations')).rows).toEqual([])
      expect((await db.query('select id from public.tiss_authorization_items')).rows).toEqual([])
      expect((await db.query('select id from public.tiss_authorization_events')).rows).toEqual([])
    }
    // Promovido a admin, passa a ler (a policy segue o papel, não uma lista fixa).
    await asSuperuser()
    await db.exec(`update public.memberships set role = 'admin' where user_id = '${ids.member}'`)
    await asUser(ids.member)
    expect((await db.query<{ id: string }>('select id from public.tiss_authorizations')).rows.map((r) => r.id)).toEqual([id(100)])
  })

  it('ninguém escreve direto nas tabelas (só via RPC)', async () => {
    await insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1' })
    await asUser(ids.owner)
    await expect(db.query(`update public.tiss_authorizations set status = 'sent'`)).rejects.toThrow(/permission denied/)
    await expect(db.query(`delete from public.tiss_authorizations`)).rejects.toThrow(/permission denied/)
    await expect(db.query(`truncate public.tiss_authorizations`)).rejects.toThrow(/permission denied/)
    await expect(db.query(`insert into public.tiss_authorization_events (authorization_id, account_id, event) values ($1, $2, 'sent')`,
      [id(100), ids.account])).rejects.toThrow(/permission denied/)
  })

  it('paciente com autorização não é excluído (FK 23503; a rota traduz em 409 — R2)', async () => {
    // patient2 não tem agendamento nem carteirinha: a única FK que segura é a da autorização.
    await insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1', patient: ids.patient2 })
    await expect(db.query('delete from public.patients where id = $1', [ids.patient2]))
      .rejects.toMatchObject({ code: '23503', message: expect.stringContaining('tiss_authorizations_patient_id_fkey') })
  })

  it('OPME exige pai SP/SADT ou Internação da mesma account, paciente e operadora', async () => {
    await insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1' })
    await insertRaw({ id: id(101), type: 'hospitalization_request', number: '2' })
    await insertRaw({ id: id(102), type: 'opme_request', number: '3', parent: id(100) })
    await insertRaw({ id: id(103), type: 'opme_request', number: '4', parent: id(101) })
    // pai é outro OPME
    await expect(insertRaw({ id: id(104), type: 'opme_request', number: '5', parent: id(102) })).rejects.toThrow('tiss_authorization_parent_invalid')
    // paciente diferente do pai
    await expect(insertRaw({ id: id(105), type: 'opme_request', number: '6', parent: id(100), patient: ids.patient2 })).rejects.toThrow('tiss_authorization_parent_invalid')
    // pai de outra account
    await insertRaw({ id: id(106), type: 'sp_sadt_request', number: '1', account: ids.otherAccount,
      workspace: ids.otherWorkspace, patient: ids.otherPatient, insurer: ids.otherInsurer })
    await expect(insertRaw({ id: id(107), type: 'opme_request', number: '7', parent: id(106) })).rejects.toThrow('tiss_authorization_parent_invalid')
    // OPME sem pai e SP/SADT com pai: CHECK
    await expect(insertRaw({ id: id(108), type: 'opme_request', number: '8' })).rejects.toThrow(/tiss_authorizations_parent_by_type/)
    await expect(insertRaw({ id: id(109), type: 'sp_sadt_request', number: '9', parent: id(100) })).rejects.toThrow(/tiss_authorizations_parent_by_type/)
  })

  it('paciente, operadora, unidade e agendamento precisam ser da mesma account', async () => {
    await expect(insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1', patient: ids.otherPatient })).rejects.toThrow('tiss_authorization_account_mismatch')
    await expect(insertRaw({ id: id(101), type: 'sp_sadt_request', number: '2', insurer: ids.otherInsurer })).rejects.toThrow('tiss_authorization_account_mismatch')
    await expect(insertRaw({ id: id(102), type: 'sp_sadt_request', number: '3', patient: ids.patient2, appointment: ids.appointment })).rejects.toThrow('tiss_authorization_appointment_mismatch')
  })

  it('número do prestador é único por operadora; vários por agendamento são permitidos', async () => {
    await insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1', appointment: ids.appointment })
    await insertRaw({ id: id(101), type: 'hospitalization_request', number: '2', appointment: ids.appointment })
    await expect(insertRaw({ id: id(102), type: 'sp_sadt_request', number: '1' })).rejects.toThrow(/tiss_authorizations_insurer_number_key/)
  })

  it('draft/ready coerentes com missing_fields', async () => {
    await expect(insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1', status: 'ready', missing: ['items'] })).rejects.toThrow(/tiss_authorizations_ready_complete/)
    await expect(insertRaw({ id: id(101), type: 'sp_sadt_request', number: '2', status: 'draft', missing: [] })).rejects.toThrow(/tiss_authorizations_draft_incomplete/)
  })

  it('colunas de identidade são imutáveis; agendamento apagado só zera a referência', async () => {
    await insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1', appointment: ids.appointment })
    await expect(db.query(`update public.tiss_authorizations set type = 'hospitalization_request' where id = $1`, [id(100)])).rejects.toThrow('tiss_authorization_immutable')
    await expect(db.query(`update public.tiss_authorizations set provider_guide_number = '99' where id = $1`, [id(100)])).rejects.toThrow('tiss_authorization_immutable')
    await expect(db.query(`update public.tiss_authorizations set id = $2 where id = $1`, [id(100), id(199)])).rejects.toThrow('tiss_authorization_immutable')
    await db.query('delete from public.appointments where id = $1', [ids.appointment])
    expect((await db.query<{ appointment_id: string | null }>('select appointment_id from public.tiss_authorizations')).rows[0].appointment_id).toBeNull()
  })

  it('itens: account forçada, tipo compatível, posição única', async () => {
    await insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1' })
    await insertRaw({ id: id(101), type: 'opme_request', number: '2', parent: id(100) })
    await db.query(`insert into public.tiss_authorization_items (authorization_id, account_id, position, kind, table_code, code, description, quantity_requested)
      values ($1, $2, 1, 'procedure', '22', '40301010', 'Hemograma', 1), ($1, $2, 2, 'procedure', '22', '40302040', 'Glicose', 2)`, [id(100), ids.otherAccount])
    expect((await db.query<{ account_id: string }>('select distinct account_id from public.tiss_authorization_items')).rows).toEqual([{ account_id: ids.account }])
    await expect(db.query(`insert into public.tiss_authorization_items (authorization_id, account_id, position, kind, table_code, code, description, quantity_requested)
      values ($1, $2, 3, 'procedure', '22', 'X', 'Y', 1)`, [id(101), ids.account])).rejects.toThrow('tiss_authorization_item_kind')
    await expect(db.query(`insert into public.tiss_authorization_items (authorization_id, account_id, position, kind, table_code, code, description, quantity_requested)
      values ($1, $2, 1, 'opme', '19', 'X', 'Y', 1)`, [id(101), ids.account])).rejects.toThrow(/tiss_authorization_items_opme_fields/)
    await expect(db.query(`insert into public.tiss_authorization_items (authorization_id, account_id, position, kind, table_code, code, description, quantity_requested)
      values ($1, $2, 1, 'procedure', '22', 'X', 'Y', 1)`, [id(100), ids.account])).rejects.toThrow(/tiss_authorization_items_position_key/)
    await expect(db.query(`insert into public.tiss_authorization_items (authorization_id, account_id, position, kind, table_code, code, description, quantity_requested)
      values ($1, $2, 3, 'procedure', '21', 'X', 'Y', 1)`, [id(100), ids.account])).rejects.toThrow(/table_code/)
  })

  it('eventos são append-only, mas a exclusão do usuário só zera o autor', async () => {
    await insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1' })
    await db.query(`insert into public.tiss_authorization_events (authorization_id, account_id, event, actor_id) values ($1, $2, 'created', $3)`,
      [id(100), ids.otherAccount, ids.member])
    expect((await db.query<{ account_id: string }>('select account_id from public.tiss_authorization_events')).rows[0].account_id).toBe(ids.account)
    await expect(db.query(`update public.tiss_authorization_events set event = 'sent'`)).rejects.toThrow('tiss_authorization_events_append_only')
    await db.query('delete from public.profiles where id = $1', [ids.member])
    expect((await db.query<{ actor_id: string | null }>('select actor_id from public.tiss_authorization_events')).rows[0].actor_id).toBeNull()
  })
})

type Created = { id: string; status: string; provider_guide_number: string }

const ITEM = { table_code: '22', code: '40301010', description: 'Hemograma completo', quantity_requested: 1 }
const OPME_ITEM = { table_code: '19', code: '70000001', description: 'Placa de titânio', quantity_requested: 2,
  manufacturer_option: '1', requested_value_cents: 150000, anvisa_registration: '80000000001' }

async function create(o: Partial<{ type: string; parent: string | null; workspace: string; patient: string; insurer: string;
  appointment: string | null; missing: string[]; items: object[]; payload: object }> = {}): Promise<Created> {
  const type = o.type ?? 'sp_sadt_request'
  const r = await db.query<{ r: Created }>(
    `select public.create_tiss_authorization($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6::uuid, $7::jsonb,
       array(select jsonb_array_elements_text($8::jsonb)), $9::jsonb) as r`,
    [o.workspace ?? ids.workspace, o.patient ?? ids.patient, o.insurer ?? ids.insurer, type, o.appointment ?? null,
     o.parent ?? null, JSON.stringify(o.payload ?? payload(type)), JSON.stringify(o.missing ?? []),
     JSON.stringify(o.items ?? [type === 'opme_request' ? OPME_ITEM : ITEM])],
  )
  return r.rows[0].r
}

// Lido com o papel atual (a RLS deixa owner/admin ler). Para member/outsider
// a RLS esconde a linha e sai um valor qualquer — o RPC é que precisa recusar.
async function updatedAt(authorizationId: string): Promise<string> {
  const r = await db.query<{ t: string }>('select updated_at::text as t from public.tiss_authorizations where id = $1', [authorizationId])
  return r.rows[0]?.t ?? '2000-01-01T00:00:00Z'
}

const transition = async (aid: string, to: string) =>
  db.query('select public.transition_tiss_authorization($1::uuid, $2, $3::timestamptz) as r', [aid, to, await updatedAt(aid)])

const respond = async (aid: string, code: string, items: object[] = []) =>
  db.query(`select public.record_tiss_authorization_response($1::uuid, $2::timestamptz, $3, 'OP-123', 'SENHA9', '2026-10-06'::date,
    '2026-11-05'::date, $4::jsonb) as r`, [aid, await updatedAt(aid), code, JSON.stringify(items)])

const events = async (aid: string) => {
  await asSuperuser()
  return (await db.query<{ event: string; from_status: string | null; to_status: string | null }>(
    'select event, from_status, to_status from public.tiss_authorization_events where authorization_id = $1 order by id', [aid])).rows
}

const nextGuideNumber = async () => {
  await asSuperuser()
  return (await db.query<{ n: string }>('select next_guide_number::text as n from public.health_insurers where id = $1', [ids.insurer])).rows[0].n
}

describe('RPCs de autorização — criação e numeração', () => {
  it('owner cria com next_tiss_number (contador de guias da operadora), sem receber payload', async () => {
    await asUser(ids.owner)
    const a = await create()
    const b = await create({ type: 'hospitalization_request' })
    expect(a).toEqual({ id: expect.any(String), status: 'ready', provider_guide_number: '1' })
    expect(b.provider_guide_number).toBe('2')
    expect(JSON.stringify(a)).not.toMatch(/FICT-CARD|payload/)
    expect(await events(a.id)).toEqual([{ event: 'created', from_status: null, to_status: 'ready' }])
    expect(await nextGuideNumber()).toBe('3')
  })

  it('member (inclusive o médico) não cria nem lista profissionais, e o contador não anda (P1)', async () => {
    for (const user of [ids.member, ids.doctor]) {
      await asUser(user)
      await expect(create()).rejects.toThrow('tiss_authorization_forbidden')
      await expect(db.query('select public.tiss_authorization_professionals($1::uuid)', [ids.workspace])).rejects.toThrow('tiss_authorization_forbidden')
    }
    expect(await nextGuideNumber()).toBe('1')
  })

  it('sem itens vira draft com "items" em missing_fields, mesmo que o cliente mande vazio', async () => {
    await asUser(ids.owner)
    const a = await create({ items: [], missing: [] })
    expect(a.status).toBe('draft')
    await asSuperuser()
    expect((await db.query<{ m: string[] }>('select missing_fields as m from public.tiss_authorizations')).rows[0].m).toEqual(['items'])
  })

  it('recusa workspace alheio, módulo desligado, operadora sem ANS e payload de outra operadora', async () => {
    await asUser(ids.owner)
    await expect(create({ workspace: ids.otherWorkspace })).rejects.toThrow('tiss_authorization_forbidden')
    await expect(create({ patient: ids.otherPatient })).rejects.toThrow('tiss_authorization_account_mismatch')
    await expect(create({ payload: { ...payload('sp_sadt_request'), insurer: { ans_registry: '888888', provider_code: 'X', tiss_version: '4.03.00' } } }))
      .rejects.toThrow('tiss_authorization_payload_mismatch')
    await asSuperuser()
    await db.exec(`update public.health_insurers set ans_registry = null where id = '${ids.insurer}'`)
    await asUser(ids.owner)
    await expect(create()).rejects.toThrow('tiss_insurer_incomplete')
    await asSuperuser()
    await db.exec(`update public.health_insurers set ans_registry = '999999'; update public.accounts set modules = '{}'`)
    await asUser(ids.owner)
    await expect(create()).rejects.toThrow('billing_module_disabled')
    // Nenhuma tentativa recusada consumiu número.
    expect(await nextGuideNumber()).toBe('1')
  })

  it('OPME: pai da mesma account e workspace, não cancelado; herda paciente e operadora', async () => {
    await asUser(ids.owner)
    const parent = await create()
    const opme = await create({ type: 'opme_request', parent: parent.id })
    expect(opme.status).toBe('ready')
    await expect(create({ type: 'opme_request', parent: parent.id, workspace: ids.workspace2 })).rejects.toThrow('tiss_authorization_parent_invalid')
    await expect(create({ type: 'opme_request', parent: opme.id })).rejects.toThrow('tiss_authorization_parent_invalid')
    await expect(create({ type: 'opme_request' })).rejects.toThrow('tiss_authorization_parent_invalid')
    await expect(create({ type: 'sp_sadt_request', parent: parent.id })).rejects.toThrow('tiss_authorization_parent_invalid')
    await transition(parent.id, 'cancelled')
    await expect(create({ type: 'opme_request', parent: parent.id })).rejects.toThrow('tiss_authorization_parent_invalid')
  })

  it('lista só profissionais com CRM da própria account, só com id, nome, CRM, UF e CBO (R3)', async () => {
    await asUser(ids.owner)
    const r = await db.query<{ r: Array<Record<string, unknown>> }>(
      'select public.tiss_authorization_professionals($1::uuid) as r', [ids.workspace])
    // toEqual exato: telefone/e-mail nunca saem daqui.
    expect(r.rows[0].r).toEqual([
      { id: ids.doctor, full_name: 'Dra. Fictícia', crm: '123456/SP', crm_uf: 'SP', cbo_code: '225125' },
    ])
    await expect(db.query('select public.tiss_authorization_professionals($1::uuid)', [ids.otherWorkspace])).rejects.toThrow('tiss_authorization_forbidden')
  })
})

describe('RPCs de autorização — funções internas', () => {
  it('owner não chama as funções internas direto (pularia a máquina de estados)', async () => {
    await asUser(ids.owner)
    const a = await create()
    for (const sql of [
      'select public.tiss_authorization_require_billing($1::uuid)',
      'select public.tiss_authorization_lock($1::uuid)',
      `select public.tiss_authorization_write_items($1::uuid, '[]'::jsonb)`,
      `select public.tiss_authorization_log($1::uuid, 'sent', 'ready', 'sent', '{}'::jsonb)`,
    ]) {
      await expect(db.query(sql, [sql.includes('require_billing') ? ids.account : a.id])).rejects.toThrow(/permission denied/)
    }
    for (const fn of ['enforce_tiss_authorization', 'enforce_tiss_authorization_item', 'enforce_tiss_authorization_event']) {
      for (const role of ['anon', 'authenticated']) {
        const r = await db.query<{ ok: boolean }>(`select has_function_privilege($1, 'public.${fn}()', 'execute') as ok`, [role])
        expect(r.rows[0].ok).toBe(false)
      }
    }
    for (const fn of ['create_tiss_authorization(uuid, uuid, uuid, text, uuid, uuid, jsonb, text[], jsonb)',
      'transition_tiss_authorization(uuid, text, timestamptz)']) {
      const r = await db.query<{ ok: boolean }>(`select has_function_privilege('anon', 'public.${fn}', 'execute') as ok`)
      expect(r.rows[0].ok).toBe(false)
    }
  })
})

describe('RPCs de autorização — edição e máquina de estados', () => {
  it('edição exige updated_at atual e só vale em draft/ready; draft→ready gera evento', async () => {
    await asUser(ids.owner)
    const a = await create({ missing: ['beneficiary.card_number'] })
    const stale = await updatedAt(a.id)
    const ok = await db.query<{ r: { status: string } }>(
      `select public.update_tiss_authorization($1::uuid, $2::timestamptz, $3::jsonb, '{}'::text[], $4::jsonb) as r`,
      [a.id, stale, JSON.stringify(payload('sp_sadt_request')), JSON.stringify([ITEM, { ...ITEM, code: '40302040', description: 'Glicose' }])])
    expect(ok.rows[0].r.status).toBe('ready')
    await expect(db.query(`select public.update_tiss_authorization($1::uuid, $2::timestamptz, $3::jsonb, '{}'::text[])`,
      [a.id, stale, JSON.stringify(payload('sp_sadt_request'))])).rejects.toThrow('tiss_authorization_changed')
    expect((await events(a.id)).map((e) => e.event)).toEqual(['created', 'updated', 'items_changed', 'ready'])
    await asSuperuser()
    expect((await db.query<{ n: number }>('select count(*)::int as n from public.tiss_authorization_items')).rows[0].n).toBe(2)
    await asUser(ids.owner)
    await transition(a.id, 'sent')
    await expect(db.query(`select public.update_tiss_authorization($1::uuid, $2::timestamptz, $3::jsonb, '{}'::text[])`,
      [a.id, await updatedAt(a.id), JSON.stringify(payload('sp_sadt_request'))])).rejects.toThrow('tiss_authorization_not_editable')
  })

  it('sent só a partir de ready; cancelamento de draft até aguardando resposta; member nunca opera', async () => {
    await asUser(ids.owner)
    const draft = await create({ items: [] })
    await expect(transition(draft.id, 'sent')).rejects.toThrow('tiss_authorization_invalid_transition')
    await transition(draft.id, 'cancelled')
    await expect(transition(draft.id, 'sent')).rejects.toThrow('tiss_authorization_invalid_transition')
    const a = await create()
    await transition(a.id, 'sent')
    // P1: member da mesma account recebe forbidden em toda RPC de escrita.
    await asUser(ids.member)
    await expect(transition(a.id, 'cancelled')).rejects.toThrow('tiss_authorization_forbidden')
    await expect(respond(a.id, '1')).rejects.toThrow('tiss_authorization_forbidden')
    await expect(db.query('select public.log_tiss_authorization_xml($1::uuid, $2)', [a.id, 'a'.repeat(32)])).rejects.toThrow('tiss_authorization_forbidden')
    await asUser(ids.owner)
    await transition(a.id, 'cancelled')
    expect((await events(a.id)).map((e) => [e.event, e.from_status, e.to_status])).toEqual([
      ['created', null, 'ready'], ['sent', 'ready', 'sent'], ['cancelled', 'sent', 'cancelled'],
    ])
  })

  it.each([
    ['1', 'authorized'], ['2', 'under_review'], ['3', 'denied'], ['4', 'pending_info'],
    ['5', 'pending_info'], ['6', 'cancelled'], ['7', 'partially_authorized'],
  ])('resposta %s → %s', async (code, status) => {
    await asUser(ids.owner)
    const a = await create()
    await transition(a.id, 'sent')
    const r = await respond(a.id, code)
    expect((r.rows[0] as { r: { status: string } }).r.status).toBe(status)
    await asSuperuser()
    const row = (await db.query<{ operator_guide_number: string; password: string; response_status_code: string }>(
      'select operator_guide_number, password, response_status_code from public.tiss_authorizations where id = $1', [a.id])).rows[0]
    expect(row).toEqual({ operator_guide_number: 'OP-123', password: 'SENHA9', response_status_code: code })
  })

  it('resposta grava quantidade/valor autorizado só de itens da própria autorização; correção em estado final (R1)', async () => {
    await asUser(ids.owner)
    const parent = await create()
    const opme = await create({ type: 'opme_request', parent: parent.id })
    await transition(opme.id, 'sent')
    await asSuperuser()
    const item = (await db.query<{ id: string }>('select id from public.tiss_authorization_items where authorization_id = $1', [opme.id])).rows[0]
    const foreign = (await db.query<{ id: string }>('select id from public.tiss_authorization_items where authorization_id = $1', [parent.id])).rows[0]
    await asUser(ids.owner)
    await expect(respond(opme.id, '7', [{ id: foreign.id, quantity_authorized: 1 }])).rejects.toThrow('tiss_authorization_item_not_found')
    await respond(opme.id, '2')
    await respond(opme.id, '7', [{ id: item.id, quantity_authorized: 1, authorized_value_cents: 120000 }])
    // R1: a resposta de um estado final pode ser registrada de novo (correção).
    const fixed = await respond(opme.id, '1')
    expect((fixed.rows[0] as { r: { status: string } }).r.status).toBe('authorized')
    // Estado final continua sem cancelamento.
    await expect(transition(opme.id, 'cancelled')).rejects.toThrow('tiss_authorization_invalid_transition')
    expect((await events(opme.id)).filter((e) => e.event === 'response_recorded').map((e) => [e.from_status, e.to_status])).toEqual([
      ['sent', 'under_review'], ['under_review', 'partially_authorized'], ['partially_authorized', 'authorized'],
    ])
    await asSuperuser()
    // Itens não citados na correção mantêm o que foi gravado antes.
    expect((await db.query('select quantity_authorized, authorized_value_cents from public.tiss_authorization_items where id = $1', [item.id])).rows)
      .toEqual([{ quantity_authorized: 1, authorized_value_cents: 120000 }])
  })

  it('resposta nunca a partir de draft, ready ou cancelled (R1 só reabre os finais)', async () => {
    await asUser(ids.owner)
    const draft = await create({ items: [] })
    await expect(respond(draft.id, '1')).rejects.toThrow('tiss_authorization_invalid_transition')
    const ready = await create()
    await expect(respond(ready.id, '1')).rejects.toThrow('tiss_authorization_invalid_transition')
    const viaOperator = await create()
    await transition(viaOperator.id, 'sent')
    await respond(viaOperator.id, '6')
    await expect(respond(viaOperator.id, '1')).rejects.toThrow('tiss_authorization_invalid_transition')
  })

  it('registro de XML gerado: só fora de draft e com hash MD5', async () => {
    await asUser(ids.owner)
    const draft = await create({ items: [] })
    await expect(db.query('select public.log_tiss_authorization_xml($1::uuid, $2)', [draft.id, 'a'.repeat(32)])).rejects.toThrow('tiss_authorization_incomplete')
    const a = await create()
    await expect(db.query('select public.log_tiss_authorization_xml($1::uuid, $2)', [a.id, 'xyz'])).rejects.toThrow('tiss_authorization_invalid')
    await db.query('select public.log_tiss_authorization_xml($1::uuid, $2)', [a.id, 'a'.repeat(32)])
    expect((await events(a.id)).map((e) => e.event)).toEqual(['created', 'xml_generated'])
  })

  it('usuário de outra account (mesmo sendo owner lá) não opera a autorização nem pelo RPC', async () => {
    await asUser(ids.owner)
    const a = await create()
    await asUser(ids.outsider)
    await expect(transition(a.id, 'cancelled')).rejects.toThrow('tiss_authorization_not_found')
  })
})

describe('faturamento intacto', () => {
  it('autorização e guia compartilham o contador sem colidir; o lote só enxerga guias', async () => {
    await asUser(ids.owner)
    await create({ appointment: ids.appointment })
    await asSuperuser()
    await db.exec(`update public.appointments set status = 'realizado' where id = '${ids.appointment}'`)
    // A geração da guia continua aberta a member (regra existente, inalterada).
    await asUser(ids.member)
    const guide = await db.query<{ r: { status: string } }>('select public.ensure_tiss_guide_for_appointment($1::uuid) as r', [ids.appointment])
    expect(guide.rows[0].r.status).toBe('created')
    await asSuperuser()
    const numbers = await db.query<{ n: string }>(
      `select provider_guide_number as n from public.tiss_guides
       union all select provider_guide_number from public.tiss_authorizations order by 1`)
    expect(numbers.rows.map((r) => r.n)).toEqual(['1', '2'])
    // Mesma consulta de lib/billing/batches.ts#createBatchesForInsurer.
    const batchable = await db.query(
      `select id from public.tiss_guides where insurer_id = $1 and account_id = $2 and status = 'ready' and batch_id is null`,
      [ids.insurer, ids.account])
    expect(batchable.rows).toHaveLength(1)
  })
})

describe('espelho em schema.sql', () => {
  it('o bloco está idêntico em schema.sql, antes do bloco authenticated do faturamento', async () => {
    const begin = '-- BEGIN TISS AUTHORIZATIONS'
    const end = '-- END TISS AUTHORIZATIONS'
    const block = migration.slice(migration.indexOf(begin), migration.indexOf(end) + end.length)
    const reset = await readFile('supabase/schema.sql', 'utf8')
    const extra = await readFile('supabase/billing-authenticated.sql', 'utf8')
    expect(migration.indexOf(begin)).toBeGreaterThan(-1)
    expect(reset.includes(block)).toBe(true)
    expect(reset.indexOf(block)).toBeLessThan(reset.indexOf('-- BEGIN BILLING AUTHENTICATED OPERATIONS'))
    expect(reset.endsWith(extra)).toBe(true)
    // O reset do schema apaga as tabelas novas antes de tiss_guides.
    for (const table of ['tiss_authorization_events', 'tiss_authorization_items', 'tiss_authorizations']) {
      expect(reset).toMatch(new RegExp(`drop table if exists[\\s\\S]*public\\.${table},[\\s\\S]*public\\.tiss_guides,`))
    }
    expect(reset).toContain('drop function if exists public.create_tiss_authorization(uuid, uuid, uuid, text, uuid, uuid, jsonb, text[], jsonb) cascade;')
  })
})
