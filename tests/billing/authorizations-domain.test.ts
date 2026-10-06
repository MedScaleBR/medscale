import { describe, it, expect } from 'vitest'
import { STATUS_SOLICITACAO, TABELA, isCode } from '@/lib/billing/authorizations/domains'
import {
  STATUS_FROM_RESPONSE, canCancel, canMarkSent, canRecordResponse, isEditable, statusForMissing,
} from '@/lib/billing/authorizations/status'
import { AUTHORIZATION_STATUS_LABELS } from '@/lib/billing/authorizations/constants'

describe('máquina de estados (espelha os RPCs)', () => {
  it('mapeia dm_statusSolicitacao como no design (D3)', () => {
    expect(STATUS_FROM_RESPONSE).toEqual({
      '1': 'authorized', '2': 'under_review', '3': 'denied', '4': 'pending_info',
      '5': 'pending_info', '6': 'cancelled', '7': 'partially_authorized',
    })
    expect(Object.keys(STATUS_SOLICITACAO)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
  })

  it('edição só em draft/ready; envio só de ready', () => {
    expect(isEditable('draft')).toBe(true)
    expect(isEditable('ready')).toBe(true)
    for (const s of ['sent', 'under_review', 'pending_info', 'authorized', 'partially_authorized', 'denied', 'cancelled'] as const) {
      expect(isEditable(s)).toBe(false)
      expect(canMarkSent(s)).toBe(false)
    }
    expect(canMarkSent('ready')).toBe(true)
    expect(canMarkSent('draft')).toBe(false)
  })

  it('cancela de draft até aguardando resposta; finais e cancelada nunca', () => {
    for (const s of ['draft', 'ready', 'sent', 'under_review', 'pending_info'] as const) expect(canCancel(s)).toBe(true)
    for (const s of ['authorized', 'partially_authorized', 'denied', 'cancelled'] as const) expect(canCancel(s)).toBe(false)
  })

  it('resposta depois do envio e, por R1, de novo em estado final; nunca de draft/ready/cancelled', () => {
    for (const s of ['sent', 'under_review', 'pending_info', 'authorized', 'partially_authorized', 'denied'] as const) {
      expect(canRecordResponse(s)).toBe(true)
    }
    for (const s of ['draft', 'ready', 'cancelled'] as const) expect(canRecordResponse(s)).toBe(false)
  })

  it('draft/ready por missing_fields', () => {
    expect(statusForMissing([])).toBe('ready')
    expect(statusForMissing(['items'])).toBe('draft')
  })

  it('domínios fechados: só códigos do XSD', () => {
    expect(isCode(TABELA, '19')).toBe(true)
    expect(isCode(TABELA, '21')).toBe(false)
    expect(isCode(TABELA, 'toString')).toBe(false)
    expect(Object.keys(AUTHORIZATION_STATUS_LABELS)).toHaveLength(9)
  })
})
