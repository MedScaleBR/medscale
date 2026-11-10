import type { ClaraCacheTrend, ClaraCostWindow } from '@/lib/admin/clara-cache-trend'
import { formatBRL } from '@/lib/finance/summary'

// Seção do /admin/costs: quanto a Clara custa por resposta antes e depois do
// cache de prompt. Server component — o tooltip de cada barra é o title nativo.

const CARD = 'rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]'
const BAR_BEFORE = 'bg-[var(--navy)]/20'
const BAR_AFTER = 'bg-[var(--navy-dark)]'

function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

function formatChange(change: number): string {
  const rounded = Math.round(change)
  return `${rounded > 0 ? '+' : ''}${rounded}%`
}

function formatDay(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  const weekday = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
  return `${weekday} ${date.slice(8, 10)}/${date.slice(5, 7)}`
}

function formatStart(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

function Comparison({
  label,
  before,
  after,
  note,
}: {
  label: string
  before: string | null
  after: string | null
  note?: string | null
}) {
  return (
    <div className="rounded-lg bg-[var(--navy-06)]/40 p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-1 flex items-baseline gap-2 text-gray-900">
        {before !== null && after !== null && (
          <>
            <span className="text-sm text-gray-400 line-through decoration-gray-300">
              <span className="sr-only">antes </span>
              {before}
            </span>
            <span aria-hidden className="text-xs text-gray-300">
              →
            </span>
            <span className="sr-only">depois </span>
          </>
        )}
        <span className="text-xl font-medium tracking-tight">{after ?? before ?? '—'}</span>
      </p>
      {note && <p className="mt-1 text-xs text-gray-400">{note}</p>}
    </div>
  )
}

function perConversation(w: ClaraCostWindow | null): string | null {
  return w?.perConversation != null ? formatBRL(w.perConversation) : null
}

export function ClaraCacheTrendSection({ trend }: { trend: ClaraCacheTrend }) {
  const { before, after, days } = trend
  const maxPerResponse = Math.max(0, ...days.map((d) => d.perResponse))
  const newestFirst = [...days].reverse()

  return (
    <section className={`${CARD} overflow-hidden`} aria-labelledby="clara-cache-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--navy-06)] px-5 py-3">
        <div>
          <h2 id="clara-cache-title" className="text-sm font-medium text-gray-900">
            Clara: custo por resposta e cache de prompt
          </h2>
          <p className="text-xs text-gray-400">
            Só as respostas em produção (sem o simulador).
            {trend.cacheStartedAt && ` Cache ativo desde ${formatStart(trend.cacheStartedAt)}.`}
          </p>
        </div>
        <ul className="flex items-center gap-4" aria-label="Legenda">
          <li className="flex items-center gap-1.5 text-xs whitespace-nowrap text-gray-500">
            <span aria-hidden className={`size-2 rounded-sm ${BAR_BEFORE}`} />
            Sem cache
          </li>
          <li className="flex items-center gap-1.5 text-xs whitespace-nowrap text-gray-500">
            <span aria-hidden className={`size-2 rounded-sm ${BAR_AFTER}`} />
            Com cache
          </li>
        </ul>
      </div>

      {trend.error && <p className="px-5 pt-3 text-xs text-red-500">Não foi possível carregar o custo da Clara.</p>}
      {trend.truncated && (
        <p className="px-5 pt-3 text-xs text-gray-400">
          O período tem mais respostas do que o painel consegue somar — os valores abaixo estão incompletos.
        </p>
      )}

      {days.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">Nenhuma resposta da Clara no período.</p>
      ) : (
        <>
          <div className="grid gap-3 p-5 sm:grid-cols-3">
            <Comparison
              label="Custo por resposta"
              before={before ? formatBRL(before.perResponse) : null}
              after={after ? formatBRL(after.perResponse) : null}
              note={trend.perResponseChange !== null ? `${formatChange(trend.perResponseChange)} com o cache` : null}
            />
            <Comparison
              label="Custo por conversa"
              before={perConversation(before)}
              after={perConversation(after)}
              note={
                after && before
                  ? `${before.conversations} conversas antes · ${after.conversations} depois`
                  : null
              }
            />
            <Comparison
              label="Entrada lida do cache"
              before={null}
              after={after ? formatPercent(after.cachedShare) : null}
              note={after ? 'dos tokens de entrada desde que o cache ligou' : null}
            />
          </div>

          {!trend.cacheStartedAt && (
            <p className="px-5 pb-3 text-xs text-gray-500">
              Nenhuma resposta usou cache neste período. Se o deploy já foi feito, confira se a Clara está respondendo.
            </p>
          )}
          {trend.cacheStartedAt && !before && (
            <p className="px-5 pb-3 text-xs text-gray-500">
              O cache já estava ativo no começo do período — escolha um período maior para comparar com antes.
            </p>
          )}

          <div className="overflow-x-auto border-t border-[var(--navy-06)]">
            <ul className="min-w-[520px] divide-y divide-[var(--navy-06)]" aria-label="Custo por resposta por dia">
              {newestFirst.map((day) => {
                const label = `${formatDay(day.date)}: ${formatBRL(day.perResponse)} por resposta, ${day.responses} respostas em ${day.conversations} conversas, ${day.withCache ? 'com' : 'sem'} cache`
                return (
                  <li key={day.date} className="flex items-center gap-4 px-5 py-2" title={label}>
                    <span className="w-20 shrink-0 text-xs whitespace-nowrap text-gray-500">{formatDay(day.date)}</span>
                    <div className="flex h-3 min-w-0 flex-1" role="img" aria-label={label}>
                      {maxPerResponse > 0 && (
                        <span
                          className={`h-full rounded-sm ${day.withCache ? BAR_AFTER : BAR_BEFORE}`}
                          style={{ width: `${(day.perResponse / maxPerResponse) * 100}%` }}
                        />
                      )}
                    </div>
                    <span className="w-20 shrink-0 text-right text-sm whitespace-nowrap text-gray-900">
                      {formatBRL(day.perResponse)}
                    </span>
                    <span className="w-24 shrink-0 text-right text-xs whitespace-nowrap text-gray-400">
                      {day.responses} {day.responses === 1 ? 'resposta' : 'respostas'}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}
    </section>
  )
}
