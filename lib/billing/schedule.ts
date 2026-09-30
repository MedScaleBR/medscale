import { TZDate } from '@date-fns/tz'
import { BILLING_TZ } from './constants'

// O cron roda de hora em hora; a operadora está "no horário" quando o dia da
// semana e a hora atuais em São Paulo batem com o que a clínica programou.
// batch_weekdays usa 0 = domingo, como Date#getDay.
export function isBatchDue(
  insurer: { batch_weekdays: number[]; batch_hour: number; is_active: boolean },
  now: TZDate,
): boolean {
  if (!insurer.is_active) return false
  const local = now.timeZone === BILLING_TZ ? now : new TZDate(now, BILLING_TZ)
  return insurer.batch_weekdays.includes(local.getDay()) && local.getHours() === insurer.batch_hour
}
