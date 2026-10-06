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
    await expect(db.query(`insert into public.tiss_authorization_events (authorization_id, account_id, event) values ($1, $2, 'sent')`,
      [id(100), ids.account])).rejects.toThrow(/permission denied/)
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
