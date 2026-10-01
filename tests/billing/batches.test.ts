import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TZDate } from '@date-fns/tz'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'
import { fakeGuides, FIXED_NOW } from '../tiss/fixtures'

const g = vi.hoisted(() => ({ tracked: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/analytics/posthog-server', () => ({ trackBillingBatchGenerated: g.tracked }))

import { createBatchesForInsurer, chunkGuides, TISS_VERSIONS } from '@/lib/billing/batches'
import { isBatchDue } from '@/lib/billing/schedule'
import { parseInsurerInput, parseProcedureInput, parseProviderFields, parseProfessionalFields } from '@/lib/billing/validation'
import type { TissVersionModule } from '@/lib/billing/types'

const INSURER = {
  id: 'ins1',
  account_id: 'acc1',
  ans_registry: '999999',
  provider_code: 'PREST0001',
  tiss_version: '4.03.00',
  max_guides_per_batch: 100,
}

function guideRows(count: number, type: 'consulta' | 'sp_sadt' = 'consulta') {
  return fakeGuides(count, type).map((g) => ({ ...g, total_cents: 15050, updated_at: '2026-09-29T21:00:00.000Z' }))
}

// Numeração do lote: 1, 2, 3… como next_tiss_number faria.
function mockRpc(supabase: SupabaseMock, finalize: (args: Record<string, unknown>) => { data: unknown; error: unknown }) {
  let batchNumber = 0
  supabase.rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'next_tiss_number') return { data: ++batchNumber, error: null }
    if (fn === 'finalize_tiss_batch') return finalize(args)
    return { data: null, error: null }
  })
}

describe('createBatchesForInsurer', () => {
  let supabase: SupabaseMock

  it('envia as versões das guias para impedir lote com snapshot editado durante a geração', async () => {
    await createBatchesForInsurer(supabase.client as never, INSURER, { createdBy: 'u1', now: FIXED_NOW })
    const finalize = supabase.rpc.mock.calls.find((c) => c[0] === 'finalize_tiss_batch')![1]
    expect(finalize.p_expected_updated_at).toEqual({
      g1: '2026-09-29T21:00:00.000Z', g2: '2026-09-29T21:00:00.000Z', g3: '2026-09-29T21:00:00.000Z',
    })
  })

  it('usa a credencial separada somente para Storage ao gerar o lote', async () => {
    const serviceStorage = createSupabaseMock().storage
    await createBatchesForInsurer(supabase.client as never, INSURER, {
      createdBy: 'u1', now: FIXED_NOW, storage: serviceStorage as never,
    })
    expect(serviceStorage.upload).toHaveBeenCalledTimes(1)
    expect(supabase.storage.upload).not.toHaveBeenCalled()
    expect(supabase.rpc).toHaveBeenCalledWith('finalize_tiss_batch', expect.any(Object))
  })

  beforeEach(() => {
    supabase = createSupabaseMock({ tiss_guides: { select: { data: guideRows(3) } } })
    mockRpc(supabase, () => ({ data: 'batch-id', error: null }))
  })

  it('deve gerar um lote válido com as 3 guias prontas, subir o XML e fechar numa transação', async () => {
    const results = await createBatchesForInsurer(supabase.client as never, INSURER, { createdBy: 'u1', now: FIXED_NOW })

    expect(results).toEqual([{ status: 'generated', batchId: 'batch-id', batchNumber: 1, guideCount: 3 }])

    expect(supabase.storage.upload).toHaveBeenCalledTimes(1)
    const [path, body] = supabase.storage.upload.mock.calls[0] as unknown as [string, Buffer]
    expect(path).toBe('acc1/ins1/1.xml')
    expect((await TISS_VERSIONS['4.03.00'].validate(body)).valid).toBe(true)

    const finalize = supabase.rpc.mock.calls.find((c) => c[0] === 'finalize_tiss_batch')![1] as Record<string, unknown>
    expect(finalize).toMatchObject({
      p_account_id: 'acc1',
      p_insurer_id: 'ins1',
      p_batch_number: 1,
      p_guide_type: 'consulta',
      p_xml_path: 'acc1/ins1/1.xml',
      p_total_cents: 45150,
      p_created_by: 'u1',
      p_guide_ids: ['g1', 'g2', 'g3'],
    })
    expect(finalize.p_hash_md5).toMatch(/^[0-9a-f]{32}$/)
    expect(g.tracked).toHaveBeenCalledWith('u1', { account_id: 'acc1', guide_count: 3 })
  })

  it('deve buscar só guias prontas, sem lote, da operadora e da account', async () => {
    await createBatchesForInsurer(supabase.client as never, INSURER, { createdBy: null, now: FIXED_NOW })
    const [select] = supabase.callsTo('tiss_guides', 'select')
    expect(select.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'insurer_id', 'ins1'],
        ['eq', 'account_id', 'acc1'],
        ['eq', 'status', 'ready'],
        ['is', 'batch_id', null],
      ]),
    )
  })

  it('com max_guides_per_batch = 2 e 5 guias deve gerar 3 lotes', async () => {
    supabase = createSupabaseMock({ tiss_guides: { select: { data: guideRows(5) } } })
    mockRpc(supabase, (args) => ({ data: `batch-${args.p_batch_number}`, error: null }))

    const results = await createBatchesForInsurer(
      supabase.client as never,
      { ...INSURER, max_guides_per_batch: 2 },
      { createdBy: null, now: FIXED_NOW },
    )

    expect(results.map((r) => r.guideCount)).toEqual([2, 2, 1])
    expect(results.every((r) => r.status === 'generated')).toBe(true)
    expect(supabase.storage.upload).toHaveBeenCalledTimes(3)
  })

  it('deve separar guias de consulta e SP/SADT em lotes diferentes', async () => {
    supabase = createSupabaseMock({
      tiss_guides: { select: { data: [...guideRows(2, 'consulta'), ...guideRows(1, 'sp_sadt').map((g) => ({ ...g, id: 's1' }))] } },
    })
    mockRpc(supabase, () => ({ data: 'b', error: null }))

    const results = await createBatchesForInsurer(supabase.client as never, INSURER, { createdBy: null, now: FIXED_NOW })

    expect(results.map((r) => r.guideCount)).toEqual([2, 1])
    const types = supabase.rpc.mock.calls.filter((c) => c[0] === 'finalize_tiss_batch').map((c) => (c[1] as { p_guide_type: string }).p_guide_type)
    expect(types).toEqual(['consulta', 'sp_sadt'])
  })

  it('XML inválido deve gravar o lote como erro e não mexer em nenhuma guia', async () => {
    const broken: TissVersionModule = {
      ...TISS_VERSIONS['4.03.00'],
      validate: async () => ({ valid: false, errors: ["Element numeroCarteira: '…' is not a valid value"] }),
    }

    const results = await createBatchesForInsurer(supabase.client as never, INSURER, {
      createdBy: 'u1',
      now: FIXED_NOW,
      versions: { '4.03.00': broken },
    })

    expect(results[0]).toMatchObject({ status: 'error', guideCount: 3 })
    const [insert] = supabase.callsTo('tiss_batches', 'insert')
    expect(insert.payload).toMatchObject({ status: 'error', guide_count: 3, error_message: "Element numeroCarteira: '…' is not a valid value" })
    expect(supabase.storage.upload).not.toHaveBeenCalled()
    expect(supabase.rpc.mock.calls.some((c) => c[0] === 'finalize_tiss_batch')).toBe(false)
    expect(supabase.callsTo('tiss_guides', 'update')).toHaveLength(0)
  })

  it('se outra execução pegou as guias antes, deve apagar o XML e não duplicar o lote', async () => {
    mockRpc(supabase, () => ({ data: null, error: { message: 'tiss_guides_changed' } }))

    const results = await createBatchesForInsurer(supabase.client as never, INSURER, { createdBy: null, now: FIXED_NOW })

    expect(results).toEqual([{ status: 'conflict', guideCount: 3 }])
    expect(supabase.storage.remove).toHaveBeenCalledWith(['acc1/ins1/1.xml'])
  })

  it('sem guias prontas não deve gerar lote nem consumir número', async () => {
    supabase = createSupabaseMock({ tiss_guides: { select: { data: [] } } })
    expect(await createBatchesForInsurer(supabase.client as never, INSURER, { createdBy: null })).toEqual([])
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('deve recusar operadora numa versão TISS sem gerador', async () => {
    await expect(
      createBatchesForInsurer(supabase.client as never, { ...INSURER, tiss_version: '9.99.99' }, { createdBy: null }),
    ).rejects.toThrow('versão TISS sem gerador')
  })
})

describe('chunkGuides', () => {
  it('nunca deve passar de 100 guias por lote, mesmo configurado acima', () => {
    const chunks = chunkGuides(Array.from({ length: 250 }, () => ({ guide_type: 'consulta' as const })), 500)
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50])
  })
})

describe('isBatchDue (fuso de São Paulo)', () => {
  const insurer = { batch_weekdays: [1, 2, 3, 4, 5], batch_hour: 18, is_active: true }

  it('deve estar no horário às 18h de São Paulo (21h UTC) num dia útil', () => {
    expect(isBatchDue(insurer, new TZDate(new Date('2026-09-29T21:10:00Z'), 'America/Sao_Paulo'))).toBe(true)
    expect(isBatchDue(insurer, new TZDate(new Date('2026-09-29T18:10:00Z'), 'America/Sao_Paulo'))).toBe(false)
  })

  it('deve usar o dia da semana de São Paulo, não o de UTC', () => {
    // 05/10 02:30 UTC ainda é domingo 04/10 23:30 em SP
    const sunday = { batch_weekdays: [0], batch_hour: 23, is_active: true }
    expect(isBatchDue(sunday, new TZDate(new Date('2026-10-05T02:30:00Z'), 'America/Sao_Paulo'))).toBe(true)
    expect(isBatchDue(insurer, new TZDate(new Date('2026-10-05T02:30:00Z'), 'America/Sao_Paulo'))).toBe(false)
  })

  it('operadora inativa nunca está no horário', () => {
    expect(isBatchDue({ ...insurer, is_active: false }, new TZDate(new Date('2026-09-29T21:10:00Z'), 'America/Sao_Paulo'))).toBe(false)
  })
})

describe('validação de entrada', () => {
  const base = { name: 'Operadora Fictícia', ans_registry: '123456', provider_code: 'P1' }

  it('deve recusar registro ANS com 5 dígitos', () => {
    const r = parseInsurerInput({ ...base, ans_registry: '12345' }, false)
    expect(r).toEqual({ ok: false, error: 'Registro ANS deve ter exatamente 6 dígitos.' })
  })

  it('deve recusar mais de 100 guias por lote e dias fora de 0–6', () => {
    expect(parseInsurerInput({ ...base, max_guides_per_batch: 101 }, false).ok).toBe(false)
    expect(parseInsurerInput({ ...base, batch_weekdays: [7] }, false).ok).toBe(false)
    expect(parseInsurerInput({ ...base, tiss_version: '3.05.00' }, false).ok).toBe(false)
  })

  it('PATCH parcial só valida o que veio', () => {
    expect(parseInsurerInput({ batch_hour: 7 }, true)).toEqual({ ok: true, value: { batch_hour: 7 } })
  })

  it('valor do procedimento só em centavos inteiros', () => {
    expect(parseProcedureInput({ tuss_code: '10101012', description: 'x', price_cents: 150.5, guide_type: 'consulta' }, false).ok).toBe(false)
    expect(parseProcedureInput({ tuss_code: '10101012345', description: 'x', price_cents: 100, guide_type: 'consulta' }, false).ok).toBe(false)
  })

  it('deve aceitar CNPJ/CNES com máscara e recusar tamanhos errados', () => {
    expect(parseProviderFields({ cnpj: '11.222.333/0001-81', cnes: '123.456-7' })).toEqual({
      ok: true,
      value: { cnpj: '11222333000181', cnes: '1234567' },
    })
    expect(parseProviderFields({ cnes: '123456' }).ok).toBe(false)
    expect(parseProfessionalFields({ crm_uf: 'sp', cbo_code: '225125' })).toEqual({
      ok: true,
      value: { crm_uf: 'SP', cbo_code: '225125' },
    })
    expect(parseProfessionalFields({ crm_uf: 'XX' }).ok).toBe(false)
  })
})
