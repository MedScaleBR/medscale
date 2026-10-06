import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { ApiSession } from '@/lib/session/api'
import { INCOMPLETE_INSURER_ERROR, hasTissIdentity } from '../insurer'
import { buildInitialPayload } from './edit'
import type { AuthorizationSources, ProfessionalOption } from './payload'
import type { AnyAuthorizationPayload, AuthorizationItemInput } from './types'
import type { CreateInput } from './validation'

type BillingClient = SupabaseClient<Database>
export type Failure = { ok: false; status: 400 | 404; error: string }

// Profissionais com CRM da account (RPC security definer, só owner/admin:
// profiles é privado por RLS). Só id, nome, CRM, UF, CBO (R3). Lança em erro
// — a rota responde 500 genérico.
export async function loadProfessionals(supabase: BillingClient, workspaceId: string): Promise<ProfessionalOption[]> {
  const { data, error } = await supabase.rpc('tiss_authorization_professionals', { p_workspace_id: workspaceId })
  if (error) throw new Error('billing: não foi possível carregar os profissionais')
  return data ?? []
}

// Fontes do snapshot, todas lidas com o client do usuário (RLS) e presas à account.
export async function loadAuthorizationSources(
  supabase: BillingClient,
  args: {
    accountId: string
    workspaceId: string
    insurerId: string
    patientId: string
    patientInsuranceId: string | null
    professionalId: string | null
  },
): Promise<{ ok: true; sources: AuthorizationSources; professionals: ProfessionalOption[] } | Failure> {
  const [{ data: insurer }, { data: workspace }, { data: cards }, professionals] = await Promise.all([
    supabase
      .from('health_insurers')
      .select('ans_registry, provider_code, tiss_version')
      .eq('id', args.insurerId)
      .eq('account_id', args.accountId)
      .maybeSingle(),
    supabase
      .from('workspaces')
      .select('cnes, cnpj, legal_name')
      .eq('id', args.workspaceId)
      .eq('account_id', args.accountId)
      .maybeSingle(),
    supabase
      .from('patient_insurances')
      .select('id, card_number, is_primary')
      .eq('patient_id', args.patientId)
      .eq('insurer_id', args.insurerId)
      .eq('account_id', args.accountId)
      .order('is_primary', { ascending: false }),
    loadProfessionals(supabase, args.workspaceId),
  ])

  if (!insurer || !hasTissIdentity(insurer)) return { ok: false, status: 400, error: INCOMPLETE_INSURER_ERROR }
  if (!workspace) return { ok: false, status: 404, error: 'Unidade não encontrada' }

  const list = cards ?? []
  const card = (args.patientInsuranceId ? list.find((c) => c.id === args.patientInsuranceId) : list[0]) ?? null
  const professional = args.professionalId ? professionals.find((p) => p.id === args.professionalId) ?? null : null

  return {
    ok: true,
    professionals,
    sources: {
      insurer: { ans_registry: insurer.ans_registry, provider_code: insurer.provider_code, tiss_version: insurer.tiss_version },
      workspace,
      professional,
      patientInsurance: card ? { id: card.id, card_number: card.card_number } : null,
    },
  }
}

export interface CreateContext {
  workspaceId: string
  patientId: string
  insurerId: string
  appointmentId: string | null
  parentId: string | null
  payload: AnyAuthorizationPayload
  items: AuthorizationItemInput[]
}

// Resolve unidade/paciente/operadora/profissional a partir do pai (OPME), do
// agendamento ou do corpo, nesta ordem, e monta o snapshot inicial.
export async function resolveCreateContext(
  supabase: BillingClient,
  session: ApiSession,
  input: CreateInput,
): Promise<{ ok: true; context: CreateContext } | Failure> {
  let workspaceId = session.workspaceId
  let patientId = input.patient_id
  let insurerId = input.insurer_id
  let appointmentId = input.appointment_id
  let patientInsuranceId = input.patient_insurance_id
  let professionalId = input.professional_id
  let items: AuthorizationItemInput[] = []

  if (input.parent_id) {
    const { data } = await supabase
      .from('tiss_authorizations')
      .select('id, workspace_id, patient_id, insurer_id, appointment_id, type, status, payload')
      .eq('id', input.parent_id)
      .eq('account_id', session.accountId)
      .maybeSingle()
    const parent = data as unknown as {
      workspace_id: string; patient_id: string; insurer_id: string; appointment_id: string | null
      type: string; status: string; payload: AnyAuthorizationPayload
    } | null
    if (!parent || parent.type === 'opme_request') return { ok: false, status: 404, error: 'Guia de origem não encontrada' }
    if (parent.status === 'cancelled') return { ok: false, status: 400, error: 'A guia de origem está cancelada.' }
    workspaceId = parent.workspace_id
    patientId = parent.patient_id
    insurerId = parent.insurer_id
    appointmentId = parent.appointment_id
    patientInsuranceId = patientInsuranceId ?? parent.payload.beneficiary.patient_insurance_id
    professionalId = professionalId ?? parent.payload.professional.id
  } else if (input.appointment_id) {
    const { data: appointment } = await supabase
      .from('appointments')
      .select('id, workspace_id, patient_id, doctor_id, insurer_id, patient_insurance_id, insurer_procedure_id')
      .eq('id', input.appointment_id)
      .eq('account_id', session.accountId)
      .maybeSingle()
    if (!appointment) return { ok: false, status: 404, error: 'Agendamento não encontrado' }
    if (!appointment.patient_id || !appointment.insurer_id) {
      return { ok: false, status: 400, error: 'O agendamento precisa ter paciente cadastrado e convênio.' }
    }
    workspaceId = appointment.workspace_id
    patientId = appointment.patient_id
    insurerId = appointment.insurer_id
    patientInsuranceId = patientInsuranceId ?? appointment.patient_insurance_id
    // doctor_id é quem criou o agendamento (pode ser a recepção): só vira
    // solicitante se aparecer na lista de profissionais com CRM.
    professionalId = professionalId ?? appointment.doctor_id
    if (input.type === 'sp_sadt_request' && appointment.insurer_procedure_id) {
      const { data: procedure } = await supabase
        .from('insurer_procedures')
        .select('tuss_code, description')
        .eq('id', appointment.insurer_procedure_id)
        .eq('insurer_id', appointment.insurer_id)
        .eq('account_id', session.accountId)
        .maybeSingle()
      if (procedure) {
        items = [{
          table_code: '22', code: procedure.tuss_code, description: procedure.description.slice(0, 150),
          quantity_requested: 1, manufacturer_option: null, requested_value_cents: null,
          anvisa_registration: null, manufacturer_reference: null, operating_authorization: null,
        }]
      }
    }
  }

  if (!patientId || !insurerId) return { ok: false, status: 400, error: 'Informe o paciente e a operadora.' }

  const loaded = await loadAuthorizationSources(supabase, {
    accountId: session.accountId, workspaceId, insurerId, patientId, patientInsuranceId, professionalId,
  })
  if (!loaded.ok) return loaded

  return {
    ok: true,
    context: {
      workspaceId, patientId, insurerId, appointmentId, parentId: input.parent_id,
      payload: buildInitialPayload(input.type, loaded.sources),
      items,
    },
  }
}
