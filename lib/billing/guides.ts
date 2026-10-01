import * as Sentry from '@sentry/nextjs'
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { trackBillingGuideCreated } from '@/lib/analytics/posthog-server'
import { BILLING_TZ, BRAZIL_UFS } from './constants'
import type { GuidePayload, GuideStatus, GuideType, MissingField } from './types'
import type { Database } from '@/types/database'

type BillingClient = SupabaseClient<Database>
type AppointmentRow = Database['public']['Tables']['appointments']['Row']
type InsurerRow = Database['public']['Tables']['health_insurers']['Row']
type ProcedureRow = Database['public']['Tables']['insurer_procedures']['Row']

// Dados de origem de uma guia, já carregados. Separado de buildGuidePayload
// para o snapshot ser uma função pura (testável sem banco).
export interface GuideSources {
  appointment: Pick<AppointmentRow, 'scheduled_at' | 'type' | 'patient_name' | 'authorization_number' | 'authorization_date'>
  insurer: Pick<InsurerRow, 'ans_registry' | 'provider_code' | 'tiss_version' | 'default_consult_guide'>
  procedure: Pick<ProcedureRow, 'tuss_code' | 'description' | 'price_cents' | 'guide_type'> | null
  patientInsurance: { card_number: string; valid_until: string | null } | null
  patientName: string | null
  workspace: { cnes: string | null; cnpj: string | null; legal_name: string | null }
  professional: { full_name: string; crm: string | null; crm_uf: string | null; cbo_code: string | null } | null
  cid10: string | null
}

export function saoPauloDate(iso: string): string {
  return format(new TZDate(iso, BILLING_TZ), 'yyyy-MM-dd')
}

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)

export function buildGuidePayload(src: GuideSources): GuidePayload {
  const guideType: GuideType = src.procedure?.guide_type ?? src.insurer.default_consult_guide
  return {
    insurer: {
      ans_registry: src.insurer.ans_registry,
      provider_code: src.insurer.provider_code,
      tiss_version: src.insurer.tiss_version,
    },
    provider: {
      cnes: blank(src.workspace.cnes),
      cnpj: blank(src.workspace.cnpj),
      legal_name: blank(src.workspace.legal_name),
    },
    professional: {
      name: src.professional?.full_name ?? '',
      crm: blank(src.professional?.crm),
      crm_uf: blank(src.professional?.crm_uf),
      cbo_code: blank(src.professional?.cbo_code),
    },
    beneficiary: {
      card_number: blank(src.patientInsurance?.card_number),
      name: src.patientName ?? src.appointment.patient_name,
      valid_until: src.patientInsurance?.valid_until ?? null,
    },
    service: {
      date: saoPauloDate(src.appointment.scheduled_at),
      guide_type: guideType,
      is_return: src.appointment.type === 'retorno',
      tuss_code: blank(src.procedure?.tuss_code),
      description: blank(src.procedure?.description),
      price_cents: src.procedure?.price_cents ?? 0,
      authorization_number: blank(src.appointment.authorization_number),
      authorization_date: src.appointment.authorization_date ?? null,
      cid10: blank(src.cid10),
    },
  }
}

// Campos que o XSD da guia exige e que o MedScale pode não ter. O CID não
// entra: nem a guia de consulta nem a SP/SADT do 4.03.00 têm campo de CID —
// ele fica só no snapshot. Nomes/tamanhos exatos são conferidos de novo pelo
// XSD na geração do lote.
export function computeMissingFields(payload: GuidePayload): MissingField[] {
  const missing: MissingField[] = []
  const { beneficiary, provider, professional, service } = payload
  const sadt = service.guide_type === 'sp_sadt'

  if (!beneficiary.card_number) missing.push('beneficiary.card_number')
  if (!provider.cnes || !/^\d{7}$/.test(provider.cnes)) missing.push('provider.cnes')
  if (sadt && !provider.legal_name) missing.push('provider.legal_name')
  if (!professional.crm || !/\d/.test(professional.crm)) missing.push('professional.crm')
  if (!professional.crm_uf || !(BRAZIL_UFS as readonly string[]).includes(professional.crm_uf)) {
    missing.push('professional.crm_uf')
  }
  if (!professional.cbo_code || !/^\d{6}$/.test(professional.cbo_code)) missing.push('professional.cbo_code')
  if (!service.tuss_code) missing.push('service.tuss_code')
  if (sadt && !service.description) missing.push('service.description')
  if (sadt && service.authorization_number && !service.authorization_date) {
    missing.push('service.authorization_date')
  }
  return missing
}

export function statusForMissing(missing: MissingField[]): Extract<GuideStatus, 'draft' | 'ready'> {
  return missing.length === 0 ? 'ready' : 'draft'
}

// Edição manual da guia em /faturamento — só os campos que dependem do
// atendimento. Dados da clínica e do médico vêm das configurações.
export interface GuideEdits {
  card_number?: string | null
  authorization_number?: string | null
  authorization_date?: string | null
  cid10?: string | null
  procedure?: Pick<ProcedureRow, 'tuss_code' | 'description' | 'price_cents' | 'guide_type'> | null
}

export function applyGuideEdits(payload: GuidePayload, edits: GuideEdits): GuidePayload {
  const next: GuidePayload = {
    ...payload,
    beneficiary: { ...payload.beneficiary },
    service: { ...payload.service },
  }
  if (edits.card_number !== undefined) next.beneficiary.card_number = blank(edits.card_number)
  if (edits.authorization_number !== undefined) next.service.authorization_number = blank(edits.authorization_number)
  if (edits.authorization_date !== undefined) next.service.authorization_date = edits.authorization_date || null
  if (edits.cid10 !== undefined) next.service.cid10 = blank(edits.cid10)
  if (edits.procedure) {
    next.service.tuss_code = edits.procedure.tuss_code
    next.service.description = edits.procedure.description
    next.service.price_cents = edits.procedure.price_cents
    next.service.guide_type = edits.procedure.guide_type
  }
  return next
}

// "Recarregar dados": snapshot novo das configurações (CNES, CRM, CBO...),
// preservando o que foi digitado na própria guia.
export function mergeRefreshedPayload(current: GuidePayload, fresh: GuidePayload): GuidePayload {
  return {
    ...fresh,
    beneficiary: {
      ...fresh.beneficiary,
      card_number: current.beneficiary.card_number ?? fresh.beneficiary.card_number,
    },
    service: {
      ...fresh.service,
      tuss_code: current.service.tuss_code ?? fresh.service.tuss_code,
      description: current.service.tuss_code ? current.service.description : fresh.service.description,
      price_cents: current.service.tuss_code ? current.service.price_cents : fresh.service.price_cents,
      guide_type: current.service.tuss_code ? current.service.guide_type : fresh.service.guide_type,
      authorization_number: current.service.authorization_number ?? fresh.service.authorization_number,
      authorization_date: current.service.authorization_date ?? fresh.service.authorization_date,
      cid10: current.service.cid10 ?? fresh.service.cid10,
    },
  }
}

export async function isBillingEnabled(supabase: BillingClient, accountId: string): Promise<boolean> {
  const { data } = await supabase.from('accounts').select('modules').eq('id', accountId).maybeSingle()
  return Boolean(data?.modules?.includes('billing'))
}

type LoadedAppointment = Pick<
  AppointmentRow,
  | 'id'
  | 'account_id'
  | 'workspace_id'
  | 'doctor_id'
  | 'patient_id'
  | 'patient_name'
  | 'scheduled_at'
  | 'status'
  | 'type'
  | 'billing_type'
  | 'insurer_id'
  | 'patient_insurance_id'
  | 'insurer_procedure_id'
  | 'authorization_number'
  | 'authorization_date'
>

// Carrega os dados do snapshot para o cron ou para atualização manual.
// O cron usa seu client de serviço; na atualização autenticada, CRM/CBO
// de outro médico vêm do RPC autorizado. Leituras presas à account.
export async function loadGuideSources(
  supabase: BillingClient,
  appointment: LoadedAppointment,
  options: { authenticated?: boolean } = {},
): Promise<{ sources: GuideSources; insurerId: string } | null> {
  const accountId = appointment.account_id

  const [{ data: procedure }, { data: patientInsurance }] = await Promise.all([
    appointment.insurer_procedure_id
      ? supabase
          .from('insurer_procedures')
          .select('insurer_id, tuss_code, description, price_cents, guide_type')
          .eq('id', appointment.insurer_procedure_id)
          .eq('account_id', accountId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    appointment.patient_insurance_id
      ? supabase
          .from('patient_insurances')
          .select('insurer_id, card_number, valid_until')
          .eq('id', appointment.patient_insurance_id)
          .eq('account_id', accountId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const insurerId = appointment.insurer_id ?? patientInsurance?.insurer_id ?? procedure?.insurer_id ?? null
  if (!insurerId) return null

  const [{ data: insurer }, { data: workspace }, { data: professional }, { data: patient }, { data: transcription }] =
    await Promise.all([
      supabase
        .from('health_insurers')
        .select('ans_registry, provider_code, tiss_version, default_consult_guide')
        .eq('id', insurerId)
        .eq('account_id', accountId)
        .maybeSingle(),
      supabase
        .from('workspaces')
        .select('cnes, cnpj, legal_name')
        .eq('id', appointment.workspace_id)
        .eq('account_id', accountId)
        .maybeSingle(),
    appointment.doctor_id
      ? options.authenticated
        ? supabase.rpc('tiss_professional_for_appointment', { p_appointment_id: appointment.id })
          .then(({ data, error }) => {
            if (error) throw new Error('billing: não foi possível carregar o profissional')
            return { data: data as GuideSources['professional'] }
          })
        : supabase.from('profiles').select('full_name, crm, crm_uf, cbo_code').eq('id', appointment.doctor_id).maybeSingle()
        : Promise.resolve({ data: null }),
      appointment.patient_id
        ? supabase
            .from('patients')
            .select('full_name')
            .eq('id', appointment.patient_id)
            .eq('account_id', accountId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('transcriptions')
        .select('medical_record_final')
        .eq('appointment_id', appointment.id)
        .eq('account_id', accountId)
        .eq('status', 'signed')
        .order('signed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

  if (!insurer || !workspace) return null

  // Procedimento/carteirinha de outra operadora (edição inconsistente) não
  // entram na guia — ela fica em rascunho pedindo o dado certo.
  const sameInsurer = <T extends { insurer_id: string } | null>(row: T) =>
    row && row.insurer_id === insurerId ? row : null

  const record = transcription?.medical_record_final as { soap?: { A?: { cid10?: unknown } } } | null
  const cid10 = typeof record?.soap?.A?.cid10 === 'string' ? record.soap.A.cid10 : null

  return {
    insurerId,
    sources: {
      appointment,
      insurer: insurer as GuideSources['insurer'],
      procedure: sameInsurer(procedure) as GuideSources['procedure'],
      patientInsurance: sameInsurer(patientInsurance),
      patientName: patient?.full_name ?? null,
      workspace,
      professional,
      cid10,
    },
  }
}

const APPOINTMENT_COLUMNS =
  'id, account_id, workspace_id, doctor_id, patient_id, patient_name, scheduled_at, status, type, billing_type, ' +
  'insurer_id, patient_insurance_id, insurer_procedure_id, authorization_number, authorization_date'

export async function loadAppointmentForGuide(supabase: BillingClient, appointmentId: string) {
  const { data } = await supabase.from('appointments').select(APPOINTMENT_COLUMNS).eq('id', appointmentId).maybeSingle()
  return (data as unknown as LoadedAppointment | null) ?? null
}

export type EnsureGuideResult =
  | { status: 'created'; guideId: string; guideStatus: GuideStatus }
  | { status: 'exists'; guideId: string }
  | { status: 'skipped'; reason: 'not_found' | 'not_convenio' | 'not_realizado' | 'module_off' | 'no_insurer' }

// Idempotente: consulta de convênio 'realizado' sem guia → cria a guia 'draft'
// (ou 'ready' se não faltar nada). Chamado na assinatura da transcrição, na
// mudança de status da agenda e na varredura do cron. UNIQUE(appointment_id)
// segura a corrida entre dois chamadores simultâneos.
export async function ensureGuideForAppointment(
  appointmentId: string,
  supabase?: BillingClient,
): Promise<EnsureGuideResult> {
  if (!supabase) {
    // A recepção pode concluir consultas sem ler guias ou prontuários.
    // O RPC verifica o workspace e cria o snapshot dentro do banco; retorna
    // somente IDs, status e os metadados permitidos para analytics.
    const client = await createClient()
    const { data, error } = await client.rpc('ensure_tiss_guide_for_appointment', {
      p_appointment_id: appointmentId,
    })
    if (error || !data) throw new Error('billing: não foi possível gerar a guia')
    const result = data as unknown as EnsureGuideResult & {
      accountId?: string; guideType?: GuideType; hasMissingFields?: boolean
    }
    if (result.status === 'created') {
      if (result.accountId && result.guideType) {
        await trackBillingGuideCreated(result.accountId, {
          guide_type: result.guideType,
          has_missing_fields: result.hasMissingFields === true,
        })
      }
      return { status: 'created', guideId: result.guideId, guideStatus: result.guideStatus }
    }
    if (result.status === 'exists') return { status: 'exists', guideId: result.guideId }
    return { status: 'skipped', reason: result.reason }
  }
  const appointment = await loadAppointmentForGuide(supabase, appointmentId)
  if (!appointment) return { status: 'skipped', reason: 'not_found' }
  if (appointment.billing_type !== 'convenio') return { status: 'skipped', reason: 'not_convenio' }
  if (appointment.status !== 'realizado') return { status: 'skipped', reason: 'not_realizado' }

  const { data: existing } = await supabase
    .from('tiss_guides')
    .select('id')
    .eq('appointment_id', appointmentId)
    .maybeSingle()
  if (existing) return { status: 'exists', guideId: existing.id }

  if (!(await isBillingEnabled(supabase, appointment.account_id))) return { status: 'skipped', reason: 'module_off' }

  const loaded = await loadGuideSources(supabase, appointment)
  if (!loaded) return { status: 'skipped', reason: 'no_insurer' }

  const payload = buildGuidePayload(loaded.sources)
  const missing = computeMissingFields(payload)
  const guideStatus = statusForMissing(missing)

  const { data: number, error: numberError } = await supabase.rpc('next_tiss_number', {
    p_insurer_id: loaded.insurerId,
    p_kind: 'guide',
  })
  if (numberError || number == null) throw new Error(`next_tiss_number: ${numberError?.message ?? 'sem retorno'}`)

  const { data: guide, error } = await supabase
    .from('tiss_guides')
    .insert({
      account_id: appointment.account_id,
      workspace_id: appointment.workspace_id,
      appointment_id: appointment.id,
      insurer_id: loaded.insurerId,
      guide_type: payload.service.guide_type,
      provider_guide_number: String(number),
      status: guideStatus,
      payload,
      missing_fields: missing,
      total_cents: payload.service.price_cents,
      service_date: payload.service.date,
    })
    .select('id')
    .single()

  if (error || !guide) {
    // Outro chamador criou a guia entre o SELECT e o INSERT — o número
    // reservado fica sem uso (lacuna na sequência, aceito pelo TISS).
    if (error?.code === '23505') {
      const { data: raced } = await supabase.from('tiss_guides').select('id').eq('appointment_id', appointmentId).maybeSingle()
      if (raced) return { status: 'exists', guideId: raced.id }
    }
    throw new Error(`tiss_guides insert: ${error?.message ?? 'sem retorno'}`)
  }

  await trackBillingGuideCreated(appointment.account_id, {
    guide_type: payload.service.guide_type,
    has_missing_fields: missing.length > 0,
  })

  return { status: 'created', guideId: guide.id, guideStatus }
}

// Para as rotas da agenda/transcrição: falhar em gerar a guia nunca desfaz a
// assinatura nem a mudança de status. Sentry só com IDs — nada de payload.
export async function ensureGuideSafely(appointmentId: string, supabase?: BillingClient): Promise<void> {
  try {
    await ensureGuideForAppointment(appointmentId, supabase)
  } catch (err) {
    Sentry.captureException(new Error('billing: falha ao gerar guia TISS'), {
      tags: { area: 'billing', flow: 'ensure_guide' },
      extra: { appointmentId, cause: err instanceof Error ? err.name : 'unknown' },
    })
    console.error('[billing] falha ao gerar guia', { appointmentId })
  }
}
