import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Database,
  AppointmentStatus,
  RevenuePaymentMethod,
  RevenuePaymentStatus,
  RevenueSource,
  RevenueStatus,
} from '@/types/database'

// Rótulos das formas de pagamento — compartilhados entre a tela, o agente
// financeiro e o resumo diário.
export const PAYMENT_METHOD_LABELS: Record<RevenuePaymentMethod, string> = {
  pix: 'Pix',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
  dinheiro: 'Dinheiro',
  transferencia: 'Transferência',
  outro: 'Outro',
}

// Rótulo + cor de cada payment_status — o campo canônico do ciclo. Usado no
// ledger (/receita) e na fila do dia (/ciclo-receita).
export const PAYMENT_STATUS_LABELS: Record<RevenuePaymentStatus, { label: string; style: string }> = {
  pending: { label: 'Prevista', style: 'bg-[var(--navy-06)] text-[var(--navy)]' },
  realized: { label: 'Aguardando pagamento', style: 'bg-amber-100 text-amber-700' },
  paid: { label: 'Paga', style: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Cancelada', style: 'bg-red-100 text-red-600' },
  refunded: { label: 'Reembolsada', style: 'bg-red-100 text-red-600' },
}

// Lançamento manual avulso no ledger ainda usa os 3 estados simples
// (previsto/confirmado/cancelado); traduz para o payment_status canônico.
export function revenueStatusToPaymentStatus(status: RevenueStatus): RevenuePaymentStatus {
  switch (status) {
    case 'confirmado':
      return 'paid'
    case 'cancelado':
      return 'cancelled'
    default:
      return 'pending'
  }
}

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

// Limites [início, fim) de um dia (YYYY-MM-DD) no fuso de São Paulo, como
// instantes ISO — para filtrar colunas timestamptz (ex. appointments.scheduled_at)
// por dia local. BRT é -03:00 fixo desde 2019 (sem horário de verão).
export function saoPauloDayRange(dateOnly: string): { startIso: string; endIso: string } {
  const start = new Date(`${dateOnly}T00:00:00-03:00`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

// Idem para um mês (YYYY-MM).
export function saoPauloMonthRange(month: string): { startIso: string; endIso: string } {
  const [y, m] = month.split('-').map(Number)
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return {
    startIso: new Date(`${month}-01T00:00:00-03:00`).toISOString(),
    endIso: new Date(`${nextMonth}-01T00:00:00-03:00`).toISOString(),
  }
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

interface AppointmentRevenueInput {
  /** Dados para criar a entrada PREVISTA, caso ainda não exista. */
  booking: BookingRevenueInput
  /** Status da consulta antes desta gravação (null = consulta recém-criada). */
  previousStatus: AppointmentStatus | null
  /** Status da consulta depois desta gravação. */
  nextStatus: AppointmentStatus
  /**
   * Convênio da consulta (bot_config.insurance_plans) ou null/'' = particular.
   * Consulta por convênio não entra no ciclo de receita: nenhuma entrada é
   * criada e uma previsão pendente pré-existente (de quando era particular) é
   * cancelada.
   */
  healthPlan?: string | null
}

// Aplica, na ordem certa, os dois efeitos do ciclo de receita quando uma
// consulta é criada ou editada:
//   1. cria a entrada PREVISTA ('pending') se ainda não houver e houver preço;
//   2. promove ('realized') ou cancela ('cancelled') a entrada conforme o
//      novo status da consulta.
//
// A ordem importa: syncRevenueEntryToAppointmentStatus só age em linhas
// 'pending', então a criação precisa vir antes — senão uma gravação que mexe em
// preço e status juntos (ou uma consulta já criada como 'realizado') deixaria a
// entrada recém-nascida travada em 'previsto/pending', fora dos totais.
export async function applyAppointmentRevenue(
  supabase: SupabaseAdmin,
  { booking, previousStatus, nextStatus, healthPlan }: AppointmentRevenueInput
): Promise<void> {
  // Consulta por convênio fica fora do ciclo de receita. Se virou convênio numa
  // edição, cancela a previsão pendente que existia de quando era particular
  // (nunca toca uma entrada já 'paid'/'realized').
  if (healthPlan) {
    const { error } = await supabase
      .from('revenue_entries')
      .update({ payment_status: 'cancelled' })
      .eq('appointment_id', booking.appointmentId)
      .eq('payment_status', 'pending')
    if (error) {
      console.error('[revenue-cycle] falha ao cancelar previsão de consulta que virou convênio', {
        appointmentId: booking.appointmentId,
        error: error.message,
      })
    }
    return
  }

  if (nextStatus !== 'cancelado' && booking.amount != null && booking.amount > 0) {
    await createBookingRevenueEntry(supabase, booking)
  }
  if (previousStatus !== nextStatus) {
    await syncRevenueEntryToAppointmentStatus(supabase, booking.appointmentId, nextStatus)
  }
}
