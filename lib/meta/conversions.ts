// Conversões para a Meta (Conversions API for Business Messaging): cada consulta
// marcada por paciente que veio de anúncio Click-to-WhatsApp vira um
// LeadSubmitted, para a campanha otimizar por agendamento e não só por conversa.
// Sem valor da consulta, por decisão de produto.
// LGPD: logs daqui levam só ids — nunca telefone, nome ou ctwa_clid.

import { format } from 'date-fns'
import { TZDate } from '@date-fns/tz'
import { brazilianPhoneKey } from '@/lib/phone'
import type { Database } from '@/types/database'
import { createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/crypto'
import { graphFetch, MetaApiError } from '@/lib/meta/graph'

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

// ---------------------------------------------------------------------------
// I/O: enfileirar e enviar. Nada aqui lança para quem chama — perder um evento
// é ruim, atrasar o agendamento ou a resposta ao paciente é pior.
// ---------------------------------------------------------------------------

type Admin = ReturnType<typeof createAdminClient>

export interface QueueLeadConversionInput {
  accountId: string
  patientPhone: string
  dedupKey: string
  appointmentId?: string | null
  occurredAt?: Date
}

/** Grava o LeadSubmitted (se o paciente veio de anúncio) e tenta enviar na hora. */
export async function queueLeadConversion(
  input: QueueLeadConversionInput,
  client: Admin = createAdminClient()
): Promise<void> {
  try {
    const occurredAt = input.occurredAt ?? new Date()
    const digits = input.patientPhone.replace(/\D/g, '')
    if (digits.length < 8) return

    // Últimos 8 dígitos absorvem máscara e nono dígito; pickClickId confirma.
    const { data: rows, error } = await client
      .from('lead_attributions')
      .select('patient_phone, ctwa_clid, occurred_at')
      .eq('account_id', input.accountId)
      .not('ctwa_clid', 'is', null)
      .like('patient_phone', `%${digits.slice(-8)}`)
    if (error) throw error

    const ctwaClid = pickClickId((rows ?? []) as ClickRow[], input.patientPhone, occurredAt)
    if (!ctwaClid) return

    const { data: inserted, error: insertError } = await client
      .from('meta_conversion_events')
      .upsert(
        {
          account_id: input.accountId,
          appointment_id: input.appointmentId ?? null,
          dedup_key: input.dedupKey,
          ctwa_clid: ctwaClid,
          event_time: occurredAt.toISOString(),
        },
        { onConflict: 'account_id,dedup_key', ignoreDuplicates: true }
      )
      .select('id')
    if (insertError) throw insertError

    // Sem linha de volta = esse agendamento já tinha evento. Não reenvia.
    const id = (inserted as { id: string }[] | null)?.[0]?.id
    if (!id) return

    await sendConversionEvent(id, client)
  } catch {
    console.error(`[meta-capi] queue falhou account=${input.accountId} key=${input.dedupKey}`)
  }
}

/** Envia um evento já gravado. Usado na hora e pelo cron de reenvio. */
export async function sendConversionEvent(
  eventId: string,
  client: Admin = createAdminClient()
): Promise<'sent' | 'failed'> {
  let attempts = 0
  const mark = async (patch: Database['public']['Tables']['meta_conversion_events']['Update']) => {
    await client.from('meta_conversion_events').update(patch).eq('id', eventId)
  }

  try {
    const { data: event, error } = await client
      .from('meta_conversion_events')
      .select('id, account_id, dedup_key, ctwa_clid, event_time, attempts')
      .eq('id', eventId)
      .single()
    if (error || !event) throw error ?? new Error('evento não encontrado')
    attempts = event.attempts + 1

    const { data: config } = await client
      .from('bot_config')
      .select('waba_id, meta_token, meta_dataset_id')
      .eq('account_id', event.account_id)
      .maybeSingle()
    if (!config?.waba_id || !config.meta_token) {
      await mark({ status: 'failed', attempts, last_error: 'not_connected' })
      return 'failed'
    }

    const token = decryptToken(config.meta_token)
    const datasetId = config.meta_dataset_id ?? (await ensureDatasetId(event.account_id, config.waba_id, token, client))

    await graphFetch(`/${datasetId}/events`, {
      method: 'POST',
      token,
      body: buildLeadSubmittedPayload({
        dedupKey: event.dedup_key,
        eventTime: new Date(event.event_time),
        wabaId: config.waba_id,
        ctwaClid: event.ctwa_clid,
      }),
    })

    await mark({ status: 'sent', attempts, sent_at: new Date().toISOString(), last_error: null })
    return 'sent'
  } catch (err) {
    const lastError =
      err instanceof MetaApiError ? `${err.code ?? err.status}:${err.message}`.slice(0, 300) : 'internal_error'
    console.error(`[meta-capi] envio falhou event=${eventId} error=${lastError.split(':')[0]}`)
    try {
      await mark({ status: 'failed', attempts: Math.max(attempts, 1), last_error: lastError })
    } catch {
      // Nada a fazer: o cron tenta de novo enquanto estiver pending/failed.
    }
    return 'failed'
  }
}

/** Dataset ligado ao WABA. O POST devolve o existente se já houver um. */
export async function ensureDatasetId(accountId: string, wabaId: string, token: string, client: Admin): Promise<string> {
  const { id } = await graphFetch<{ id: string }>(`/${wabaId}/dataset`, { method: 'POST', token })
  await client.from('bot_config').update({ meta_dataset_id: id }).eq('account_id', accountId)
  return id
}
