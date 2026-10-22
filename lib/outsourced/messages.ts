import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import type { OutsourcedMissingField } from '@/lib/outsourced/config'

const TZ = 'America/Sao_Paulo'

/** Ex.: `sexta-feira, 16/10`. */
export function formatDayLabel(d: Date): string {
  const weekday = new Date(d).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: TZ })
  return `${weekday}, ${format(new TZDate(d, TZ), 'dd/MM')}`
}

export function formatTimeLabel(d: Date): string {
  return format(new TZDate(d, TZ), 'HH:mm')
}

export function requestedMessage(i: { scheduledAt: Date; unitName: string }): string {
  return `Pronto, solicitei o horário de ${formatDayLabel(i.scheduledAt)} às ${formatTimeLabel(i.scheduledAt)} na ${i.unitName}. Assim que a clínica confirmar eu te aviso aqui mesmo. 😊`
}

export function alreadyPendingMessage(unitName: string): string {
  return `Você já tem uma solicitação de horário em andamento na ${unitName}. Assim que a clínica confirmar eu te aviso aqui mesmo.`
}

export const REQUEST_FAILED_MESSAGE = 'Não consegui solicitar esse horário agora. A equipe vai te retornar por aqui em breve.'

export function confirmedMessage(i: { scheduledAt: Date; unitName: string; address: string | null }): string {
  const where = i.address ? `${i.unitName}, ${i.address}` : i.unitName
  return `Sua consulta está confirmada! ✅ ${formatDayLabel(i.scheduledAt)} às ${formatTimeLabel(i.scheduledAt)} na ${where}.`
}

const MISSING_LABEL: Record<OutsourcedMissingField, string> = {
  nome: 'seu nome completo',
  nascimento: 'sua data de nascimento',
  convenio: 'seu convênio (ou se será particular)',
}

export function missingDataMessage(missing: OutsourcedMissingField[], unitName: string): string {
  const labels = missing.map((m) => MISSING_LABEL[m])
  const list = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}` : labels[0]
  return `Para solicitar o horário na ${unitName}, preciso de ${list}. Pode me passar?`
}
