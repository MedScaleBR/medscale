import { describe, expect, it } from 'vitest'
import {
  OUTSOURCED_PHONE_INVALID_ERROR,
  OUTSOURCED_PHONE_REQUIRED_ERROR,
  isOutsourcedWorkspace,
  matchClinicSender,
  missingOutsourcedFields,
  parseOutsourcedFields,
} from '../../lib/outsourced/config'

const OFF = { is_outsourced: false, external_clinic_phone: null }
const ON = { is_outsourced: true, external_clinic_phone: '5571999990000' }

describe('outsourced config', () => {
  it('isOutsourcedWorkspace exige os dois campos', () => {
    expect(isOutsourcedWorkspace({ is_outsourced: true, external_clinic_phone: '5571999990000' })).toBe(true)
    expect(isOutsourcedWorkspace({ is_outsourced: true, external_clinic_phone: null })).toBe(false)
    expect(isOutsourcedWorkspace({ is_outsourced: true, external_clinic_phone: '  ' })).toBe(false)
    expect(isOutsourcedWorkspace({ is_outsourced: false, external_clinic_phone: '5571999990000' })).toBe(false)
  })

  it('parseOutsourcedFields', () => {
    expect(parseOutsourcedFields({ name: 'x' }, OFF)).toEqual({ ok: true, value: {} })
    expect(parseOutsourcedFields({ is_outsourced: true }, OFF)).toEqual({ ok: false, error: OUTSOURCED_PHONE_REQUIRED_ERROR })
    expect(parseOutsourcedFields({ is_outsourced: true, external_clinic_phone: '' }, OFF)).toEqual({ ok: false, error: OUTSOURCED_PHONE_REQUIRED_ERROR })
    expect(parseOutsourcedFields({ is_outsourced: true, external_clinic_phone: '7199' }, OFF)).toEqual({ ok: false, error: OUTSOURCED_PHONE_INVALID_ERROR })
    expect(parseOutsourcedFields({ is_outsourced: true, external_clinic_phone: '(71) 99999-0000' }, OFF))
      .toEqual({ ok: true, value: { is_outsourced: true, external_clinic_phone: '5571999990000' } })
    expect(parseOutsourcedFields({ is_outsourced: false, external_clinic_phone: '' }, ON))
      .toEqual({ ok: true, value: { is_outsourced: false, external_clinic_phone: null } })
    expect(parseOutsourcedFields({ external_clinic_phone: '' }, ON))
      .toEqual({ ok: false, error: OUTSOURCED_PHONE_REQUIRED_ERROR })
  })

  it('matchClinicSender', () => {
    const ws = [
      { id: 'lauro', is_outsourced: true, external_clinic_phone: '5571999990000' },
      { id: 'pituba', is_outsourced: true, external_clinic_phone: '5571988880000' },
      { id: 'nativa', is_outsourced: false, external_clinic_phone: '5571977770000' },
    ]
    expect(matchClinicSender(ws, '557188880000')).toEqual({ kind: 'match', workspaceId: 'pituba' })
    expect(matchClinicSender(ws, '5571977770000')).toEqual({ kind: 'none' })
    expect(matchClinicSender([...ws, { id: 'dup', is_outsourced: true, external_clinic_phone: '5571999990000' }], '5571999990000'))
      .toEqual({ kind: 'conflict', workspaceIds: ['lauro', 'dup'] })
  })

  it('missingOutsourcedFields', () => {
    expect(missingOutsourcedFields({ fullName: 'Paciente', birthDate: null, insuranceChosen: false })).toEqual(['nome', 'nascimento', 'convenio'])
    expect(missingOutsourcedFields({ fullName: 'Maria Souza', birthDate: '1980-05-03', insuranceChosen: true })).toEqual([])
  })
})
