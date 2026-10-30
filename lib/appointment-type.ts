import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppointmentStatus, AppointmentType, Database } from '@/types/database'

// Tipo da consulta que a Clara agenda, decidido pelo histórico do paciente —
// a Clara não pergunta "inicial ou retorno". Quando o histórico não permite
// saber, o tipo fica vazio (null) e a equipe define depois.

export const RETURN_WINDOW_DAYS = 30
export const UNDEFINED_TYPE_LABEL = 'Não definido'

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  consulta: 'Consulta',
  retorno: 'Retorno',
  avaliacao: 'Avaliação',
  procedimento: 'Procedimento',
  outro: 'Outro',
}

export function appointmentTypeLabel(type: AppointmentType | null | undefined): string {
  return type ? APPOINTMENT_TYPE_LABELS[type] : UNDEFINED_TYPE_LABEL
}

/** Texto do tipo no título do evento do Google ("consulta — Maria"); vazio vira "não definido". */
export function calendarTypeText(type: AppointmentType | null | undefined): string {
  return type ?? UNDEFINED_TYPE_LABEL.toLowerCase()
}

export interface PastAppointment {
  scheduled_at: string
  status: AppointmentStatus
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Regra, olhando só consultas que já passaram:
 * - realizada até 30 dias antes da nova → 'retorno';
 * - nenhuma realizada e nenhuma em aberto (agendada/confirmada sem desfecho) → 'consulta' (primeira);
 * - qualquer outro caso (realizada há mais de 30 dias, ou passada sem desfecho) → null.
 * Canceladas, faltas e pedidos à clínica parceira não contam como atendimento.
 */
export function classifyAppointmentType(past: PastAppointment[], scheduledAt: Date): 'consulta' | 'retorno' | null {
  const done = past.filter((a) => a.status === 'realizado').map((a) => new Date(a.scheduled_at).getTime())
  if (done.length > 0) {
    const last = Math.max(...done)
    return scheduledAt.getTime() - last <= RETURN_WINDOW_DAYS * DAY_MS ? 'retorno' : null
  }
  const unresolved = past.some((a) => a.status === 'agendado' || a.status === 'confirmado')
  return unresolved ? null : 'consulta'
}

/** Busca o histórico do paciente na account e classifica. Erro de leitura = não marca nada. */
export async function resolveBotAppointmentType(
  supabase: SupabaseClient<Database>,
  input: { accountId: string; patientId: string | null | undefined; scheduledAt: Date; now: Date }
): Promise<'consulta' | 'retorno' | null> {
  if (!input.patientId) return 'consulta' // paciente novo: nunca foi atendido
  const { data, error } = await supabase
    .from('appointments')
    .select('scheduled_at, status')
    .eq('account_id', input.accountId)
    .eq('patient_id', input.patientId)
    .lt('scheduled_at', input.now.toISOString())
    .in('status', ['realizado', 'agendado', 'confirmado'])
  if (error) {
    console.error(`[appointment-type] histórico indisponível patient=${input.patientId}`)
    return null
  }
  return classifyAppointmentType(Array.isArray(data) ? (data as PastAppointment[]) : [], input.scheduledAt)
}
