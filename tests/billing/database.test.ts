import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { computeMissingFields } from '@/lib/billing/guides'
import type { GuidePayload } from '@/lib/billing/types'

const id = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ids = { account: id(1), workspace: id(2), doctor: id(3), member: id(4), owner: id(5), patient: id(6), insurer: id(7), procedure: id(8), insurance: id(9), appointment: id(10), otherAccount: id(11), otherWorkspace: id(12) }
let db: PGlite
let migration: string

async function asUser(userId: string, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [userId, role])
  await db.exec(`set role ${role}`)
}

async function ensure(appointmentId = ids.appointment) {
  const result = await db.query<{ result: Record<string, unknown> }>('select public.ensure_tiss_guide_for_appointment($1::uuid) as result', [appointmentId])
  return result.rows[0].result
}

async function generatedGuide() {
  await asUser(ids.member)
  const result = await ensure()
  await asUser(ids.owner)
  const guide = await db.query<{ id: string; payload: GuidePayload; missing_fields: string[]; status: string; service_date: string; updated_at: Date }>('select * from public.tiss_guides where id = $1', [result.guideId])
  return guide.rows[0]
}

async function finalize(guideId: string, updatedAt: Date, createdBy = ids.owner) {
  return db.query<{ id: string }>(`select public.finalize_tiss_batch(
    $1::uuid, $2::uuid, 1, '4.03.00', 'consulta', $3, $4, 15000, $5::uuid, array[$6::uuid], $7::jsonb
  ) as id`, [ids.account, ids.insurer, `${ids.account}/${ids.insurer}/1.xml`, 'a'.repeat(32), createdBy, guideId, JSON.stringify({ [guideId]: updatedAt.toISOString() })])
}

beforeAll(async () => {
  db = new PGlite()
  const base = await readFile('tests/billing/fixtures/database.sql', 'utf8')
  migration = await readFile('supabase/billing.sql', 'utf8')
  await db.exec(base)
  await db.exec(migration)
}, 30000)

afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await db.exec('reset role; truncate public.accounts, auth.users cascade;')
  await db.exec(`
    insert into auth.users (id) values ('${ids.doctor}'), ('${ids.member}'), ('${ids.owner}');
    insert into public.accounts (id, modules) values ('${ids.account}', array['billing']), ('${ids.otherAccount}', array['billing']);
    insert into public.workspaces (id, account_id, cnes, cnpj, legal_name) values
      ('${ids.workspace}', '${ids.account}', '1234567', '12345678000199', 'Clínica Fictícia'),
      ('${ids.otherWorkspace}', '${ids.otherAccount}', '7654321', null, 'Outra Clínica');
    insert into public.profiles (id, full_name, crm, crm_uf, cbo_code) values
      ('${ids.doctor}', 'Dra. Fictícia', '123456/SP', 'SP', '225125'),
      ('${ids.member}', 'Recepção Fictícia', null, null, null), ('${ids.owner}', 'Gestão Fictícia', null, null, null);
    insert into public.memberships (user_id, account_id, role) values
      ('${ids.doctor}', '${ids.account}', 'member'), ('${ids.member}', '${ids.account}', 'member'), ('${ids.owner}', '${ids.account}', 'owner');
    insert into public.patients (id, account_id, full_name) values ('${ids.patient}', '${ids.account}', 'Paciente Fictício');
    insert into public.health_insurers (id, account_id, name, ans_registry, provider_code) values
      ('${ids.insurer}', '${ids.account}', 'Operadora Fictícia', '999999', 'PREST0001');
    insert into public.insurer_procedures (id, insurer_id, account_id, tuss_code, description, price_cents, guide_type) values
      ('${ids.procedure}', '${ids.insurer}', '${ids.account}', '10101012', 'Consulta', 15000, 'consulta');
    insert into public.patient_insurances (id, account_id, patient_id, insurer_id, card_number) values
      ('${ids.insurance}', '${ids.account}', '${ids.patient}', '${ids.insurer}', 'FICT-CARD-001');
    insert into public.appointments (id, account_id, workspace_id, doctor_id, patient_id, patient_name, scheduled_at,
      status, billing_type, insurer_id, insurer_procedure_id, patient_insurance_id) values
      ('${ids.appointment}', '${ids.account}', '${ids.workspace}', '${ids.doctor}', '${ids.patient}', 'Paciente Fictício',
       '2026-09-30T01:30:00Z', 'realizado', 'convenio', '${ids.insurer}', '${ids.procedure}', '${ids.insurance}');
    insert into public.transcriptions (appointment_id, account_id, workspace_id, medical_record_final, status, signed_at) values
      ('${ids.appointment}', '${ids.account}', '${ids.workspace}', '{"soap":{"A":{"cid10":"Z00.0"}}}', 'signed', now());
  `)
})

describe('migração de faturamento em PostgreSQL com RLS real', () => {
  it('é idempotente e mantém o bloco de autorização igual no schema de reset', async () => {
    await db.exec(migration)
    const extra = await readFile('supabase/billing-authenticated.sql', 'utf8')
    const reset = await readFile('supabase/schema.sql', 'utf8')
    expect(migration.endsWith(extra)).toBe(true)
    expect(reset.endsWith(extra)).toBe(true)
  })

  it('member cria uma guia com CID e data SP sem receber payload ou acesso às guias', async () => {
    await asUser(ids.member)
    const created = await ensure()
    expect(created).toMatchObject({ status: 'created', guideStatus: 'ready', hasMissingFields: false })
    expect(JSON.stringify(created)).not.toMatch(/FICT-CARD|Paciente|Z00\.0|payload/)
    expect((await db.query('select * from public.tiss_guides')).rows).toEqual([])
    expect((await db.query('select * from public.tiss_batches')).rows).toEqual([])
    await expect(db.query('select public.next_tiss_number($1, $2)', [ids.insurer, 'batch'])).rejects.toThrow('billing_forbidden')
    await expect(db.query('select public.tiss_professional_for_appointment($1)', [ids.appointment])).rejects.toThrow('billing_forbidden')
    await asUser(ids.owner)
    const rows = await db.query<{ payload: GuidePayload; missing_fields: string[]; service_date: string }>('select payload, missing_fields, service_date::text from public.tiss_guides')
    expect(rows.rows[0].payload.service.cid10).toBe('Z00.0')
    expect(rows.rows[0].service_date).toBe('2026-09-29')
    expect(rows.rows[0].missing_fields).toEqual(computeMissingFields(rows.rows[0].payload))
  })

  it('sem carteirinha cria draft; chamadas repetidas mantêm número e guia únicos', async () => {
    await db.exec(`update public.appointments set patient_insurance_id = null`)
    await asUser(ids.member)
    const created = await ensure()
    expect(created).toMatchObject({ status: 'created', guideStatus: 'draft' })
    expect(await ensure()).toEqual({ status: 'exists', guideId: created.guideId })
    await asUser(ids.owner)
    const rows = await db.query<{ missing_fields: string[] }>('select missing_fields from public.tiss_guides')
    expect(rows.rows).toEqual([{ missing_fields: ['beneficiary.card_number'] }])
    expect((await db.query<{ next_guide_number: number }>('select next_guide_number from public.health_insurers')).rows[0].next_guide_number).toBe(2)
  })

  it('restringe a geração ao workspace do membro e respeita billing inativo e particular', async () => {
    await db.exec(`update public.memberships set workspace_ids = '{}' where user_id = '${ids.member}'`)
    await asUser(ids.member)
    expect(await ensure()).toEqual({ status: 'skipped', reason: 'not_found' })
    await db.exec('reset role')
    await db.exec(`update public.memberships set workspace_ids = null; update public.accounts set modules = '{}'`)
    await asUser(ids.member)
    expect(await ensure()).toEqual({ status: 'skipped', reason: 'module_off' })
    await db.exec('reset role')
    await db.exec(`update public.accounts set modules = array['billing']; update public.appointments set billing_type = 'particular'`)
    await asUser(ids.member)
    expect(await ensure()).toEqual({ status: 'skipped', reason: 'not_convenio' })
  })

  it('gera sequências diferentes para dois agendamentos e oferece apenas dados profissionais ao admin', async () => {
    await db.exec(`insert into public.appointments select '${id(20)}', account_id, workspace_id, doctor_id, patient_id, patient_name,
      scheduled_at, type, status, billing_type, insurer_id, patient_insurance_id, insurer_procedure_id, authorization_number, authorization_date
      from public.appointments where id = '${ids.appointment}'`)
    await asUser(ids.member)
    await Promise.all([ensure(), ensure(id(20))])
    await asUser(ids.owner)
    expect((await db.query<{ provider_guide_number: string }>('select provider_guide_number from public.tiss_guides order by provider_guide_number')).rows.map((g) => g.provider_guide_number)).toEqual(['1', '2'])
    const result = await db.query<{ result: Record<string, unknown> }>('select public.tiss_professional_for_appointment($1) as result', [ids.appointment])
    expect(result.rows[0].result).toEqual({ full_name: 'Dra. Fictícia', crm: '123456/SP', crm_uf: 'SP', cbo_code: '225125' })
  })

  it('finaliza e envia o lote com o client autenticado, de forma atômica e sem duplicata', async () => {
    const guide = await generatedGuide()
    const batch = await finalize(guide.id, guide.updated_at)
    expect((await db.query<{ status: string }>('select status from public.tiss_guides')).rows[0].status).toBe('batched')
    await expect(finalize(guide.id, guide.updated_at)).rejects.toThrow('tiss_guides_changed')
    expect((await db.query('select * from public.tiss_batches')).rows).toHaveLength(1)
    await db.query('select public.mark_tiss_batch_sent($1)', [batch.rows[0].id])
    expect((await db.query<{ status: string }>('select status from public.tiss_guides')).rows[0].status).toBe('sent')
    expect((await db.query<{ sent_by: string }>('select sent_by from public.tiss_batches')).rows[0].sent_by).toBe(ids.owner)
  })

  it('recusa snapshot modificado e autoria forjada sem mudar guias ou criar lotes', async () => {
    const guide = await generatedGuide()
    await expect(finalize(guide.id, guide.updated_at, ids.member)).rejects.toThrow('billing_forbidden')
    await db.query("update public.tiss_guides set total_cents = total_cents + 1 where id = $1", [guide.id])
    await expect(finalize(guide.id, guide.updated_at)).rejects.toThrow('tiss_guides_changed')
    expect((await db.query<{ status: string }>('select status from public.tiss_guides')).rows[0].status).toBe('ready')
    expect((await db.query('select * from public.tiss_batches')).rows).toEqual([])
  })
})
