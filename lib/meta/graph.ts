// Cliente único das chamadas à Graph API da Meta (WhatsApp e Ads).
// Centraliza a versão, o formato de erro e a detecção de token expirado —
// sem isso cada rota reinventa o tratamento e o erro 190 passa despercebido.

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v22.0'

export function graphUrl(path: string): string {
  return `https://graph.facebook.com/${GRAPH_VERSION}${path.startsWith('/') ? path : `/${path}`}`
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly status: number
  ) {
    super(message)
    this.name = 'MetaApiError'
  }

  /** 190 = token inválido/expirado/revogado: pedir reconexão, não repetir. */
  get isTokenExpired(): boolean {
    return this.code === 190
  }
}

export async function graphFetch<T>(
  path: string,
  opts: {
    token?: string
    method?: 'GET' | 'POST' | 'DELETE'
    params?: Record<string, string>
    body?: Record<string, unknown>
  } = {}
): Promise<T> {
  const url = new URL(graphUrl(path))
  for (const [key, value] of Object.entries(opts.params ?? {})) {
    url.searchParams.set(key, value)
  }

  const headers: Record<string, string> = {}
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`

  let body: string | undefined
  if (opts.body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    const form = new URLSearchParams()
    for (const [key, value] of Object.entries(opts.body)) {
      form.set(key, typeof value === 'string' ? value : JSON.stringify(value))
    }
    body = form.toString()
  }

  const res = await fetch(url.toString(), { method: opts.method ?? 'GET', headers, body })
  const json = await res.json().catch(() => null)

  if (!res.ok) {
    const error = json?.error
    throw new MetaApiError(
      error?.message ?? `Erro ${res.status} da Meta`,
      error?.code ?? null,
      error?.error_subcode ?? null,
      res.status
    )
  }

  return json as T
}
