import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { normalizeBrazilianPhone } from '@/lib/phone'

interface ButtonMessage {
  type?: string
  button?: { payload?: string }
  interactive?: { type?: string; button_reply?: { id?: string } }
}

const unavailable = 'Não foi possível confirmar essa consulta pelo lembrete. Entre em contato com a equipe para verificar seu agendamento.'

// O payload identifica uma consulta específica; nunca inferir por nome do botão
// ou pela próxima consulta, pois um paciente pode ter múltiplos agendamentos.
export async function confirmReminderAppointment(
  supabase: SupabaseClient<Database>, accountId: string, patientPhone: string, message: ButtonMessage,
): Promise<{ handled: boolean; reply: string | null }> {
  const payload = message.type === 'button' ? message.button?.payload
    : message.type === 'interactive' && message.interactive?.type === 'button_reply' ? message.interactive.button_reply?.id : null
  if (!payload?.startsWith('confirm_appointment:')) return { handled: false, reply: null }
  const id = payload.slice('confirm_appointment:'.length)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { handled: true, reply: unavailable }

  const { data: appointment, error } = await supabase.from('appointments')
    .select('id, patient_phone, scheduled_at, status, reminder_sent')
    .eq('id', id).eq('account_id', accountId).maybeSingle()
  if (error) throw new Error(error.message)
  const normalizedPhone = normalizeBrazilianPhone(patientPhone)
  if (!appointment || !normalizedPhone || normalizeBrazilianPhone(appointment.patient_phone) !== normalizedPhone) {
    return { handled: true, reply: unavailable }
  }
  if (appointment.status === 'confirmado') return { handled: true, reply: null }
  const now = new Date().toISOString()
  if (appointment.status !== 'agendado' || !appointment.reminder_sent || new Date(appointment.scheduled_at).getTime() <= new Date(now).getTime()) {
    return { handled: true, reply: unavailable }
  }
  const { data: updated, error: updateError } = await supabase.from('appointments')
    .update({ status: 'confirmado' })
    .eq('id', id).eq('account_id', accountId).eq('patient_phone', appointment.patient_phone)
    .eq('status', 'agendado').eq('reminder_sent', true).gt('scheduled_at', now)
    .select('id')
  if (updateError) throw new Error(updateError.message)
  if (!updated?.length) return { handled: true, reply: unavailable }
  const date = new Date(appointment.scheduled_at).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  })
  return { handled: true, reply: `Sua consulta de ${date} está confirmada. Até lá!` }
}
