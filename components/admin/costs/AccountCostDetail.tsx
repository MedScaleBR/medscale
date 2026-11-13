import { formatBRL } from '@/lib/finance/summary'
import { PROVIDER_GROUP_LABELS, PROVIDER_GROUP_ORDER, type ProviderGroup } from '@/lib/costs/aggregate'
import {
  COST_FEATURE_GROUP,
  COST_FEATURE_LABELS,
  type AccountCostDetail,
  type FeatureUsage,
} from '@/lib/costs/account-detail'
import { CostSeriesChart } from '@/components/admin/costs/CostSeriesChart'

const CARD = 'rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]'

const GROUP_DOT: Record<ProviderGroup, string> = {
  claude: 'bg-[var(--navy-dark)]',
  whisper: 'bg-[var(--cyan)]',
  whatsapp: 'bg-[var(--navy)]/20',
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`
}

function minutes(m: number): string {
  return `${m.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min`
}

export function featureUsageText(u: FeatureUsage): string {
  switch (u.feature) {
    case 'clara':
      return `${plural(u.conversations, 'conversa', 'conversas')} · ${plural(u.events, 'resposta', 'respostas')}`
    case 'clara_audio':
      return `${plural(u.events, 'áudio', 'áudios')} · ${minutes(u.minutes)}`
    case 'consulta':
      return `${plural(u.events, 'consulta', 'consultas')} · ${minutes(u.minutes)}`
    case 'soap':
      return plural(u.events, 'prontuário', 'prontuários')
    case 'simulador':
      return plural(u.events, 'resposta', 'respostas')
    case 'financeiro':
      return plural(u.events, 'chamada', 'chamadas')
    case 'whatsapp':
      return plural(u.events, 'janela de 24h', 'janelas de 24h')
  }
}

function money(v: number | null): string {
  return v === null ? '—' : formatBRL(v)
}

function share(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

function FeatureTable({ features, showShare }: { features: FeatureUsage[]; showShare: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-400">
          <th className="py-2 font-normal">Funcionalidade</th>
          <th className="py-2 font-normal">Uso</th>
          <th className="py-2 text-right font-normal">Custo</th>
          {showShare && <th className="w-14 py-2 text-right font-normal">%</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--navy-06)]">
        {features.map((f) => (
          <tr key={f.feature}>
            <td className="py-2 text-gray-900">
              <span className="flex items-center gap-2">
                <span aria-hidden className={`size-2 shrink-0 rounded-sm ${GROUP_DOT[COST_FEATURE_GROUP[f.feature]]}`} />
                {COST_FEATURE_LABELS[f.feature]}
              </span>
            </td>
            <td className="py-2 text-gray-500">{featureUsageText(f)}</td>
            <td className="py-2 text-right whitespace-nowrap text-gray-900 tabular-nums">{formatBRL(f.cost)}</td>
            {showShare && (
              <td className="py-2 text-right text-xs whitespace-nowrap text-gray-400 tabular-nums">{share(f.share)}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function AccountCostDetailView({
  name,
  detail,
  truncated,
  error,
}: {
  name: string
  detail: AccountCostDetail | null
  truncated: boolean
  error: string | null
}) {
  if (error) return <p className="text-xs text-red-500">Não foi possível carregar os custos de {name}.</p>
  if (!detail || detail.total === 0) {
    return (
      <div className={`${CARD} py-12 text-center text-sm text-gray-400`}>Nenhum custo deste cliente no período.</div>
    )
  }

  const kpis = [
    { label: 'Total no período', value: formatBRL(detail.total) },
    {
      label: 'Por conversa',
      value: money(detail.perConversation),
      hint: detail.conversations ? plural(detail.conversations, 'conversa', 'conversas') : undefined,
    },
    {
      label: 'Por mensagem da Clara',
      value: money(detail.perClaraResponse),
      hint: detail.claraResponses ? plural(detail.claraResponses, 'resposta', 'respostas') : undefined,
    },
    { label: 'Média por dia', value: money(detail.perDay) },
  ]

  return (
    <div className="space-y-6">
      {truncated && (
        <p className="text-xs text-gray-400">
          O período tem mais eventos do que o painel consegue somar — os valores abaixo estão subestimados.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className={`${CARD} p-5`}>
            <p className="text-xs text-gray-400">{k.label}</p>
            <p className="mt-1 text-2xl font-medium tracking-tight text-gray-900">{k.value}</p>
            {k.hint && <p className="mt-1 text-xs text-gray-400">{k.hint}</p>}
          </div>
        ))}
      </div>

      <section className={`${CARD} px-5 py-3`}>
        <h2 className="pb-1 text-sm font-medium text-gray-900">Por funcionalidade</h2>
        <FeatureTable features={detail.features} showShare />
      </section>

      <section className={`${CARD} p-5`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-gray-900">{detail.series.mode === 'hour' ? 'Por hora' : 'Por dia'}</h2>
          <ul className="flex items-center gap-4" aria-label="Legenda">
            {PROVIDER_GROUP_ORDER.map((g) => (
              <li key={g} className="flex items-center gap-1.5 text-xs whitespace-nowrap text-gray-500">
                <span aria-hidden className={`size-2 rounded-sm ${GROUP_DOT[g]}`} />
                {PROVIDER_GROUP_LABELS[g]}
              </li>
            ))}
          </ul>
        </div>
        <CostSeriesChart mode={detail.series.mode} points={detail.series.points} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-gray-900">Por unidade</h2>
        {detail.units.map((u) => (
          <div key={u.workspaceId ?? 'none'} className={`${CARD} px-5 py-3`}>
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900">{u.name}</p>
                {u.workspaceId === null && (
                  <p className="text-xs text-gray-400">Clara antes de o paciente escolher a unidade</p>
                )}
              </div>
              <p className="text-sm whitespace-nowrap text-gray-900 tabular-nums">
                {formatBRL(u.total)}{' '}
                <span className="text-xs text-gray-400">{share(u.total / detail.total)}</span>
              </p>
            </div>
            <FeatureTable features={u.features} showShare={false} />
          </div>
        ))}
      </section>
    </div>
  )
}
