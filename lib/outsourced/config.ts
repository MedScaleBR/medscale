import { brazilianPhoneKey, normalizeBrazilianPhone } from '@/lib/phone'

export const PENDING_STATUS_FORBIDDEN_ERROR = 'O status "Aguardando clínica" é definido apenas pela Clara.'

export const OUTSOURCED_PHONE_REQUIRED_ERROR = 'Informe o WhatsApp da clínica parceira com DDD para ativar o agendamento terceirizado.'
export const OUTSOURCED_PHONE_INVALID_ERROR = 'Informe um WhatsApp válido para a clínica parceira, com DDD. Ex.: (71) 99999-0000.'

export interface OutsourcedFlags {
  is_outsourced: boolean
  external_clinic_phone: string | null
}

/** Fluxo terceirizado só vale com o toggle ligado e o WhatsApp da clínica preenchido. */
export function isOutsourcedWorkspace(ws: OutsourcedFlags): boolean {
  return ws.is_outsourced === true && !!ws.external_clinic_phone?.trim()
}

/** Valida os campos terceirizados de um body de PATCH; só olha as chaves presentes. */
export function parseOutsourcedFields(
  body: Record<string, unknown>,
  current: OutsourcedFlags
): { ok: true; value: Partial<OutsourcedFlags> } | { ok: false; error: string } {
  const value: Partial<OutsourcedFlags> = {}

  if ('is_outsourced' in body) value.is_outsourced = body.is_outsourced === true

  if ('external_clinic_phone' in body) {
    const raw = body.external_clinic_phone
    if (raw === null || (typeof raw === 'string' && !raw.trim())) {
      value.external_clinic_phone = null
    } else {
      const phone = normalizeBrazilianPhone(raw)
      if (!phone) return { ok: false, error: OUTSOURCED_PHONE_INVALID_ERROR }
      value.external_clinic_phone = phone
    }
  }

  const finalOutsourced = value.is_outsourced ?? current.is_outsourced
  const finalPhone =
    'external_clinic_phone' in value ? value.external_clinic_phone : current.external_clinic_phone
  if (finalOutsourced && !finalPhone) return { ok: false, error: OUTSOURCED_PHONE_REQUIRED_ERROR }

  return { ok: true, value }
}

export type ClinicSenderMatch =
  | { kind: 'none' }
  | { kind: 'match'; workspaceId: string }
  | { kind: 'conflict'; workspaceIds: string[] }

/** Descobre a unidade terceirizada cujo número de clínica parceira enviou a mensagem. */
export function matchClinicSender(
  workspaces: Array<OutsourcedFlags & { id: string }>,
  senderPhone: string
): ClinicSenderMatch {
  const key = brazilianPhoneKey(senderPhone)
  const ids = workspaces
    .filter((w) => isOutsourcedWorkspace(w) && brazilianPhoneKey(w.external_clinic_phone!) === key)
    .map((w) => w.id)
  if (ids.length === 0) return { kind: 'none' }
  if (ids.length === 1) return { kind: 'match', workspaceId: ids[0] }
  return { kind: 'conflict', workspaceIds: ids }
}

export type OutsourcedMissingField = 'nome' | 'nascimento' | 'convenio'

/** Dados que a clínica parceira ainda precisa do paciente, em ordem fixa. */
export function missingOutsourcedFields(input: {
  fullName: string | null
  birthDate: string | null
  insuranceChosen: boolean
}): OutsourcedMissingField[] {
  const missing: OutsourcedMissingField[] = []
  const name = input.fullName?.trim()
  if (!name || name === 'Paciente') missing.push('nome')
  if (!input.birthDate) missing.push('nascimento')
  if (!input.insuranceChosen) missing.push('convenio')
  return missing
}
