import { vi } from 'vitest'

// O client do Supabase é um builder encadeável cujo formato varia por chamada:
// às vezes termina em .single()/.maybeSingle(), às vezes o próprio builder é
// aguardado direto (`await supabase.from('x').insert(...)`). Este helper cobre
// os dois casos: o builder é thenable e resolve para o resultado configurado.

export interface QueryResult {
  data?: unknown
  error?: unknown
  count?: number | null
}

export interface RecordedCall {
  table: string
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete'
  /** payload de insert/update/upsert */
  payload?: unknown
  /** filtros aplicados, na ordem: ['eq', 'workspace_id', 'w1'] */
  filters: Array<[string, ...unknown[]]>
}

type Responder = QueryResult | QueryResult[] | ((call: RecordedCall) => QueryResult)

/** Respostas por tabela e operação: { patients: { select: {...}, insert: {...} } } */
export type SupabaseMockConfig = Record<string, Partial<Record<RecordedCall['op'], Responder>>>

const EMPTY: QueryResult = { data: null, error: null }

const CHAIN_METHODS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'not',
  'or', 'contains', 'overlaps', 'match', 'filter', 'order', 'limit', 'range',
  'returns', 'abortSignal', 'throwOnError', 'onConflict',
] as const

export interface SupabaseMock {
  client: {
    from: (table: string) => Record<string, unknown>
    storage: {
      from: (bucket: string) => Record<string, unknown>
    }
    rpc: ReturnType<typeof vi.fn>
    auth: { getUser: ReturnType<typeof vi.fn> }
  }
  /** Todas as queries feitas, na ordem. */
  calls: RecordedCall[]
  /** Filtra as queries por tabela (e opcionalmente operação). */
  callsTo: (table: string, op?: RecordedCall['op']) => RecordedCall[]
  rpc: ReturnType<typeof vi.fn>
  storage: {
    createSignedUrl: ReturnType<typeof vi.fn>
    createSignedUploadUrl: ReturnType<typeof vi.fn>
    upload: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
  }
}

export function createSupabaseMock(config: SupabaseMockConfig = {}): SupabaseMock {
  const calls: RecordedCall[] = []
  // Respostas de array são consumidas em ordem — permite "1ª chamada falha,
  // 2ª chamada dá certo" sem ordenar mocks manualmente.
  const cursors = new Map<string, number>()

  function resolveResult(call: RecordedCall): QueryResult {
    const responder = config[call.table]?.[call.op]
    if (responder === undefined) return EMPTY
    if (typeof responder === 'function') return responder(call)
    if (Array.isArray(responder)) {
      const key = `${call.table}:${call.op}`
      const index = cursors.get(key) ?? 0
      cursors.set(key, index + 1)
      return responder[Math.min(index, responder.length - 1)] ?? EMPTY
    }
    // Apply filters to plain object responses with array data
    if (responder && typeof responder === 'object' && 'data' in responder && Array.isArray(responder.data)) {
      let filtered = [...responder.data]
      for (const filter of call.filters) {
        const [method, column, value] = filter as [string, string, unknown]
        if (method === 'eq' && filtered.length > 0 && typeof filtered[0] === 'object' && filtered[0] !== null) {
          filtered = filtered.filter((row: any) => row[column] === value)
        }
      }
      return { ...responder, data: filtered }
    }
    return responder
  }

  function makeBuilder(table: string, op: RecordedCall['op'], payload?: unknown) {
    const call: RecordedCall = { table, op, payload, filters: [] }
    calls.push(call)

    const settle = () => {
      const result = resolveResult(call)
      return { data: null, error: null, count: null, ...result }
    }

    const builder: Record<string, unknown> = {
      // `select` depois de insert/update/upsert não muda a operação — só
      // pede o retorno das linhas afetadas.
      select: vi.fn((...args: unknown[]) => {
        call.filters.push(['select', ...args])
        return builder
      }),
      single: vi.fn(async () => settle()),
      maybeSingle: vi.fn(async () => settle()),
      then: (onFulfilled: (v: QueryResult) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(settle()).then(onFulfilled, onRejected),
    }

    for (const method of CHAIN_METHODS) {
      builder[method] = vi.fn((...args: unknown[]) => {
        call.filters.push([method, ...args])
        return builder
      })
    }

    return builder
  }

  const storage = {
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://storage.test/audio.webm' }, error: null })),
    createSignedUploadUrl: vi.fn(async () => ({
      data: { path: 'w1/a1/123.webm', token: 'upload-token', signedUrl: 'https://storage.test/upload' },
      error: null,
    })),
    upload: vi.fn(async () => ({ data: { path: 'w1/a1/123.webm' }, error: null })),
    remove: vi.fn(async () => ({ data: null, error: null })),
    download: vi.fn(async () => ({ data: null, error: null })),
  }

  const rpc = vi.fn(async () => ({ data: null, error: null }))

  return {
    client: {
      from: (table: string) => ({
        select: (...args: unknown[]) => {
          const b = makeBuilder(table, 'select')
          ;(b.select as (...a: unknown[]) => unknown)(...args)
          return b
        },
        insert: (payload: unknown) => makeBuilder(table, 'insert', payload),
        update: (payload: unknown) => makeBuilder(table, 'update', payload),
        upsert: (payload: unknown) => makeBuilder(table, 'upsert', payload),
        delete: () => makeBuilder(table, 'delete'),
      }),
      storage: { from: vi.fn(() => storage) },
      rpc,
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
    },
    calls,
    callsTo: (table, op) => calls.filter((c) => c.table === table && (op ? c.op === op : true)),
    rpc,
    storage,
  }
}

/** Valor de um filtro aplicado na query — ex: filterValue(call, 'eq', 'status'). */
export function filterValue(call: RecordedCall, method: string, column: string): unknown {
  const found = call.filters.find((f) => f[0] === method && f[1] === column)
  return found?.[2]
}
