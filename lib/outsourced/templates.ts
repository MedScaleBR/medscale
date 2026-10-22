import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'

const TZ = 'America/Sao_Paulo'

export const TEMPLATE_SOLICITACAO_AGENDAMENTO = 'solicitacao_agendamento'
export const TEMPLATE_CONSULTA_CONFIRMADA = 'consulta_confirmada'
export const TEMPLATE_LANGUAGE = 'pt_BR'

export interface SolicitacaoInput {
  scheduledAt: Date
  patientName: string
  insuranceLabel: string
  birthDate: string // AAAA-MM-DD
  patientPhone: string
}

/** A Meta rejeita parâmetros com quebra de linha, tab ou 4+ espaços seguidos, e vazios. */
export function sanitizeTemplateParam(v: string): string {
  const clean = v.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
  return clean || '-'
}

/** Telefone como a clínica lê: `71 99999-0000` (sem o 55). */
export function formatPhoneForTemplate(phone: string): string {
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) digits = digits.slice(2)
  if (digits.length === 11) return `${digits.slice(0, 2)} ${digits.slice(2, 7)}-${digits.slice(7)}`
  if (digits.length === 10) return `${digits.slice(0, 2)} ${digits.slice(2, 6)}-${digits.slice(6)}`
  return digits
}

export function formatBirthDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${d}/${m}/${y}`
}

export function buildSolicitacaoParams(i: SolicitacaoInput): string[] {
  const zoned = new TZDate(i.scheduledAt, TZ)
  return [
    format(zoned, 'dd/MM'),
    format(zoned, 'HH:mm'),
    sanitizeTemplateParam(i.patientName),
    sanitizeTemplateParam(i.insuranceLabel),
    formatBirthDate(i.birthDate),
    formatPhoneForTemplate(i.patientPhone),
  ]
}

/** Texto do template cadastrado na Meta, para registrar a mensagem enviada no histórico. */
export function renderSolicitacaoText(params: string[]): string {
  const [dia, hora, nome, convenio, nascimento, contato] = params
  return `Olá, tudo bem?\n\nAgenda por favor o dia ${dia} às ${hora}:\n\nNome: ${nome}\nConvênio: ${convenio}\nData de Nascimento: ${nascimento}\nContato: ${contato}\n\nAguardamos a confirmação. Obrigado!`
}

export function buildConsultaConfirmadaParams(i: { patientName: string; scheduledAt: Date; unitName: string }): string[] {
  const zoned = new TZDate(i.scheduledAt, TZ)
  return [
    sanitizeTemplateParam(i.patientName.trim().split(/\s+/)[0] ?? ''),
    format(zoned, 'dd/MM'),
    format(zoned, 'HH:mm'),
    sanitizeTemplateParam(i.unitName),
  ]
}
