// Marcadores de controle que a Maria inclui na resposta e que o sistema lê
// (e remove antes de enviar ao paciente). Este arquivo é a ÚNICA fonte de
// verdade do formato — o parsing vive aqui, isolado e puro, porque é a
// interface entre o texto livre do Claude e as ações reais no banco:
// qualquer variação de formato quebra agendamento/cancelamento em silêncio.

// Data com offset explícito de São Paulo — evita que o `new Date(...)` do
// Node interprete o horário como local do servidor (Vercel roda em UTC).
export const CONFIRMATION_MARKER = /AGENDAMENTO_CONFIRMADO:\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?-03:00)/
// Cancelamento referencia o id real da consulta (copiado do system prompt),
// não um horário reconstruído.
export const CANCELLATION_MARKER =
  /CANCELAMENTO_CONFIRMADO:\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/
export const PATIENT_NAME_MARKER = /NOME_PACIENTE:\s*(.+)/

export const HANDOFF_MARKER = '[HANDOFF]'

export interface ParsedMarkers {
  /** Horário confirmado, exatamente como o Claude escreveu (ISO com -03:00), ou null. */
  confirmedSlot: string | null
  /** Instante do agendamento; null quando não há marcador ou a data é inválida. */
  confirmedDate: Date | null
  /** Id da consulta a cancelar, ou null. */
  cancelledAppointmentId: string | null
  /** Nome completo informado pelo paciente, já com trim, ou null. */
  patientName: string | null
  /** O Claude sinalizou transferência para atendimento humano. */
  handoffRequested: boolean
  /**
   * Resposta sem as linhas de marcação de agendamento/cancelamento/nome.
   * O `[HANDOFF]` é mantido de propósito: quem decide se o handoff acontece
   * de verdade (detectHandoffIntent) ainda precisa vê-lo.
   */
  cleanedMessage: string
  /** Texto pronto para o paciente — também sem o `[HANDOFF]`. */
  messageForPatient: string
}

export function parseMarkers(rawMessage: string): ParsedMarkers {
  const confirmMatch = rawMessage.match(CONFIRMATION_MARKER)
  const cancelMatch = rawMessage.match(CANCELLATION_MARKER)
  const nameMatch = rawMessage.match(PATIENT_NAME_MARKER)

  const confirmedSlot = confirmMatch?.[1] ?? null
  const confirmedDate = confirmedSlot ? new Date(confirmedSlot) : null

  const patientName = nameMatch?.[1]?.trim() || null

  const cleanedMessage = rawMessage
    .replace(CONFIRMATION_MARKER, '')
    .replace(CANCELLATION_MARKER, '')
    .replace(PATIENT_NAME_MARKER, '')
    .trim()

  return {
    confirmedSlot,
    confirmedDate: confirmedDate && !Number.isNaN(confirmedDate.getTime()) ? confirmedDate : null,
    cancelledAppointmentId: cancelMatch?.[1] ?? null,
    patientName,
    handoffRequested: cleanedMessage.includes(HANDOFF_MARKER),
    cleanedMessage,
    messageForPatient: cleanedMessage.replace(HANDOFF_MARKER, '').trim(),
  }
}
