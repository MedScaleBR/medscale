import type { SupabaseClient } from '@supabase/supabase-js'
import { isDate } from './validation'
import type { Database, BillingType } from '@/types/database'

type Client = SupabaseClient<Database>

export interface AppointmentBillingFields {
  billing_type: BillingType
  insurer_id: string | null
  patient_insurance_id: string | null
  insurer_procedure_id: string | null
  authorization_number: string | null
  authorization_date: string | null
  // Nome da operadora — mantém a consulta de convênio fora do ciclo de receita
  // e nas contagens por plano, como o health_plan em texto livre já fazia.
  health_plan: string | null
}

type Resolved = { ok: true; fields: AppointmentBillingFields | null } | { ok: false; error: string }

const optionalId = (v: unknown) => (typeof v === 'string' && v ? v : null)

// Lê os campos de faturamento do corpo de POST/PATCH /api/appointments.
// fields === null → o corpo não mexeu no faturamento (body.billing_type
// ausente, ou módulo "billing" inativo — a consulta segue como hoje). Os IDs
// são conferidos com o client do usuário: a RLS já limita à account, e aqui
// garantimos que carteirinha/procedimento são da operadora escolhida.
export async function resolveAppointmentBilling(
  supabase: Client,
  params: { accountId: string; patientId: string | null; body: Record<string, unknown> },
): Promise<Resolved> {
  const { accountId, patientId, body } = params
  if (body.billing_type !== 'particular' && body.billing_type !== 'convenio') return { ok: true, fields: null }

  const { data: account } = await supabase.from('accounts').select('modules').eq('id', accountId).maybeSingle()
  if (!account?.modules?.includes('billing')) return { ok: true, fields: null }

  if (body.billing_type === 'particular') {
    return {
      ok: true,
      fields: {
        billing_type: 'particular',
        insurer_id: null,
        patient_insurance_id: null,
        insurer_procedure_id: null,
        authorization_number: null,
        authorization_date: null,
        health_plan: null,
      },
    }
  }

  const insurerId = optionalId(body.insurer_id)
  if (!insurerId) return { ok: false, error: 'Selecione o convênio da consulta.' }
  const { data: insurer } = await supabase
    .from('health_insurers')
    .select('id, name')
    .eq('id', insurerId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!insurer) return { ok: false, error: 'Convênio inválido para esta conta.' }

  const patientInsuranceId = optionalId(body.patient_insurance_id)
  if (patientInsuranceId) {
    let q = supabase
      .from('patient_insurances')
      .select('id')
      .eq('id', patientInsuranceId)
      .eq('insurer_id', insurerId)
      .eq('account_id', accountId)
    if (patientId) q = q.eq('patient_id', patientId)
    const { data } = await q.maybeSingle()
    if (!data) return { ok: false, error: 'Carteirinha não pertence a este paciente/convênio.' }
  }

  const procedureId = optionalId(body.insurer_procedure_id)
  if (procedureId) {
    const { data } = await supabase
      .from('insurer_procedures')
      .select('id')
      .eq('id', procedureId)
      .eq('insurer_id', insurerId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!data) return { ok: false, error: 'Procedimento não é deste convênio.' }
  }

  const authNumber = typeof body.authorization_number === 'string' ? body.authorization_number.trim() : ''
  if (authNumber.length > 20) return { ok: false, error: 'Número da autorização tem no máximo 20 caracteres.' }
  if (body.authorization_date && !isDate(body.authorization_date)) {
    return { ok: false, error: 'Data da autorização inválida.' }
  }

  return {
    ok: true,
    fields: {
      billing_type: 'convenio',
      insurer_id: insurerId,
      patient_insurance_id: patientInsuranceId,
      insurer_procedure_id: procedureId,
      authorization_number: authNumber || null,
      authorization_date: (body.authorization_date as string) || null,
      health_plan: insurer.name,
    },
  }
}
