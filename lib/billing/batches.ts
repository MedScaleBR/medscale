import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { v4_03_00, MAX_GUIDES_PER_BATCH } from '@/lib/tiss/v4_03_00/batch'
import { trackBillingBatchGenerated } from '@/lib/analytics/posthog-server'
import type { BatchGuide, GuidePayload, GuideType, TissVersionModule } from './types'
import type { Database } from '@/types/database'
import { TISS_BUCKET, type TissStorage } from './storage'

type BillingClient = SupabaseClient<Database>
type InsurerRow = Database['public']['Tables']['health_insurers']['Row']

export { TISS_BUCKET } from './storage'

// Um diretório por versão em lib/tiss/; a próxima versão entra aqui.
export const TISS_VERSIONS: Record<string, TissVersionModule> = {
  [v4_03_00.version]: v4_03_00,
}

export type BatchResult =
  | { status: 'generated'; batchId: string; batchNumber: number; guideCount: number }
  | { status: 'error'; batchId: string | null; batchNumber: number | null; guideCount: number }
  // Outra execução pegou alguma destas guias antes — nada foi gravado.
  | { status: 'conflict'; guideCount: number }

export function chunkGuides<T extends { guide_type: GuideType }>(guides: T[], maxPerBatch: number): T[][] {
  const size = Math.max(1, Math.min(maxPerBatch, MAX_GUIDES_PER_BATCH))
  const chunks: T[][] = []
  for (const type of ['consulta', 'sp_sadt'] as const) {
    const ofType = guides.filter((g) => g.guide_type === type)
    for (let i = 0; i < ofType.length; i += size) chunks.push(ofType.slice(i, i + size))
  }
  return chunks
}

// Só a mensagem do validador (já sem valores), limitada — nunca dado de paciente.
function errorMessage(errors: string[]): string {
  return errors.slice(0, 5).join('\n').slice(0, 1000) || 'XML inválido'
}

interface CreateOptions {
  createdBy: string | null // null = cron
  storage?: Pick<TissStorage, 'upload' | 'remove'>
  now?: Date
  versions?: Record<string, TissVersionModule>
}

// Todas as guias 'ready' da operadora viram lotes de até max_guides_per_batch,
// separados por tipo de guia (um lote TISS só leva um tipo). Cada lote é
// tudo-ou-nada: XML inválido grava o lote como 'error' e nenhuma guia muda;
// XML válido sobe para o storage e finalize_tiss_batch marca as guias numa
// transação só. Nas rotas de usuário, a credencial de Storage é separada
// do client autenticado que lê e altera o banco.
export async function createBatchesForInsurer(
  supabase: BillingClient,
  insurer: Pick<InsurerRow, 'id' | 'account_id' | 'ans_registry' | 'provider_code' | 'tiss_version' | 'max_guides_per_batch'>,
  options: CreateOptions,
): Promise<BatchResult[]> {
  const versions = options.versions ?? TISS_VERSIONS
  const tiss = versions[insurer.tiss_version]
  if (!tiss) throw new Error(`versão TISS sem gerador: ${insurer.tiss_version}`)

  const { data: rows, error } = await supabase
    .from('tiss_guides')
    .select('id, provider_guide_number, guide_type, payload, total_cents, updated_at')
    .eq('insurer_id', insurer.id)
    .eq('account_id', insurer.account_id)
    .eq('status', 'ready')
    .is('batch_id', null)
    .order('service_date', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(`tiss_guides select: ${error.message}`)

  const guides = (rows ?? []).map((r) => ({
    id: r.id,
    provider_guide_number: r.provider_guide_number,
    guide_type: r.guide_type,
    payload: r.payload as GuidePayload,
    total_cents: r.total_cents,
    updated_at: r.updated_at,
  }))

  const results: BatchResult[] = []
  for (const chunk of chunkGuides(guides, insurer.max_guides_per_batch)) {
    results.push(await createOneBatch(supabase, insurer, tiss, chunk, options))
  }
  return results
}

async function createOneBatch(
  supabase: BillingClient,
  insurer: Pick<InsurerRow, 'id' | 'account_id' | 'ans_registry' | 'provider_code'>,
  tiss: TissVersionModule,
  guides: Array<BatchGuide & { total_cents: number; updated_at: string }>,
  options: CreateOptions,
): Promise<BatchResult> {
  const guideType = guides[0].guide_type
  const totalCents = guides.reduce((sum, g) => sum + g.total_cents, 0)

  const { data: batchNumber, error: numberError } = await supabase.rpc('next_tiss_number', {
    p_insurer_id: insurer.id,
    p_kind: 'batch',
  })
  if (numberError || batchNumber == null) throw new Error(`next_tiss_number: ${numberError?.message ?? 'sem retorno'}`)

  const { xml, hash } = tiss.buildBatch({
    batchNumber,
    guideType,
    insurer: { ans_registry: insurer.ans_registry, provider_code: insurer.provider_code },
    guides,
    now: options.now ?? new Date(),
  })

  const validation = await tiss.validate(xml)
  if (!validation.valid) {
    const { data: failed } = await supabase
      .from('tiss_batches')
      .insert({
        account_id: insurer.account_id,
        insurer_id: insurer.id,
        batch_number: batchNumber,
        tiss_version: tiss.version,
        guide_type: guideType,
        status: 'error',
        guide_count: guides.length,
        total_cents: totalCents,
        error_message: errorMessage(validation.errors),
        created_by: options.createdBy,
      })
      .select('id')
      .single()
    return { status: 'error', batchId: failed?.id ?? null, batchNumber, guideCount: guides.length }
  }

  const xmlPath = `${insurer.account_id}/${insurer.id}/${batchNumber}.xml`
  const storage = options.storage ?? supabase.storage.from(TISS_BUCKET)
  const { error: uploadError } = await storage
    .upload(xmlPath, xml, { contentType: 'application/xml; charset=ISO-8859-1', upsert: false })
  if (uploadError) throw new Error(`upload do lote: ${uploadError.message}`)

  const { data: batchId, error: finalizeError } = await supabase.rpc('finalize_tiss_batch', {
    p_account_id: insurer.account_id,
    p_insurer_id: insurer.id,
    p_batch_number: batchNumber,
    p_tiss_version: tiss.version,
    p_guide_type: guideType,
    p_xml_path: xmlPath,
    p_hash_md5: hash,
    p_total_cents: totalCents,
    p_created_by: options.createdBy,
    p_guide_ids: guides.map((g) => g.id),
    p_expected_updated_at: Object.fromEntries(guides.map((g) => [g.id, g.updated_at])),
  })

  if (finalizeError || !batchId) {
    await storage.remove([xmlPath])
    if (finalizeError?.message.includes('tiss_guides_changed')) {
      return { status: 'conflict', guideCount: guides.length }
    }
    throw new Error(`finalize_tiss_batch: ${finalizeError?.message ?? 'sem retorno'}`)
  }

  await trackBillingBatchGenerated(options.createdBy ?? insurer.account_id, {
    account_id: insurer.account_id,
    guide_count: guides.length,
  })

  return { status: 'generated', batchId, batchNumber, guideCount: guides.length }
}

// Erro inesperado num lote vai para o Sentry só com IDs.
export function reportBatchFailure(err: unknown, ids: { accountId: string; insurerId: string }) {
  Sentry.captureException(new Error('billing: falha ao gerar lote TISS'), {
    tags: { area: 'billing', flow: 'create_batch' },
    extra: { ...ids, cause: err instanceof Error ? err.name : 'unknown' },
  })
  console.error('[billing] falha ao gerar lote', ids)
}
