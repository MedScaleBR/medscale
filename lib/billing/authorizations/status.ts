import type { StatusSolicitacao } from './domains'
import type { AuthorizationStatus, AuthorizationType } from './types'

// Espelho em TS das regras dos RPCs (supabase/tiss-authorizations.sql). O
// banco decide; isto serve para a UI esconder botões e a API responder 409
// sem ir ao banco. Não há regra por papel: só owner/admin chegam às rotas
// (requireBilling adminOnly), à RLS e aos RPCs (P1).
export const AUTHORIZATION_STATUSES: readonly AuthorizationStatus[] = [
  'draft', 'ready', 'sent', 'under_review', 'pending_info', 'authorized', 'partially_authorized', 'denied', 'cancelled',
]
export const AUTHORIZATION_TYPES: readonly AuthorizationType[] = ['sp_sadt_request', 'hospitalization_request', 'opme_request']

export const isAuthorizationStatus = (v: unknown): v is AuthorizationStatus =>
  typeof v === 'string' && (AUTHORIZATION_STATUSES as readonly string[]).includes(v)
export const isAuthorizationType = (v: unknown): v is AuthorizationType =>
  typeof v === 'string' && (AUTHORIZATION_TYPES as readonly string[]).includes(v)

export const STATUS_FROM_RESPONSE: Record<StatusSolicitacao, AuthorizationStatus> = {
  '1': 'authorized',
  '2': 'under_review',
  '3': 'denied',
  '4': 'pending_info',
  '5': 'pending_info',
  '6': 'cancelled',
  '7': 'partially_authorized',
}

const EDITABLE: readonly AuthorizationStatus[] = ['draft', 'ready']
const AWAITING_RESPONSE: readonly AuthorizationStatus[] = ['sent', 'under_review', 'pending_info']
// R1: resposta já final pode ser registrada de novo (correção).
const FINAL_RESPONSE: readonly AuthorizationStatus[] = ['authorized', 'partially_authorized', 'denied']

export const statusForMissing = (missing: readonly string[]): 'draft' | 'ready' => (missing.length === 0 ? 'ready' : 'draft')
export const isEditable = (status: AuthorizationStatus) => EDITABLE.includes(status)
export const canMarkSent = (status: AuthorizationStatus) => status === 'ready'

export function canCancel(status: AuthorizationStatus): boolean {
  return EDITABLE.includes(status) || AWAITING_RESPONSE.includes(status)
}

export function canRecordResponse(status: AuthorizationStatus): boolean {
  return AWAITING_RESPONSE.includes(status) || FINAL_RESPONSE.includes(status)
}
