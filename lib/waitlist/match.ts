import { TZDate } from '@date-fns/tz'

const TZ = 'America/Sao_Paulo'

// Shape mínimo de uma linha de waitlist lida pelo cron.
export interface WaitlistRow {
  id: string
  workspace_id: string
  account_id: string
  patient_name: string
  patient_phone: string
  notified_at: string | null
  desired_date: string | null
  desired_time: string | null
  source: string
}

// Entradas da Clara (source 'bot' com dia desejado) casam só aquele dia; o
// resto — inclusive uma entrada 'bot' sem data, que não deveria existir —
// segue o caminho manual (próximos dias, qualquer vaga).
export function partitionWaitlist(rows: WaitlistRow[]): { bot: WaitlistRow[]; manual: WaitlistRow[] } {
  const bot: WaitlistRow[] = []
  const manual: WaitlistRow[] = []
  for (const r of rows) {
    if (r.source === 'bot' && r.desired_date) bot.push(r)
    else manual.push(r)
  }
  return { bot, manual }
}

// Texto do slot para o template Meta `waitlist_slot_specific`.
// `desiredDate` = 'AAAA-MM-DD'. Meio-dia evita qualquer efeito de borda de fuso.
export function formatBotSlot(desiredDate: string, desiredTime: string | null, freeTimes: string[]): string {
  const label = new TZDate(`${desiredDate}T12:00:00`, TZ).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  })
  if (desiredTime) return `${label} às ${desiredTime.slice(0, 5)}`
  return `${label} — ${freeTimes.join(', ')}`
}
