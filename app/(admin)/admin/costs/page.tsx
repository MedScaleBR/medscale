import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CostAlertList } from '@/components/admin/CostAlertList'
import { ClaraCacheTrendSection } from '@/components/admin/ClaraCacheTrendSection'
import { getClaraCacheTrend } from '@/lib/admin/clara-cache-trend'
import { getCostOverview, percentChange, type CostOverviewAccount } from '@/lib/admin/cost-alerts'
import { costWindowQuery, parseCostWindow } from '@/lib/admin/cost-range'
import { getAccountCostDetail, pickAccountId } from '@/lib/admin/account-cost-detail'
import { CostPeriodPicker } from '@/components/admin/costs/CostPeriodPicker'
import { CostsTabs } from '@/components/admin/costs/CostsTabs'
import { AccountStrip } from '@/components/admin/costs/AccountStrip'
import { AccountCostDetailView } from '@/components/admin/costs/AccountCostDetail'
import { getTaskedRefs } from '@/lib/admin/queue'
import {
  PROVIDER_GROUP_LABELS,
  PROVIDER_GROUP_ORDER,
  PROVIDER_LABELS,
  PROVIDER_ORDER,
  WHISPER_SOURCE_LABELS,
  WHISPER_SOURCE_ORDER,
  type ProviderGroup,
  type WhisperSource,
} from '@/lib/costs/aggregate'
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

// Tooltip da barra: a quebra fina por agente/provedor que a barra de 3 grupos esconde.
function providerBreakdown(account: CostOverviewAccount): string[] {
  return PROVIDER_ORDER.filter((p) => account.byProvider[p] > 0).flatMap((p) =>
    p === 'whisper'
      ? whisperSplit(account.whisperBySource).map((s) => `Whisper ${s.label}: ${formatBRL(s.value)}`)
      : [`${PROVIDER_LABELS[p]}: ${formatBRL(account.byProvider[p])}`],
  )
}

// Whisper dividido entre consulta gravada e áudio do paciente na Clara.
function whisperSplit(bySource: Record<WhisperSource, number>): { label: string; value: number }[] {
  return WHISPER_SOURCE_ORDER.filter((s) => bySource[s] > 0).map((s) => ({
    label: WHISPER_SOURCE_LABELS[s],
    value: bySource[s],
  }))
}

function formatChange(change: number): string {
  const rounded = Math.round(change)
  return `${rounded > 0 ? '+' : ''}${rounded}%`
}

type SearchParams = {
  days?: string
  from?: string
  to?: string
  tab?: string
  account?: string | string[]
}

function costsHref(query: Record<string, string>): string {
  return `/admin/costs?${new URLSearchParams(query).toString()}`
}

export default async function AdminCostsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const now = new Date()
  const window = parseCostWindow(params, now)
  const periodQuery = costWindowQuery(window)
  const tab = params.tab === 'cliente' ? 'cliente' : 'geral'
  const today = now.toLocaleDateString('en-CA', {
    timeZone: 'America/Sao_Paulo',
  })
  const days = window.kind === 'days' ? window.days : null

  const supabase = await createClient()
  // A visão geral sempre carrega: a aba Por cliente usa os totais dela para a
  // faixa de clientes. Alertas e cache da Clara só na aba Geral.
  const overview = await getCostOverview(supabase, window, now)
  const selectedId = tab === 'cliente' ? pickAccountId(params.account, overview.accounts) : null

  const [taskedRefs, claraTrend, clientDetail, selectedName] = await Promise.all([
    tab === 'geral' ? getTaskedRefs(supabase) : null,
    tab === 'geral' ? getClaraCacheTrend(supabase, window, now) : null,
    selectedId ? getAccountCostDetail(supabase, selectedId, window, now) : null,
    selectedId
      ? (overview.accounts.find((a) => a.accountId === selectedId)?.name ??
        supabase
          .from('accounts')
          .select('name')
          .eq('id', selectedId)
          .maybeSingle()
          .then(({ data }) => data?.name ?? 'Cliente'))
      : null,
  ])

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
        <CostPeriodPicker
          window={window}
          basePath="/admin/costs"
          extraQuery={
            tab === 'cliente'
              ? {
                  tab: 'cliente',
                  ...(selectedId ? { account: selectedId } : {}),
                }
              : {}
          }
          today={today}
        />
      </div>

      <CostsTabs active={tab} periodQuery={periodQuery} />

      {/* Vale para as duas abas: a faixa de clientes da aba Por cliente sai desta mesma consulta. */}
      {overview.error && <p className="text-xs text-red-500">Não foi possível carregar os custos do período.</p>}
      {overview.truncated && (
        <p className="text-xs text-gray-400">
          O período tem mais eventos do que o painel consegue somar — os valores abaixo estão subestimados.
        </p>
      )}

      {tab === 'cliente' ? (
        overview.accounts.length === 0 && !selectedId ? (
          <p className={`${CARD} py-12 text-center text-sm text-gray-400`}>Nenhum custo registrado no período.</p>
        ) : (
          <div className="space-y-6">
            <AccountStrip
              accounts={overview.accounts}
              selectedId={selectedId}
              hrefFor={(id) => costsHref({ tab: 'cliente', account: id, ...periodQuery })}
            />
            {clientDetail && (
              <AccountCostDetailView
                name={selectedName ?? 'Cliente'}
                detail={clientDetail.detail}
                truncated={clientDetail.truncated}
                error={clientDetail.error}
              />
            )}
          </div>
        )
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className={`${CARD} p-5`}>
              <p className="text-xs text-gray-400">Total no período</p>
              <p className="mt-1 text-2xl font-medium tracking-tight text-gray-900">{formatBRL(total)}</p>
              {change !== null && (
                <p className="mt-1 text-xs text-gray-400">
                  {formatChange(change)} vs. {days ? `${days} dias anteriores` : 'período anterior'}
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
                {group === 'whisper' && overview.byGroup.whisper > 0 && (
                  <p className="mt-0.5 text-xs text-gray-400">
                    {whisperSplit(overview.summary.whisperBySource)
                      .map((s) => `${s.label} ${formatBRL(s.value)}`)
                      .join(' · ')}
                  </p>
                )}
              </div>
            ))}
          </div>

          <CostAlertList alerts={overview.alerts} taskedRefs={taskedRefs ?? new Set()} />

          {claraTrend && <ClaraCacheTrendSection trend={claraTrend} />}

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
                    <li key={account.accountId} className="px-5 py-2.5">
                      <div className="flex items-center gap-4">
                        <Link
                          href={costsHref({
                            tab: 'cliente',
                            account: account.accountId,
                            ...periodQuery,
                          })}
                          className="w-48 shrink-0 truncate rounded text-sm text-gray-900 outline-none hover:text-[var(--cyan-dark)] focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
                          title={account.name}
                        >
                          {account.name}
                        </Link>
                        <div
                          className="flex h-3 min-w-0 flex-1"
                          role="img"
                          title={providerBreakdown(account).join('\n')}
                          aria-label={providerBreakdown(account).join(', ')}
                        >
                          {maxAccountTotal > 0 &&
                            PROVIDER_GROUP_ORDER.map((group) =>
                              account.byGroup[group] > 0 ? (
                                <span
                                  key={group}
                                  className={`h-full first:rounded-l-sm last:rounded-r-sm ${GROUP_BAR[group]}`}
                                  style={{
                                    width: `${(account.byGroup[group] / maxAccountTotal) * 100}%`,
                                  }}
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
                      </div>
                      <ul
                        aria-label={`Custo de ${account.name} por serviço`}
                        className="mt-1 flex flex-wrap gap-x-4 pl-52 text-xs text-gray-500"
                      >
                        {PROVIDER_GROUP_ORDER.filter((group) => account.byGroup[group] > 0).map((group) => (
                          <li key={group} className="flex items-center gap-1.5 whitespace-nowrap">
                            <span aria-hidden className={`size-2 rounded-sm ${GROUP_BAR[group]}`} />
                            {PROVIDER_GROUP_LABELS[group]} · {formatBRL(account.byGroup[group])}
                            {group === 'whisper' && (
                              <span className="text-gray-400">
                                (
                                {whisperSplit(account.whisperBySource)
                                  .map((s) => `${s.label} ${formatBRL(s.value)}`)
                                  .join(' · ')}
                                )
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {account.units.length > 1 && (
                        <ul
                          aria-label={`Unidades de ${account.name}`}
                          className="mt-1 flex flex-wrap gap-x-4 pl-52 text-xs text-gray-400"
                        >
                          {account.units.map((unit) => (
                            <li key={unit.workspaceId ?? 'none'} className="whitespace-nowrap">
                              {unit.name} · {formatBRL(unit.total)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
