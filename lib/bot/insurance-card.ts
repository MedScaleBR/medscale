// Foto da carteirinha enviada pelo paciente no WhatsApp. Só vale nas unidades
// que pedem 'insurance_card_photo'; nos outros casos a imagem segue o fluxo de
// mídia não suportada. A Clara nunca vê a imagem: ela recebe um texto de
// sistema dizendo que a foto foi salva (ou que não deu para receber).
//
// LGPD: a foto é dado sensível. Log só com ids, tamanho, MIME e status.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/crypto'
import { graphUrl } from '@/lib/meta/graph'
import { getAccountUnits, getBotConfig } from '@/lib/bot/config'
import {
  INSURANCE_CARD_RECEIVED_TEXT,
  INSURANCE_CARD_REJECTED_TEXT,
  insuranceCardMessage,
} from '@/lib/bot/unit-settings'
import type { Database } from '@/types/database'

export const INSURANCE_CARD_BUCKET = 'insurance-cards'
export const INSURANCE_CARD_MAX_BYTES = 10 * 1024 * 1024
/** Validade das signed URLs da foto (segundos). */
export const INSURANCE_CARD_SIGNED_URL_TTL = 5 * 60

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

/** MIME aceito para a foto (sem parâmetros como "; charset"). */
export function normalizeCardMime(mime: string | null | undefined): string | null {
  const base = mime?.split(';')[0].trim().toLowerCase()
  return base && base in MIME_EXT ? base : null
}

/** Partes da mensagem do WhatsApp que importam aqui. */
export interface IncomingMedia {
  type: 'image' | 'document'
  mediaId: string
  mimeType: string | null
  caption: string | null
}

/** Extrai a mídia de uma mensagem `image` ou `document`; outros tipos → null. */
export function parseIncomingMedia(message: {
  type?: string
  image?: { id?: string; mime_type?: string; caption?: string }
  document?: { id?: string; mime_type?: string; caption?: string }
}): IncomingMedia | null {
  if (message.type !== 'image' && message.type !== 'document') return null
  const part = message.type === 'image' ? message.image : message.document
  if (!part?.id) return null
  return {
    type: message.type,
    mediaId: part.id,
    mimeType: part.mime_type ?? null,
    caption: part.caption ?? null,
  }
}

type SupabaseAdmin = SupabaseClient<Database>

/**
 * A unidade da conversa pede a foto? Conversa sem unidade só conta numa
 * account de unidade única. Devolve o id da conversa e da unidade, ou null.
 */
export async function cardPhotoTarget(
  supabase: SupabaseAdmin,
  accountId: string,
  patientPhone: string
): Promise<{ conversationId: string; workspaceId: string } | null> {
  const units = await getAccountUnits(accountId)
  if (units.length === 0) return null

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, workspace_id')
    .eq('account_id', accountId)
    .eq('patient_phone', patientPhone)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!conversation) return null

  const unitId = conversation.workspace_id ?? (units.length === 1 ? units[0].id : null)
  const unit = unitId ? units.find((u) => u.id === unitId) : undefined
  if (!unit?.botSettings.intakeFields.includes('insurance_card_photo')) return null
  return { conversationId: conversation.id, workspaceId: unit.id }
}

type DownloadResult =
  | { ok: true; bytes: ArrayBuffer; mime: string }
  | { ok: false; reason: 'mime' | 'too_large' | 'download_failed' }

/** Baixa a mídia pela Graph API: GET /{media-id} → URL → arquivo, com o token da account. */
export async function downloadWhatsAppMedia(
  mediaId: string,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<DownloadResult> {
  try {
    const metaRes = await fetchImpl(graphUrl(`/${mediaId}`), { headers: { Authorization: `Bearer ${token}` } })
    if (!metaRes.ok) return { ok: false, reason: 'download_failed' }
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string; file_size?: number }
    const mime = normalizeCardMime(meta.mime_type)
    if (!mime) return { ok: false, reason: 'mime' }
    if (typeof meta.file_size === 'number' && meta.file_size > INSURANCE_CARD_MAX_BYTES) return { ok: false, reason: 'too_large' }
    if (!meta.url) return { ok: false, reason: 'download_failed' }

    const fileRes = await fetchImpl(meta.url, { headers: { Authorization: `Bearer ${token}` } })
    if (!fileRes.ok) return { ok: false, reason: 'download_failed' }
    const bytes = await fileRes.arrayBuffer()
    if (bytes.byteLength > INSURANCE_CARD_MAX_BYTES) return { ok: false, reason: 'too_large' }
    return { ok: true, bytes, mime }
  } catch {
    return { ok: false, reason: 'download_failed' }
  }
}

/**
 * Recebe a imagem/documento do paciente. Devolve null quando a unidade não
 * pede a foto (o chamador segue o fluxo de mídia não suportada). Senão, salva
 * o arquivo e devolve o texto de sistema que a Clara recebe no lugar da imagem.
 * Não chama a Clara: o webhook passa o texto ao processIncomingMessage, que
 * também respeita bot_paused (só registra e avisa a equipe).
 */
export async function receiveInsuranceCard(params: {
  accountId: string
  patientPhone: string
  whatsappMessageId: string
  media: IncomingMedia
  fetchImpl?: typeof fetch
}): Promise<string | null> {
  const { accountId, patientPhone, media } = params
  const supabase = createAdminClient()

  const botConfig = await getBotConfig(accountId)
  if (!botConfig?.isActive || !botConfig.metaToken) return null

  const target = await cardPhotoTarget(supabase, accountId, patientPhone)
  if (!target) return null

  // Documento de outro tipo (ex.: .docx) ou imagem fora da lista: pede outra foto.
  if (media.mimeType && !normalizeCardMime(media.mimeType)) {
    console.warn(`[insurance-card] rejected reason=mime conversation=${target.conversationId}`)
    return insuranceCardMessage(INSURANCE_CARD_REJECTED_TEXT, media.caption)
  }

  const download = await downloadWhatsAppMedia(media.mediaId, decryptToken(botConfig.metaToken), params.fetchImpl)
  if (!download.ok) {
    console.warn(`[insurance-card] rejected reason=${download.reason} conversation=${target.conversationId}`)
    return insuranceCardMessage(INSURANCE_CARD_REJECTED_TEXT, media.caption)
  }

  const path = `${accountId}/${target.conversationId}/${Date.now()}.${MIME_EXT[download.mime]}`
  const { error: uploadError } = await supabase.storage
    .from(INSURANCE_CARD_BUCKET)
    .upload(path, download.bytes, { contentType: download.mime, upsert: false })
  if (uploadError) {
    console.error(`[insurance-card] upload_failed conversation=${target.conversationId}`)
    return insuranceCardMessage(INSURANCE_CARD_REJECTED_TEXT, media.caption)
  }

  const { error: insertError } = await supabase.from('conversation_attachments').insert({
    account_id: accountId,
    workspace_id: target.workspaceId,
    conversation_id: target.conversationId,
    kind: 'insurance_card',
    storage_path: path,
    mime_type: download.mime,
    size_bytes: download.bytes.byteLength,
    whatsapp_media_id: media.mediaId,
  })
  if (insertError) {
    // Sem o registro o arquivo fica órfão: remove para não guardar dado sensível à toa.
    await supabase.storage.from(INSURANCE_CARD_BUCKET).remove([path])
    console.error(`[insurance-card] record_failed conversation=${target.conversationId}`)
    return insuranceCardMessage(INSURANCE_CARD_REJECTED_TEXT, media.caption)
  }

  console.log(
    `[insurance-card] saved conversation=${target.conversationId} workspace=${target.workspaceId} mime=${download.mime} size=${download.bytes.byteLength}`
  )
  return insuranceCardMessage(INSURANCE_CARD_RECEIVED_TEXT, media.caption)
}
