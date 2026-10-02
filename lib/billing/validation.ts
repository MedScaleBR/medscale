import { BRAZIL_UFS, SUPPORTED_TISS_VERSIONS } from './constants'
import type { GuideType } from './types'

// Validação dos corpos das rotas /api/billing/*. Retorna o objeto limpo pronto
// para o Supabase, ou a mensagem de erro para um 400. `partial` = PATCH (só
// valida o que veio).

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const isGuideType = (v: unknown): v is GuideType => v === 'consulta' || v === 'sp_sadt'

export interface InsurerInput {
  name?: string
  ans_registry?: string
  provider_code?: string
  tiss_version?: string
  default_consult_guide?: GuideType
  batch_weekdays?: number[]
  batch_hour?: number
  max_guides_per_batch?: number
  is_active?: boolean
}

// Campos de um convênio sem o módulo billing — é só o nome que a Clara informa.
const BASIC_INSURER_FIELDS = ['name', 'is_active']

export function parseInsurerInput(
  body: Record<string, unknown>,
  partial: boolean,
  { tiss }: { tiss: boolean },
): Result<InsurerInput> {
  if (!tiss) body = Object.fromEntries(Object.entries(body).filter(([k]) => BASIC_INSURER_FIELDS.includes(k)))
  const out: InsurerInput = {}
  const has = (k: string) => (!partial && (tiss || BASIC_INSURER_FIELDS.includes(k))) || k in body

  if (has('name')) {
    const name = str(body.name)
    if (!name) return { ok: false, error: 'Nome da operadora é obrigatório.' }
    out.name = name.slice(0, 120)
  }
  if (has('ans_registry')) {
    const ans = str(body.ans_registry)
    if (!/^\d{6}$/.test(ans)) return { ok: false, error: 'Registro ANS deve ter exatamente 6 dígitos.' }
    out.ans_registry = ans
  }
  if (has('provider_code')) {
    const code = str(body.provider_code)
    // codigoPrestadorNaOperadora é st_texto14 no XSD.
    if (!code || code.length > 14) {
      return { ok: false, error: 'Código do prestador na operadora é obrigatório (até 14 caracteres).' }
    }
    out.provider_code = code
  }
  if ('tiss_version' in body) {
    if (!(SUPPORTED_TISS_VERSIONS as readonly unknown[]).includes(body.tiss_version)) {
      return { ok: false, error: `Versão TISS não suportada. Use: ${SUPPORTED_TISS_VERSIONS.join(', ')}.` }
    }
    out.tiss_version = body.tiss_version as string
  }
  if ('default_consult_guide' in body) {
    if (!isGuideType(body.default_consult_guide)) return { ok: false, error: 'Tipo de guia inválido.' }
    out.default_consult_guide = body.default_consult_guide
  }
  if ('batch_weekdays' in body) {
    const days = body.batch_weekdays
    if (!Array.isArray(days) || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      return { ok: false, error: 'Dias do lote inválidos (0 = domingo … 6 = sábado).' }
    }
    out.batch_weekdays = [...new Set(days as number[])].sort()
  }
  if ('batch_hour' in body) {
    const h = body.batch_hour
    if (!Number.isInteger(h) || (h as number) < 0 || (h as number) > 23) {
      return { ok: false, error: 'Hora do lote deve ser entre 0 e 23.' }
    }
    out.batch_hour = h as number
  }
  if ('max_guides_per_batch' in body) {
    const m = body.max_guides_per_batch
    if (!Number.isInteger(m) || (m as number) < 1 || (m as number) > 100) {
      return { ok: false, error: 'Máximo de guias por lote deve ser entre 1 e 100 (limite do XSD da ANS).' }
    }
    out.max_guides_per_batch = m as number
  }
  if ('is_active' in body) out.is_active = Boolean(body.is_active)
  return { ok: true, value: out }
}

export interface ProcedureInput {
  tuss_code?: string
  description?: string
  price_cents?: number
  guide_type?: GuideType
  is_active?: boolean
}

export function parseProcedureInput(body: Record<string, unknown>, partial: boolean): Result<ProcedureInput> {
  const out: ProcedureInput = {}
  const has = (k: string) => !partial || k in body

  if (has('tuss_code')) {
    const code = str(body.tuss_code)
    // codigoProcedimento é st_texto10.
    if (!/^[0-9A-Za-z.-]{1,10}$/.test(code)) {
      return { ok: false, error: 'Código TUSS inválido (até 10 caracteres, sem espaços).' }
    }
    out.tuss_code = code
  }
  if (has('description')) {
    const d = str(body.description)
    if (!d) return { ok: false, error: 'Descrição é obrigatória.' }
    out.description = d.slice(0, 150)
  }
  if (has('price_cents')) {
    const p = body.price_cents
    if (!Number.isInteger(p) || (p as number) < 0) return { ok: false, error: 'Valor inválido.' }
    out.price_cents = p as number
  }
  if (has('guide_type')) {
    if (!isGuideType(body.guide_type)) return { ok: false, error: 'Tipo de guia inválido.' }
    out.guide_type = body.guide_type
  }
  if ('is_active' in body) out.is_active = Boolean(body.is_active)
  return { ok: true, value: out }
}

export interface PatientInsuranceInput {
  insurer_id?: string
  card_number?: string
  plan_name?: string | null
  valid_until?: string | null
  is_primary?: boolean
}

const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export function parsePatientInsuranceInput(
  body: Record<string, unknown>,
  partial: boolean,
): Result<PatientInsuranceInput> {
  const out: PatientInsuranceInput = {}
  const has = (k: string) => !partial || k in body

  if (has('insurer_id')) {
    if (!str(body.insurer_id)) return { ok: false, error: 'Selecione a operadora.' }
    out.insurer_id = str(body.insurer_id)
  }
  if (has('card_number')) {
    const card = str(body.card_number)
    // numeroCarteira é st_texto20.
    if (!card || card.length > 20) return { ok: false, error: 'Número da carteirinha é obrigatório (até 20 caracteres).' }
    out.card_number = card
  }
  if ('plan_name' in body) out.plan_name = str(body.plan_name).slice(0, 120) || null
  if ('valid_until' in body) {
    if (body.valid_until && !isDate(body.valid_until)) return { ok: false, error: 'Validade inválida.' }
    out.valid_until = (body.valid_until as string) || null
  }
  if ('is_primary' in body) out.is_primary = Boolean(body.is_primary)
  return { ok: true, value: out }
}

// Dados do prestador na workspace e do profissional no profile. Máscara de
// CNPJ/CNES é aceita e removida.
export function parseProviderFields(body: Record<string, unknown>): Result<{
  cnes?: string | null
  cnpj?: string | null
  legal_name?: string | null
}> {
  const out: { cnes?: string | null; cnpj?: string | null; legal_name?: string | null } = {}
  if ('cnes' in body) {
    const cnes = str(body.cnes).replace(/\D/g, '')
    if (cnes && cnes.length !== 7) return { ok: false, error: 'CNES deve ter 7 dígitos.' }
    out.cnes = cnes || null
  }
  if ('cnpj' in body) {
    const cnpj = str(body.cnpj).replace(/\D/g, '')
    if (cnpj && cnpj.length !== 14) return { ok: false, error: 'CNPJ deve ter 14 dígitos.' }
    out.cnpj = cnpj || null
  }
  if ('legal_name' in body) out.legal_name = str(body.legal_name).slice(0, 150) || null
  return { ok: true, value: out }
}

export function parseProfessionalFields(body: Record<string, unknown>): Result<{
  crm_uf?: string | null
  cbo_code?: string | null
}> {
  const out: { crm_uf?: string | null; cbo_code?: string | null } = {}
  if ('crm_uf' in body) {
    const uf = str(body.crm_uf).toUpperCase()
    if (uf && !(BRAZIL_UFS as readonly string[]).includes(uf)) return { ok: false, error: 'UF do CRM inválida.' }
    out.crm_uf = uf || null
  }
  if ('cbo_code' in body) {
    const cbo = str(body.cbo_code).replace(/\D/g, '')
    if (cbo && cbo.length !== 6) return { ok: false, error: 'CBO deve ter 6 dígitos (ex.: 225125).' }
    out.cbo_code = cbo || null
  }
  return { ok: true, value: out }
}

export { isDate }
