import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, AppointmentStatus, RevenueSource } from '@/types/database'

// Ciclo de receita automático — transições de revenue_entries disparadas por
// eventos de agendamento/consulta. Ver prompts/CICLO_RECEITA_COMO_FUNCIONA.md.
//
// Sempre usar com createAdminClient(): revenue_entries tem RLS exclusiva de
// owner, então uma recepcionista assinando prontuário ou o cron de no-show
// (sem sessão de usuário) não conseguiriam atualizar a linha com o client
// normal — o UPDATE simplesmente não pegaria nenhuma linha, em silêncio.

type SupabaseAdmin = SupabaseClient<Database>

// Converte um instante ISO para a data (YYYY-MM-DD) no fuso de São Paulo —
// perto da meia-noite BRT o `.slice(0, 10)` do ISO em UTC cairia no dia errado.
export function saoPauloDateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

// A account tem o módulo "revenue_cycle" ativo?
export async function isRevenueCycleEnabled(supabase: SupabaseAdmin, accountId: string): Promise<boolean> {
  const { data } = await supabase.from('accounts').select('modules').eq('id', accountId).single()
  return data?.modules?.includes('revenue_cycle') ?? false
}

interface BookingRevenueInput {
  workspaceId: string
  accountId: string
  appointmentId: string
  patientId: string | null
  procedureId: string | null
  procedureName: string | null
  /** Preço-snapshot no momento do agendamento. null/≤0 → nenhuma entrada é criada. */
  amount: number | null
  /** Instante da consulta (ISO) — vira due_date e entry_date. */
  scheduledAt: string
  source: RevenueSource
}

// Cria o revenue_entry PREVISTO (payment_status 'pending') ligado a um
// agendamento recém-criado. No-op quando o módulo está inativo, quando não há
// preço conhecido, ou quando já existe uma entrada para aquele appointment
// (idempotente — duas confirmações do bot não geram duas linhas).
export async function createBookingRevenueEntry(
  supabase: SupabaseAdmin,
  input: BookingRevenueInput
): Promise<void> {
  if (!input.amount || input.amount <= 0) {
    console.warn('[revenue-cycle] agendamento sem preço conhecido — revenue_entry não criado', {
      appointmentId: input.appointmentId,
    })
    return
  }

  if (!(await isRevenueCycleEnabled(supabase, input.accountId))) return

  const { data: existing } = await supabase
    .from('revenue_entries')
    .select('id')
    .eq('appointment_id', input.appointmentId)
    .maybeSingle()
  if (existing) return

  const date = saoPauloDateOnly(input.scheduledAt)
  const { error } = await supabase.from('revenue_entries').insert({
    workspace_id: input.workspaceId,
    account_id: input.accountId,
    appointment_id: input.appointmentId,
    patient_id: input.patientId,
    procedure_id: input.procedureId,
    procedure_name: input.procedureName,
    amount: input.amount,
    status: 'previsto',
    payment_status: 'pending',
    source: input.source,
    due_date: date,
    entry_date: date,
  })

  if (error) {
    console.error('[revenue-cycle] falha ao criar revenue_entry do agendamento', {
      appointmentId: input.appointmentId,
      error: error.message,
    })
  }
}

// Move o(s) revenue_entry(s) vinculado(s) a consulta(s) conforme o novo status
// da consulta:
//   realizado            → payment_status 'realized'
//   cancelado / no_show   → payment_status 'cancelled'
// Só afeta entradas ainda em 'pending' — nunca sobrescreve um pagamento já
// confirmado ('paid') nem uma entrada já realizada/reembolsada.
export async function syncRevenueEntryToAppointmentStatus(
  supabase: SupabaseAdmin,
  appointmentIds: string | string[],
  appointmentStatus: AppointmentStatus
): Promise<void> {
  const nextPaymentStatus =
    appointmentStatus === 'realizado'
      ? 'realized'
      : appointmentStatus === 'cancelado' || appointmentStatus === 'no_show'
        ? 'cancelled'
        : null
  if (!nextPaymentStatus) return

  const ids = Array.isArray(appointmentIds) ? appointmentIds : [appointmentIds]
  if (ids.length === 0) return

  const { error } = await supabase
    .from('revenue_entries')
    .update({ payment_status: nextPaymentStatus })
    .in('appointment_id', ids)
    .eq('payment_status', 'pending')

  if (error) {
    console.error('[revenue-cycle] falha ao sincronizar revenue_entry com status da consulta', {
      appointmentCount: ids.length,
      appointmentStatus,
      error: error.message,
    })
  }
}
