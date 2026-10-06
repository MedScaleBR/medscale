import { describe, expect, it } from 'vitest'
import {
  buildResponseItems, buildRequestPatch, fileNameFromDisposition, phoneDigits,
} from '@/components/billing/authorizations/sheet-helpers'
import type { AuthorizationItem, HospitalizationRequestData, SpSadtRequestData } from '@/lib/billing/authorizations/types'

const sp: SpSadtRequestData = {
  stage: '1', absence_code: null, code: null, character: '1', clinical_indication: null,
  special_coverage: null, main_guide_number: null, executor: null, observation: null,
}
const hosp: HospitalizationRequestData = {
  stage: '1', absence_code: null, code: null, character: '1',
  hospital: { operator_code: null, name: null, suggested_date: null },
  hospitalization_type: '1', regime: '1', daily_count: null, opme_expected: false, chemo_expected: false,
  clinical_indication: null, cid10: ['K359'], accident: '9', observation: null,
}

describe('buildRequestPatch', () => {
  it('returns null when nothing changed, treating blank text as null', () => {
    expect(buildRequestPatch(sp, { ...sp, clinical_indication: '   ', executor: { operator_code: '', cnes: '' } })).toBeNull()
  })

  it('sends only changed keys, trimmed', () => {
    expect(buildRequestPatch(sp, { ...sp, clinical_indication: ' dor  ', character: '2' })).toEqual({
      clinical_indication: 'dor',
      character: '2',
    })
  })

  it('sends executor as object when filled and null when cleared', () => {
    expect(buildRequestPatch(sp, { ...sp, executor: { operator_code: '123', cnes: '1234567' } })).toEqual({
      executor: { operator_code: '123', cnes: '1234567' },
    })
    const withExecutor = { ...sp, executor: { operator_code: '123', cnes: '1234567' } }
    expect(buildRequestPatch(withExecutor, { ...withExecutor, executor: { operator_code: ' ', cnes: '' } })).toEqual({
      executor: null,
    })
  })

  it('keeps hospital as an object and drops blank CIDs', () => {
    expect(buildRequestPatch(hosp, { ...hosp, cid10: ['K359', '', ' '] })).toBeNull()
    expect(
      buildRequestPatch(hosp, { ...hosp, hospital: { ...hosp.hospital, name: 'Hospital X' }, cid10: ['K359', 'j18.9'] }),
    ).toEqual({
      hospital: { operator_code: null, name: 'Hospital X', suggested_date: null },
      cid10: ['K359', 'j18.9'],
    })
  })

  it('compares hospital regardless of key order from jsonb', () => {
    const fromDb = { ...hosp, hospital: { suggested_date: null, name: 'H', operator_code: null } }
    expect(buildRequestPatch(fromDb, { ...fromDb, hospital: { operator_code: null, name: 'H', suggested_date: null } })).toBeNull()
  })
})

const item = (over: Partial<AuthorizationItem>): AuthorizationItem => ({
  id: 'i1', position: 1, kind: 'procedure', table_code: '22', code: '10101012', description: 'Consulta',
  quantity_requested: 2, quantity_authorized: null, authorized_value_cents: null, manufacturer_option: null,
  requested_value_cents: null, anvisa_registration: null, manufacturer_reference: null, operating_authorization: null,
  ...over,
})

describe('buildResponseItems', () => {
  it('sends both keys for every item, null when blank', () => {
    const r = buildResponseItems([item({ id: 'a' }), item({ id: 'b', kind: 'opme' })], {
      a: { quantity: '', value: '' },
      b: { quantity: '1', value: '1.234,50' },
    })
    expect(r).toEqual({
      ok: true,
      value: [
        { id: 'a', quantity_authorized: null, authorized_value_cents: null },
        { id: 'b', quantity_authorized: 1, authorized_value_cents: 123450 },
      ],
    })
  })

  it('never sends authorized value for procedure items', () => {
    const r = buildResponseItems([item({ id: 'a' })], { a: { quantity: '2', value: '10,00' } })
    expect(r).toEqual({ ok: true, value: [{ id: 'a', quantity_authorized: 2, authorized_value_cents: null }] })
  })

  it('rejects quantity above requested, out of range or invalid value', () => {
    expect(buildResponseItems([item({ id: 'a' })], { a: { quantity: '3', value: '' } }).ok).toBe(false)
    expect(buildResponseItems([item({ id: 'a' })], { a: { quantity: '-1', value: '' } }).ok).toBe(false)
    expect(buildResponseItems([item({ id: 'a' })], { a: { quantity: '1.5', value: '' } }).ok).toBe(false)
    expect(buildResponseItems([item({ id: 'b', kind: 'opme' })], { b: { quantity: '1', value: 'abc' } }).ok).toBe(false)
  })

  it('accepts zero authorized', () => {
    expect(buildResponseItems([item({ id: 'a' })], { a: { quantity: '0', value: '' } })).toEqual({
      ok: true,
      value: [{ id: 'a', quantity_authorized: 0, authorized_value_cents: null }],
    })
  })
})

describe('fileNameFromDisposition', () => {
  it('reads the quoted filename', () => {
    expect(fileNameFromDisposition('attachment; filename="00000000000000000001_abc.xml"')).toBe(
      '00000000000000000001_abc.xml',
    )
  })
  it('falls back to null', () => {
    expect(fileNameFromDisposition(null)).toBeNull()
    expect(fileNameFromDisposition('attachment')).toBeNull()
  })
})

describe('phoneDigits', () => {
  it('strips formatting (st_texto11 keeps digits only)', () => {
    expect(phoneDigits('(11) 98765-4321')).toBe('11987654321')
    expect(phoneDigits('  ')).toBeNull()
  })
})
