import { isDate } from '../validation'
import { MAX_AUTHORIZATION_ITEMS, MAX_VALUE_CENTS } from './constants'
import {
  AUSENCIA_COD_VALIDACAO, CARATER_ATENDIMENTO, COBERTURA_ESPECIAL, ETAPA_AUTORIZACAO, INDICADOR_ACIDENTE,
  OPCAO_FABRICANTE, REGIME_INTERNACAO, STATUS_SOLICITACAO, TABELA, TIPO_INTERNACAO, isCode,
  type StatusSolicitacao,
} from './domains'
import { isAuthorizationType } from './status'
import type { AuthorizationItem, AuthorizationItemInput, AuthorizationType, RequestDataByType } from './types'

// Corpos das rotas /api/billing/authorizations/*. Texto acima do maxLength do
// XSD é recusado (400) — nunca cortado em silêncio. O gerador XML ainda corta
// texto livre por defesa, mas identificadores nunca.

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function optionalText(v: unknown, max: number, label: string): Result<string | null> {
  if (v === null || v === undefined) return ok(null)
  if (typeof v !== 'string') return fail(`${label}: valor inválido.`)
  const t = v.trim()
  if (!t) return ok(null)
  if (t.length > max) return fail(`${label}: máximo de ${max} caracteres.`)
  return ok(t)
}

function optionalDate(v: unknown, label: string): Result<string | null> {
  if (v === null || v === undefined || v === '') return ok(null)
  return isDate(v) ? ok(v as string) : fail(`${label}: data inválida.`)
}

function optionalUuid(v: unknown, label: string): Result<string | null> {
  if (v === null || v === undefined || v === '') return ok(null)
  return typeof v === 'string' && UUID.test(v) ? ok(v) : fail(`${label}: identificador inválido.`)
}

function optionalCents(v: unknown, label: string): Result<number | null> {
  if (v === null || v === undefined) return ok(null)
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_VALUE_CENTS
    ? ok(v as number)
    : fail(`${label}: valor inválido.`)
}

// Repassado ao RPC exatamente como veio do banco: new Date() perderia os
// microssegundos e o RPC acusaria "alterada por outra pessoa".
export function parseExpectedUpdatedAt(v: unknown): Result<string> {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? ok(v) : fail('expected_updated_at é obrigatório.')
}

// CID-10 sem ponto e em maiúsculas: "k35.9" → "K359" (st_texto4).
export function normalizeCid10(v: string): string | null {
  const c = v.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  return /^[A-Z][0-9]{2,3}$/.test(c) ? c : null
}

type FieldSpec =
  | { kind: 'text'; max: number; label: string }
  | { kind: 'code'; domain: Readonly<Record<string, string>>; label: string; nullable: boolean }
  | { kind: 'bool'; label: string }
  | { kind: 'int'; min: number; max: number; label: string }

const VALIDATION_FIELDS: Record<string, FieldSpec> = {
  stage: { kind: 'code', domain: ETAPA_AUTORIZACAO, label: 'Etapa da autorização', nullable: false },
  absence_code: { kind: 'code', domain: AUSENCIA_COD_VALIDACAO, label: 'Ausência do código de validação', nullable: true },
  code: { kind: 'text', max: 10, label: 'Código de validação' },
}
const CHARACTER: FieldSpec = { kind: 'code', domain: CARATER_ATENDIMENTO, label: 'Caráter do atendimento', nullable: false }

const REQUEST_FIELDS: { [K in AuthorizationType]: Record<string, FieldSpec> } = {
  sp_sadt_request: {
    ...VALIDATION_FIELDS,
    character: CHARACTER,
    clinical_indication: { kind: 'text', max: 500, label: 'Indicação clínica' },
    special_coverage: { kind: 'code', domain: COBERTURA_ESPECIAL, label: 'Cobertura especial', nullable: true },
    main_guide_number: { kind: 'text', max: 20, label: 'Número da guia principal' },
    observation: { kind: 'text', max: 500, label: 'Observação' },
  },
  hospitalization_request: {
    ...VALIDATION_FIELDS,
    character: CHARACTER,
    hospitalization_type: { kind: 'code', domain: TIPO_INTERNACAO, label: 'Tipo de internação', nullable: false },
    regime: { kind: 'code', domain: REGIME_INTERNACAO, label: 'Regime de internação', nullable: false },
    daily_count: { kind: 'int', min: 1, max: 99, label: 'Diárias solicitadas' },
    opme_expected: { kind: 'bool', label: 'Previsão de OPME' },
    chemo_expected: { kind: 'bool', label: 'Previsão de quimioterápico' },
    clinical_indication: { kind: 'text', max: 500, label: 'Indicação clínica' },
    accident: { kind: 'code', domain: INDICADOR_ACIDENTE, label: 'Indicação de acidente', nullable: false },
    observation: { kind: 'text', max: 1000, label: 'Observação' },
  },
  opme_request: {
    technical_justification: { kind: 'text', max: 1000, label: 'Justificativa técnica' },
    material_specification: { kind: 'text', max: 500, label: 'Especificação do material' },
    observation: { kind: 'text', max: 500, label: 'Observação' },
  },
}

function parseField(spec: FieldSpec, v: unknown): Result<unknown> {
  switch (spec.kind) {
    case 'text':
      return optionalText(v, spec.max, spec.label)
    case 'bool':
      return typeof v === 'boolean' ? ok(v) : fail(`${spec.label}: valor inválido.`)
    case 'int':
      if (v === null || v === '') return ok(null)
      return Number.isInteger(v) && (v as number) >= spec.min && (v as number) <= spec.max
        ? ok(v)
        : fail(`${spec.label}: entre ${spec.min} e ${spec.max}.`)
    case 'code':
      if (spec.nullable && (v === null || v === '')) return ok(null)
      return isCode(spec.domain, v) ? ok(v) : fail(`${spec.label}: opção inválida.`)
  }
}

// Aplica um patch parcial sobre o pedido atual. Chaves desconhecidas → 400.
export function parseRequestPatch<T extends AuthorizationType>(
  type: T,
  current: RequestDataByType[T],
  patch: unknown,
): Result<RequestDataByType[T]> {
  if (!isRecord(patch)) return fail('Dados da solicitação inválidos.')
  const next = structuredClone(current) as unknown as Record<string, unknown>
  const specs: Record<string, FieldSpec> = REQUEST_FIELDS[type]

  for (const [key, value] of Object.entries(patch)) {
    const spec = specs[key]
    if (spec) {
      const r = parseField(spec, value)
      if (!r.ok) return fail(r.error)
      next[key] = r.value
    } else if (type === 'sp_sadt_request' && key === 'executor') {
      if (value === null) {
        next.executor = null
        continue
      }
      if (!isRecord(value)) return fail('Executante inválido.')
      const code = optionalText(value.operator_code, 14, 'Código do executante na operadora')
      if (!code.ok) return fail(code.error)
      const cnes = typeof value.cnes === 'string' ? value.cnes.replace(/\D/g, '') : ''
      if (!code.value || !/^\d{7}$/.test(cnes)) return fail('Executante: código na operadora e CNES (7 dígitos) são obrigatórios.')
      next.executor = { operator_code: code.value, cnes }
    } else if (type === 'hospitalization_request' && key === 'hospital') {
      if (!isRecord(value)) return fail('Hospital inválido.')
      const hospital = { ...(next.hospital as Record<string, unknown>) }
      if ('operator_code' in value) {
        const r = optionalText(value.operator_code, 14, 'Código do hospital na operadora')
        if (!r.ok) return fail(r.error)
        hospital.operator_code = r.value
      }
      if ('name' in value) {
        const r = optionalText(value.name, 70, 'Nome do hospital')
        if (!r.ok) return fail(r.error)
        hospital.name = r.value
      }
      if ('suggested_date' in value) {
        const r = optionalDate(value.suggested_date, 'Data sugerida da internação')
        if (!r.ok) return fail(r.error)
        hospital.suggested_date = r.value
      }
      next.hospital = hospital
    } else if (type === 'hospitalization_request' && key === 'cid10') {
      if (!Array.isArray(value) || value.length > 4) return fail('Informe até 4 CIDs.')
      const cids: string[] = []
      for (const raw of value) {
        const cid = typeof raw === 'string' ? normalizeCid10(raw) : null
        if (!cid) return fail('CID-10 inválido (ex.: K35.9).')
        cids.push(cid)
      }
      next.cid10 = cids
    } else {
      return fail(`Campo desconhecido: ${key}.`)
    }
  }
  return ok(next as unknown as RequestDataByType[T])
}

export function parseItems(type: AuthorizationType, body: unknown): Result<AuthorizationItemInput[]> {
  if (!Array.isArray(body)) return fail('Itens inválidos.')
  if (body.length > MAX_AUTHORIZATION_ITEMS) return fail(`No máximo ${MAX_AUTHORIZATION_ITEMS} itens.`)
  const opme = type === 'opme_request'
  const out: AuthorizationItemInput[] = []

  for (let i = 0; i < body.length; i++) {
    const raw: unknown = body[i]
    const n = i + 1
    if (!isRecord(raw)) return fail(`Item ${n} inválido.`)
    if (!isCode(TABELA, raw.table_code)) return fail(`Item ${n}: tabela inválida.`)
    const code = typeof raw.code === 'string' ? raw.code.trim() : ''
    // codigoProcedimento st_texto10 — identificador, nunca cortado.
    if (!/^[0-9A-Za-z.-]{1,10}$/.test(code)) return fail(`Item ${n}: código inválido (até 10 caracteres, sem espaços).`)
    const description = optionalText(raw.description, 150, `Item ${n} — descrição`)
    if (!description.ok) return fail(description.error)
    if (!description.value) return fail(`Item ${n}: descrição é obrigatória.`)
    const quantity = raw.quantity_requested
    if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 999) {
      return fail(`Item ${n}: quantidade entre 1 e 999.`)
    }
    const item: AuthorizationItemInput = {
      table_code: raw.table_code,
      code,
      description: description.value,
      quantity_requested: quantity as number,
      manufacturer_option: null,
      requested_value_cents: null,
      anvisa_registration: null,
      manufacturer_reference: null,
      operating_authorization: null,
    }
    if (opme) {
      if (!isCode(OPCAO_FABRICANTE, raw.manufacturer_option)) return fail(`Item ${n}: opção de fabricante é obrigatória.`)
      item.manufacturer_option = raw.manufacturer_option
      const value = optionalCents(raw.requested_value_cents, `Item ${n} — valor`)
      if (!value.ok) return fail(value.error)
      item.requested_value_cents = value.value
      for (const [field, max, label] of [
        ['anvisa_registration', 15, 'registro ANVISA'],
        ['manufacturer_reference', 60, 'referência do fabricante'],
        ['operating_authorization', 30, 'autorização de funcionamento'],
      ] as const) {
        const r = optionalText(raw[field], max, `Item ${n} — ${label}`)
        if (!r.ok) return fail(r.error)
        item[field] = r.value
      }
    }
    out.push(item)
  }
  return ok(out)
}

export interface CreateInput {
  type: AuthorizationType
  appointment_id: string | null
  parent_id: string | null
  patient_id: string | null
  insurer_id: string | null
  patient_insurance_id: string | null
  professional_id: string | null
}

export function parseCreateBody(body: unknown): Result<CreateInput> {
  if (!isRecord(body) || !isAuthorizationType(body.type)) return fail('Tipo de autorização inválido.')
  const out: CreateInput = {
    type: body.type, appointment_id: null, parent_id: null, patient_id: null,
    insurer_id: null, patient_insurance_id: null, professional_id: null,
  }
  for (const key of ['appointment_id', 'parent_id', 'patient_id', 'insurer_id', 'patient_insurance_id', 'professional_id'] as const) {
    const r = optionalUuid(body[key], key)
    if (!r.ok) return fail(r.error)
    out[key] = r.value
  }
  if ((out.type === 'opme_request') !== (out.parent_id !== null)) {
    return fail('O anexo OPME é criado a partir de uma SP/SADT ou Internação.')
  }
  if (out.type !== 'opme_request' && !out.appointment_id && !(out.patient_id && out.insurer_id)) {
    return fail('Informe o agendamento ou o paciente e a operadora.')
  }
  return ok(out)
}

export interface ContentPatch {
  expected_updated_at: string
  refresh: boolean
  card_number?: string | null
  newborn?: boolean
  patient_insurance_id?: string | null
  professional_id?: string | null
  professional_phone?: string | null
  professional_email?: string | null
  requested_at?: string
  request?: unknown
}

export function parseContentPatch(body: unknown): Result<ContentPatch> {
  if (!isRecord(body)) return fail('Corpo inválido.')
  const at = parseExpectedUpdatedAt(body.expected_updated_at)
  if (!at.ok) return fail(at.error)
  const out: ContentPatch = { expected_updated_at: at.value, refresh: body.action === 'refresh' }
  if (out.refresh) return ok(out)

  if ('card_number' in body) {
    // numeroCarteira st_texto20 — identificador.
    const r = optionalText(body.card_number, 20, 'Carteirinha')
    if (!r.ok) return fail(r.error)
    out.card_number = r.value
  }
  if ('newborn' in body) {
    if (typeof body.newborn !== 'boolean') return fail('Atendimento a RN inválido.')
    out.newborn = body.newborn
  }
  for (const key of ['patient_insurance_id', 'professional_id'] as const) {
    if (key in body) {
      const r = optionalUuid(body[key], key)
      if (!r.ok) return fail(r.error)
      out[key] = r.value
    }
  }
  if ('professional_phone' in body) {
    const raw = typeof body.professional_phone === 'string' ? body.professional_phone.replace(/\D/g, '') : ''
    if (raw && !/^\d{10,11}$/.test(raw)) return fail('Telefone: DDD + número (10 ou 11 dígitos).')
    out.professional_phone = raw || null
  }
  if ('professional_email' in body) {
    const r = optionalText(body.professional_email, 60, 'E-mail do profissional')
    if (!r.ok) return fail(r.error)
    if (r.value && !/^[^\s@]+@[^\s@]+$/.test(r.value)) return fail('E-mail do profissional inválido.')
    out.professional_email = r.value
  }
  if ('requested_at' in body) {
    if (!isDate(body.requested_at)) return fail('Data da solicitação inválida.')
    out.requested_at = body.requested_at as string
  }
  if ('request' in body) out.request = body.request
  return ok(out)
}

export interface ResponseInput {
  expected_updated_at: string
  status_code: StatusSolicitacao
  operator_guide_number: string | null
  password: string | null
  authorization_date: string | null
  password_valid_until: string | null
  items: Array<{ id: string; quantity_authorized: number | null; authorized_value_cents: number | null }>
}

export function parseResponseBody(
  body: unknown,
  items: Array<Pick<AuthorizationItem, 'id' | 'kind'>>,
): Result<ResponseInput> {
  if (!isRecord(body)) return fail('Corpo inválido.')
  const at = parseExpectedUpdatedAt(body.expected_updated_at)
  if (!at.ok) return fail(at.error)
  if (!isCode(STATUS_SOLICITACAO, body.status_code)) return fail('Status da resposta inválido.')
  const number = optionalText(body.operator_guide_number, 20, 'Número da guia na operadora')
  if (!number.ok) return fail(number.error)
  const password = optionalText(body.password, 20, 'Senha')
  if (!password.ok) return fail(password.error)
  const authorizationDate = optionalDate(body.authorization_date, 'Data da autorização')
  if (!authorizationDate.ok) return fail(authorizationDate.error)
  const validUntil = optionalDate(body.password_valid_until, 'Validade da senha')
  if (!validUntil.ok) return fail(validUntil.error)

  const byId = new Map(items.map((i) => [i.id, i]))
  const rawItems = body.items ?? []
  if (!Array.isArray(rawItems)) return fail('Itens da resposta inválidos.')
  const seen = new Set<string>()
  const outItems: ResponseInput['items'] = []
  for (const raw of rawItems) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !byId.has(raw.id)) {
      return fail('Item da resposta não pertence a esta autorização.')
    }
    if (seen.has(raw.id)) return fail('Item da resposta repetido.')
    seen.add(raw.id)
    // O RPC sobrescreve com null o que for omitido: exige as duas chaves
    // (o valor pode ser null explícito).
    if (!('quantity_authorized' in raw) || !('authorized_value_cents' in raw)) {
      return fail('Informe quantidade e valor autorizados de cada item (null se não houver).')
    }
    const q = raw.quantity_authorized
    if (q !== null && (!Number.isInteger(q) || (q as number) < 0 || (q as number) > 999)) {
      return fail('Quantidade autorizada entre 0 e 999.')
    }
    const value = optionalCents(raw.authorized_value_cents, 'Valor autorizado')
    if (!value.ok) return fail(value.error)
    if (value.value !== null && byId.get(raw.id)?.kind !== 'opme') return fail('Valor autorizado só existe para itens de OPME.')
    outItems.push({ id: raw.id, quantity_authorized: q as number | null, authorized_value_cents: value.value })
  }

  return ok({
    expected_updated_at: at.value,
    status_code: body.status_code,
    operator_guide_number: number.value,
    password: password.value,
    authorization_date: authorizationDate.value,
    password_valid_until: validUntil.value,
    items: outItems,
  })
}
