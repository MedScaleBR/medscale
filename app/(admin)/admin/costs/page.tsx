import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CostAlertList } from '@/components/admin/CostAlertList'
import { COST_PERIODS, getCostOverview, normalizeCostDays, percentChange } from '@/lib/admin/cost-alerts'
import { getTaskedRefs } from '@/lib/admin/queue'
import { PROVIDER_GROUP_LABELS, PROVIDER_GROUP_ORDER, type ProviderGroup } from '@/lib/costs/aggregate'
import { formatBRL } from '@/lib/finance/summary'

// Painel interno: quanto a MedScale gasta de custo variável (Claude, Whisper e
// as janelas de WhatsApp que pagamos à Meta) para atender cada cliente. Não é
// o que o cliente paga — é o que ele custa. O acesso é barrado pela policy de
// RLS de cost_events (só is_medscale_admin lê) e pelo layout de /admin.

const CARD = 'rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]'

// Só tokens da casa: navy escuro, cyan e navy translúcido.
const GROUP_BAR: Record<ProviderGroup, string> = {
  claude: 'bg-[var(--navy-dark)]',
  whisper: 'bg-[var(--cyan)]',
  whatsapp: 'bg-[var(--navy)]/20',
}

const GROUP_CARD_LABEL: Record<ProviderGroup, string> = {
  ...PROVIDER_GROUP_LABELS,
  whatsapp: `${PROVIDER_GROUP_LABELS.whatsapp} (Meta)`,
}

function formatShare(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

function formatChange(change: number): string {
  const rounded = Math.round(change)
  return `${rounded > 0 ? '+' : ''}${rounded}%`
}

export default async function AdminCostsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: daysParam } = await searchParams
  const days = normalizeCostDays(daysParam)

  const supabase = await createClient()
  const [overview, taskedRefs] = await Promise.all([getCostOverview(supabase, days), getTaskedRefs(supabase)])

  const total = overview.summary.total
  const change = overview.previous ? percentChange(total, overview.previous.total) : null
  const maxAccountTotal = overview.accounts[0]?.total ?? 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Custos</h1>
          <p className="text-sm text-gray-400">
            Custo variável da MedScale por cliente — Claude, Whisper e conversas de WhatsApp
          </p>
        </div>
        <nav aria-label="Período" className={`${CARD} flex items-center gap-1 p-1`}>
          {COST_PERIODS.map((p) => (
            <Link
              key={p}
              href={`/admin/costs?days=${p}`}
              aria-current={p === days ? 'page' : undefined}
              className={`rounded-[10px] px-3 py-1.5 text-xs whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)] ${
                p === days ? 'bg-[var(--navy-dark)] text-white' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {p} dias
            </Link>
          ))}
        </nav>
      </div>

      {overview.error && <p className="text-xs text-red-500">Não foi possível carregar os custos do período.</p>}
      {overview.truncated && (
        <p className="text-xs text-gray-400">
          O período tem mais eventos do que o painel consegue somar — os valores abaixo estão subestimados.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className={`${CARD} p-5`}>
          <p className="text-xs text-gray-400">Total no período</p>
          <p className="mt-1 text-2xl font-medium tracking-tight text-gray-900">{formatBRL(total)}</p>
          {change !== null && (
            <p className="mt-1 text-xs text-gray-400">
              {formatChange(change)} vs. {days} dias anteriores
            </p>
          )}
        </div>
        {PROVIDER_GROUP_ORDER.map((group) => (
          <div key={group} className={`${CARD} p-5`}>
            <p className="text-xs text-gray-400">{GROUP_CARD_LABEL[group]}</p>
            <p className="mt-1 text-2xl font-medium tracking-tight text-gray-900">
              {formatBRL(overview.byGroup[group])}
            </p>
            {total > 0 && (
              <p className="mt-1 text-xs text-gray-400">{formatShare(overview.byGroup[group] / total)} do total</p>
            )}
          </div>
        ))}
      </div>

      <CostAlertList alerts={overview.alerts} taskedRefs={taskedRefs} />

      <section className={`${CARD} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--navy-06)] px-5 py-3">
          <h2 className="text-sm font-medium text-gray-900">Custo por cliente</h2>
          <ul className="flex items-center gap-4" aria-label="Legenda">
            {PROVIDER_GROUP_ORDER.map((group) => (
              <li key={group} className="flex items-center gap-1.5 text-xs whitespace-nowrap text-gray-500">
                <span aria-hidden className={`size-2 rounded-sm ${GROUP_BAR[group]}`} />
                {PROVIDER_GROUP_LABELS[group]}
              </li>
            ))}
          </ul>
        </div>
        {overview.accounts.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">Nenhum custo registrado no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <ul className="min-w-[640px] divide-y divide-[var(--navy-06)]">
              {overview.accounts.map((account) => (
                <li key={account.accountId} className="flex items-center gap-4 px-5 py-2.5">
                  <Link
                    href={`/admin/accounts/${account.accountId}`}
                    className="w-48 shrink-0 truncate text-sm text-gray-900 hover:text-[var(--cyan-dark)]"
                    title={account.name}
                  >
                    {account.name}
                  </Link>
                  <div
                    className="flex h-3 min-w-0 flex-1"
                    role="img"
                    aria-label={PROVIDER_GROUP_ORDER.map(
                      (g) => `${PROVIDER_GROUP_LABELS[g]}: ${formatBRL(account.byGroup[g])}`,
                    ).join(', ')}
                  >
                    {maxAccountTotal > 0 &&
                      PROVIDER_GROUP_ORDER.map((group) =>
                        account.byGroup[group] > 0 ? (
                          <span
                            key={group}
                            className={`h-full first:rounded-l-sm last:rounded-r-sm ${GROUP_BAR[group]}`}
                            style={{ width: `${(account.byGroup[group] / maxAccountTotal) * 100}%` }}
                          />
                        ) : null,
                      )}
                  </div>
                  <span className="w-28 shrink-0 text-right text-sm whitespace-nowrap text-gray-900">
                    {formatBRL(account.total)}
                  </span>
                  <span className="w-12 shrink-0 text-right text-xs whitespace-nowrap text-gray-400">
                    {formatShare(account.share)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}
