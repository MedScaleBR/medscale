// Conversões para a Meta (Conversions API for Business Messaging): cada consulta
// marcada por paciente que veio de anúncio Click-to-WhatsApp vira um
// LeadSubmitted, para a campanha otimizar por agendamento e não só por conversa.
// Sem valor da consulta, por decisão de produto.
// LGPD: logs daqui levam só ids — nunca telefone, nome ou ctwa_clid.

import { format } from 'date-fns'
import { TZDate } from '@date-fns/tz'
import { brazilianPhoneKey } from '@/lib/phone'

const TZ = 'America/Sao_Paulo'

export interface ClickRow {
  patient_phone: string
  ctwa_clid: string | null
  occurred_at: string
}

/** Clique mais recente do paciente que aconteceu até o momento do agendamento. */
export function pickClickId(rows: ClickRow[], patientPhone: string, occurredAt: Date): string | null {
  const key = brazilianPhoneKey(patientPhone)
  const limit = occurredAt.getTime()
  let best: { clid: string; at: number } | null = null
  for (const r of rows) {
    if (!r.ctwa_clid || brazilianPhoneKey(r.patient_phone) !== key) continue
    const at = new Date(r.occurred_at).getTime()
    if (at > limit) continue
    if (!best || at > best.at) best = { clid: r.ctwa_clid, at }
  }
  return best?.clid ?? null
}

export function buildLeadSubmittedPayload(e: {
  dedupKey: string
  eventTime: Date
  wabaId: string
  ctwaClid: string
}) {
  return {
    data: [
      {
        event_name: 'LeadSubmitted',
        event_time: Math.floor(e.eventTime.getTime() / 1000),
        event_id: e.dedupKey,
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        user_data: { whatsapp_business_account_id: e.wabaId, ctwa_clid: e.ctwaClid },
      },
    ],
    partner_agent: 'medscale' as const,
  }
}

export function appointmentDedupKey(appointmentId: string): string {
  return `appt:${appointmentId}`
}

/** Agenda externa: uma solicitação por conversa por dia (fuso de São Paulo). */
export function externalRequestDedupKey(conversationId: string, at: Date): string {
  return `ext:${conversationId}:${format(new TZDate(at, TZ), 'yyyy-MM-dd')}`
}
