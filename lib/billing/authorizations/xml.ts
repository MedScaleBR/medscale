import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { BuiltBatch } from '@/lib/billing/types'
import { validate } from '@/lib/tiss/v4_03_00/batch'
import {
  AuthorizationBuildError, buildAuthorizationRequestMessage, buildOpmeAnnexMessage,
} from '@/lib/tiss/v4_03_00/authorization-messages'
import { AUTHORIZATION_ITEM_COLUMNS } from './constants'
import { failIfRead } from './rpc-errors'
import type {
  AnyAuthorizationPayload, AnyAuthorizationXmlSource, AuthorizationItem, AuthorizationStatus, AuthorizationType,
  AuthorizationXmlSource,
} from './types'

type BillingClient = SupabaseClient<Database>

interface XmlRow {
  id: string
  type: AuthorizationType
  status: AuthorizationStatus
  provider_guide_number: string
  requested_at: string
  payload: AnyAuthorizationPayload
  missing_fields: string[]
  parent_id: string | null
}

const XML_ROW_COLUMNS = 'id, type, status, provider_guide_number, requested_at, payload, missing_fields, parent_id'

const FILE_PREFIX: Record<AuthorizationType, string> = {
  sp_sadt_request: 'solicitacao-sp-sadt',
  hospitalization_request: 'solicitacao-internacao',
  opme_request: 'anexo-opme',
}

export type AuthorizationXmlResult =
  | { ok: true; xml: Buffer; hash: string; fileName: string }
  | { ok: false; status: 404 | 409 | 422; error: string; errors?: string[] }
  | { ok: false; rpcError: { message?: string; code?: string } }

// D5: embute o OPME só quando há exatamente um vinculado não cancelado.
export function selectEmbeddedOpme<T extends { status: AuthorizationStatus }>(children: T[]): T | null {
  const active = children.filter((c) => c.status !== 'cancelled')
  return active.length === 1 ? active[0] : null
}

function toSource(row: XmlRow, items: AuthorizationItem[]): AnyAuthorizationXmlSource {
  const base = { providerGuideNumber: row.provider_guide_number, requestedAt: row.requested_at, items }
  const payload = row.payload
  switch (payload.type) {
    case 'sp_sadt_request': return { ...base, type: payload.type, payload }
    case 'hospitalization_request': return { ...base, type: payload.type, payload }
    case 'opme_request': return { ...base, type: payload.type, payload }
  }
}

async function loadItems(supabase: BillingClient, authorizationId: string): Promise<AuthorizationItem[]> {
  const { data, error } = await supabase
    .from('tiss_authorization_items')
    .select(AUTHORIZATION_ITEM_COLUMNS)
    .eq('authorization_id', authorizationId)
    .order('position', { ascending: true })
  failIfRead('itens', error)
  return (data ?? []) as unknown as AuthorizationItem[]
}

const CANCELLED = 'Autorização cancelada não gera XML.'
const INCOMPLETE = 'Complete os campos pendentes antes de gerar o XML.'

// Gera sob demanda (nada vai para o storage), valida no XSD e registra o
// evento xml_generated com o hash. Leituras com o client do usuário (RLS).
export async function generateAuthorizationXml(
  supabase: BillingClient,
  accountId: string,
  id: string,
  now: Date,
): Promise<AuthorizationXmlResult> {
  const { data, error: rowError } = await supabase
    .from('tiss_authorizations')
    .select(XML_ROW_COLUMNS)
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  failIfRead('autorização', rowError)
  const row = data as unknown as XmlRow | null
  if (!row) return { ok: false, status: 404, error: 'Autorização não encontrada' }
  if (row.status === 'cancelled') return { ok: false, status: 409, error: CANCELLED }
  if (row.status === 'draft' || row.missing_fields.length > 0) return { ok: false, status: 409, error: INCOMPLETE }

  const source = toSource(row, await loadItems(supabase, row.id))
  let built: BuiltBatch
  try {
    if (source.type === 'opme_request') {
      const { data: parent, error: parentError } = await supabase
        .from('tiss_authorizations')
        .select('provider_guide_number')
        .eq('id', row.parent_id ?? '')
        .eq('account_id', accountId)
        .maybeSingle()
      failIfRead('guia de origem', parentError)
      if (!parent) return { ok: false, status: 404, error: 'Guia de origem não encontrada' }
      built = buildOpmeAnnexMessage({ annex: source, referencedGuideNumber: parent.provider_guide_number, now })
    } else {
      const { data: children, error: childrenError } = await supabase
        .from('tiss_authorizations')
        .select(XML_ROW_COLUMNS)
        .eq('parent_id', row.id)
        .eq('account_id', accountId)
      failIfRead('anexos vinculados', childrenError)
      const childRows = (children ?? []) as unknown as XmlRow[]
      const embedded = selectEmbeddedOpme(childRows)
      const hasActiveOpme = childRows.some((child) => child.status !== 'cancelled')
      let opme: AuthorizationXmlSource<'opme_request'> | null = null
      if (embedded) {
        if (embedded.missing_fields.length > 0) {
          return { ok: false, status: 409, error: 'O anexo OPME vinculado está incompleto. Complete-o ou cancele-o antes de gerar o XML.' }
        }
        const child = toSource(embedded, await loadItems(supabase, embedded.id))
        if (child.type !== 'opme_request') return { ok: false, status: 409, error: INCOMPLETE }
        opme = child
      }
      built = buildAuthorizationRequestMessage({ request: source, embeddedOpme: opme, hasActiveOpme, now })
    }
  } catch (err) {
    // Só a falha conhecida dos montadores (sem itens, já coberta por
    // missing_fields) vira 409; qualquer outro erro é bug e propaga (500).
    if (err instanceof AuthorizationBuildError) return { ok: false, status: 409, error: INCOMPLETE }
    throw err
  }

  const validation = await validate(built.xml)
  if (!validation.valid) {
    return { ok: false, status: 422, error: 'O XML gerado não passou na validação do XSD da ANS.', errors: validation.errors }
  }

  const { error } = await supabase.rpc('log_tiss_authorization_xml', { p_id: row.id, p_hash: built.hash })
  if (error) return { ok: false, rpcError: error }

  return { ok: true, xml: built.xml, hash: built.hash, fileName: `${FILE_PREFIX[row.type]}-${row.provider_guide_number}.xml` }
}
