// O PostgREST corta toda resposta em max_rows (1000 no Supabase por padrão),
// mesmo com .limit() maior — uma soma feita em cima disso sai errada sem
// aviso. fetchAllPages pede blocos com .range() até acabar ou bater no teto.
//
// `page` precisa montar a consulta do zero a cada chamada (o builder do
// supabase-js é de uso único) e ter ordenação estável — ex. created_at + id —
// senão linhas podem repetir ou sumir entre um bloco e outro.

/** Igual ao max_rows padrão do Supabase: um bloco maior viria cortado. */
export const PAGE_SIZE = 1000

export interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
}

export interface AllPages<T> {
  rows: T[]
  /** Parou em `max` com mais linhas possivelmente por vir. */
  truncated: boolean
  /** Mensagem do primeiro erro; `rows` traz o que veio antes dele. */
  error: string | null
}

export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: { max?: number; pageSize?: number } = {},
): Promise<AllPages<T>> {
  const max = options.max ?? Infinity
  const pageSize = options.pageSize ?? PAGE_SIZE
  const rows: T[] = []

  while (rows.length < max) {
    const size = Math.min(pageSize, max - rows.length)
    const from = rows.length
    const { data, error } = await page(from, from + size - 1)
    if (error) return { rows, truncated: false, error: error.message }
    const chunk = data ?? []
    rows.push(...chunk)
    // Bloco incompleto: era o último.
    if (chunk.length < size) return { rows, truncated: false, error: null }
  }

  return { rows, truncated: true, error: null }
}
