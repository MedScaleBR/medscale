// Marcadores de controle que a Clara inclui na resposta e que o sistema lê
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
// Data de nascimento (DD/MM/AAAA cru) — só nas unidades com confirmação da
// clínica parceira. A validação (data real, passado, idade) vive em security.ts.
export const BIRTH_DATE_MARKER = /NASCIMENTO_PACIENTE:\s*(\d{2}\/\d{2}\/\d{4})/
// Procedimento escolhido, para o ciclo de receita — id copiado da lista de
// procedimentos no system prompt. Opcional: só aparece quando a clínica tem
// catálogo de procedimentos cadastrado. Linha própria, não altera o
// CONFIRMATION_MARKER (regex acima) que já é sensível a formato.
export const PROCEDURE_ID_MARKER =
  /PROCEDIMENTO_ID:\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/

// Unidade escolhida pelo paciente — id copiado da lista de unidades no system
// prompt. Acompanha o AGENDAMENTO_CONFIRMADO quando a account tem mais de uma
// unidade. Linha própria, não interfere no CONFIRMATION_MARKER.
export const UNIT_ID_MARKER =
  /UNIDADE_ID:\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/

// O executor valida o id contra as operadoras ativas da própria conta.
// Lê também valores inválidos para não transformar um convênio em particular
// silenciosamente, e remove todas as linhas antes de responder ao paciente.
export const INSURANCE_CHOICE_MARKER = /^[\t ]*CONVENIO_ID:[\t ]*([^\r\n]*)\r?$/gm

// Lista de espera — a Clara emite quando o paciente, sem vaga no dia que
// queria, opta por ser avisado. Aceita data pura ou data+hora com offset de
// São Paulo (mesmo padrão do CONFIRMATION_MARKER). Grupo 1 = AAAA-MM-DD,
// grupo 2 = HH:mm (opcional).
export const WAITLIST_MARKER =
  /LISTA_ESPERA:\s*(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::\d{2})?-03:00)?/

// Dados que a unidade coleta (workspaces.intake_fields). Uma linha cada,
// ancoradas no começo da linha (flag m) para não pegar texto corrido como
// "seu CPF: ..." no meio de uma frase. O valor cru é validado em security.ts.
export const ISO_BIRTH_DATE_MARKER = /^[\t ]*DATA_NASCIMENTO:[\t ]*([^\r\n]*)\r?$/gm
export const CARD_NUMBER_MARKER = /^[\t ]*CARTEIRINHA:[\t ]*([^\r\n]*)\r?$/gm
export const CPF_MARKER = /^[\t ]*CPF:[\t ]*([^\r\n]*)\r?$/gm
export const EMAIL_MARKER = /^[\t ]*EMAIL:[\t ]*([^\r\n]*)\r?$/gm
export const REASON_MARKER = /^[\t ]*MOTIVO_CONSULTA:[\t ]*([^\r\n]*)\r?$/gm
export const PREFERENCE_MARKER = /^[\t ]*PREFERENCIA_HORARIO:[\t ]*([^\r\n]*)\r?$/gm
// Unidade com agenda externa: fecha a coleta e dispara o handoff da solicitação.
export const SCHEDULING_REQUEST_MARKER = /^[\t ]*SOLICITACAO_AGENDAMENTO[\t ]*\r?$/gm

export const HANDOFF_MARKER = '[HANDOFF]'

// Último valor não vazio de um marcador de linha (a Clara pode corrigir um dado
// na mesma resposta; vale a escolha mais recente).
function lastLineValue(raw: string, marker: RegExp): string | null {
  const values = [...raw.matchAll(marker)].map((m) => m[1].trim()).filter(Boolean)
  return values.at(-1) ?? null
}

export interface ParsedMarkers {
  /** Horário confirmado, exatamente como o Claude escreveu (ISO com -03:00), ou null. */
  confirmedSlot: string | null
  /** Instante do agendamento; null quando não há marcador ou a data é inválida. */
  confirmedDate: Date | null
  /** Id da consulta a cancelar, ou null. */
  cancelledAppointmentId: string | null
  /** Id do procedimento escolhido (catálogo), ou null. */
  procedureId: string | null
  /** Id da unidade escolhida pelo paciente, ou null. */
  unitId: string | null
  /** Id da operadora ou PARTICULAR; vazio/inválido exige esclarecimento. */
  insuranceChoice: string | null
  /** Nome completo informado pelo paciente, já com trim, ou null. */
  patientName: string | null
  /** Nascimento como a Clara escreveu (DD/MM/AAAA), ainda sem validar, ou null. */
  patientBirthDate: string | null
  /** Dia (e horário, se o paciente nomeou um) que o paciente quer esperar, ou null. */
  waitlistDesired: { date: string; time: string | null } | null
  /** DATA_NASCIMENTO cru (AAAA-MM-DD esperado), ainda sem validar, ou null. */
  isoBirthDate: string | null
  /** CARTEIRINHA crua, ou null. */
  cardNumber: string | null
  /** CPF cru, ou null. */
  cpf: string | null
  /** EMAIL cru, ou null. */
  email: string | null
  /** MOTIVO_CONSULTA cru, ou null. */
  reason: string | null
  /** PREFERENCIA_HORARIO cru, ou null. */
  preference: string | null
  /** A Clara fechou a coleta de uma unidade com agenda externa. */
  schedulingRequested: boolean
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

// Carimbo que buildClaudeMessages põe em cada mensagem do histórico.
const HISTORY_TIMESTAMP = /^[ \t]*\[Mensagem (?:enviada em [^\]\n]*|sem data registrada[^\]\n]*)\][ \t]*\n?/gm

export function parseMarkers(rawMessage: string): ParsedMarkers {
  const confirmMatch = rawMessage.match(CONFIRMATION_MARKER)
  const cancelMatch = rawMessage.match(CANCELLATION_MARKER)
  const procedureMatch = rawMessage.match(PROCEDURE_ID_MARKER)
  const unitMatch = rawMessage.match(UNIT_ID_MARKER)
  const insuranceMatches = [...rawMessage.matchAll(INSURANCE_CHOICE_MARKER)]
  const nameMatch = rawMessage.match(PATIENT_NAME_MARKER)
  const waitlistMatch = rawMessage.match(WAITLIST_MARKER)
  const birthMatch = rawMessage.match(BIRTH_DATE_MARKER)

  const confirmedSlot = confirmMatch?.[1] ?? null
  const confirmedDate = confirmedSlot ? new Date(confirmedSlot) : null

  const patientName = nameMatch?.[1]?.trim() || null

  const cleanedMessage = rawMessage
    // O histórico chega com "[Mensagem enviada em …]"; a Clara às vezes copia.
    .replace(HISTORY_TIMESTAMP, '')
    .replace(CONFIRMATION_MARKER, '')
    .replace(CANCELLATION_MARKER, '')
    .replace(PROCEDURE_ID_MARKER, '')
    .replace(UNIT_ID_MARKER, '')
    .replace(INSURANCE_CHOICE_MARKER, '')
    .replace(PATIENT_NAME_MARKER, '')
    .replace(BIRTH_DATE_MARKER, '')
    .replace(WAITLIST_MARKER, '')
    .replace(ISO_BIRTH_DATE_MARKER, '')
    .replace(CARD_NUMBER_MARKER, '')
    .replace(CPF_MARKER, '')
    .replace(EMAIL_MARKER, '')
    .replace(REASON_MARKER, '')
    .replace(PREFERENCE_MARKER, '')
    .replace(SCHEDULING_REQUEST_MARKER, '')
    .trim()

  return {
    confirmedSlot,
    confirmedDate: confirmedDate && !Number.isNaN(confirmedDate.getTime()) ? confirmedDate : null,
    cancelledAppointmentId: cancelMatch?.[1] ?? null,
    procedureId: procedureMatch?.[1] ?? null,
    unitId: unitMatch?.[1] ?? null,
    insuranceChoice: insuranceMatches.length === 1 ? insuranceMatches[0][1].trim() : insuranceMatches.length > 1 ? '' : null,
    patientName,
    patientBirthDate: birthMatch?.[1] ?? null,
    waitlistDesired: waitlistMatch ? { date: waitlistMatch[1], time: waitlistMatch[2] ?? null } : null,
    isoBirthDate: lastLineValue(rawMessage, ISO_BIRTH_DATE_MARKER),
    cardNumber: lastLineValue(rawMessage, CARD_NUMBER_MARKER),
    cpf: lastLineValue(rawMessage, CPF_MARKER),
    email: lastLineValue(rawMessage, EMAIL_MARKER),
    reason: lastLineValue(rawMessage, REASON_MARKER),
    preference: lastLineValue(rawMessage, PREFERENCE_MARKER),
    schedulingRequested: [...rawMessage.matchAll(SCHEDULING_REQUEST_MARKER)].length > 0,
    handoffRequested: cleanedMessage.includes(HANDOFF_MARKER),
    cleanedMessage,
    messageForPatient: cleanedMessage.replace(HANDOFF_MARKER, '').trim(),
  }
}
