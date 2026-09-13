'use client'

import { ArrowDownCircle, ArrowUpCircle, Receipt } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  bareMonthLabel,
  formatBRL,
  formatPct,
  pctDelta,
  type ForecastSummary,
  type MonthPoint,
} from '@/lib/finance/summary'

const TONES = {
  green: 'bg-green-50 text-green-600',
  cyan: 'bg-[var(--cyan-10)] text-[var(--cyan)]',
  navy: 'bg-[var(--navy-06)] text-[var(--navy)]',
} as const

function StatCard({
  icon: Icon,
  tone,
  label,
  value,
  hint,
  badge,
  badgeTone = 'muted',
}: {
  icon: LucideIcon
  tone: keyof typeof TONES
  label: string
  value: string
  hint: string
  badge?: string
  badgeTone?: 'good' | 'bad' | 'muted'
}) {
  const badgeClass =
    badgeTone === 'good' ? 'text-green-600' : badgeTone === 'bad' ? 'text-red-600' : 'text-gray-600'

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${TONES[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[13px] font-medium text-gray-600">{label}</span>
        {badge && <span className={`ml-auto text-xs font-semibold ${badgeClass}`}>{badge}</span>}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-gray-900">{value}</p>
      <p className="mt-1 truncate text-xs text-gray-400" title={hint}>
        {hint}
      </p>
    </div>
  )
}

interface FinanceStatCardsProps {
  current: MonthPoint
  previous?: MonthPoint
  topCategory: { name: string; total: number } | null
  forecast: ForecastSummary
  /** Só aparece quando o ciclo de receita tem algo a confirmar no mês. */
  showForecast: boolean
}

export function FinanceStatCards({
  current,
  previous,
  topCategory,
  forecast,
  showForecast,
}: FinanceStatCardsProps) {
  const receitaDelta = previous ? pctDelta(current.receitas, previous.receitas) : null
  const despesaDelta = previous ? pctDelta(current.despesas, previous.despesas) : null
  const prevLabel = previous ? bareMonthLabel(previous.month).slice(0, 3) : null

  return (
    <div className="flex flex-col gap-4">
      <StatCard
        icon={ArrowUpCircle}
        tone="green"
        label="Receitas"
        value={formatBRL(current.receitas)}
        hint={previous ? `${prevLabel}: ${formatBRL(previous.receitas)}` : 'Sem mês anterior'}
        badge={receitaDelta !== null ? formatPct(receitaDelta) : undefined}
        // Receita subindo é bom.
        badgeTone={receitaDelta === null ? 'muted' : receitaDelta >= 0 ? 'good' : 'bad'}
      />

      <StatCard
        icon={ArrowDownCircle}
        tone="cyan"
        label="Despesas"
        value={formatBRL(current.despesas)}
        hint={topCategory ? `maior: ${topCategory.name} — ${formatBRL(topCategory.total)}` : 'Sem despesa no mês'}
        badge={despesaDelta !== null ? formatPct(despesaDelta) : undefined}
        // Despesa caindo é bom — o sinal verde/vermelho inverte em relação à receita.
        badgeTone={despesaDelta === null ? 'muted' : despesaDelta <= 0 ? 'good' : 'bad'}
      />

      {showForecast && (
        <StatCard
          icon={Receipt}
          tone="navy"
          label="Previsto no ciclo"
          value={formatBRL(forecast.aConfirmar)}
          hint={`a confirmar em ${forecast.pendingCount} consulta${forecast.pendingCount === 1 ? '' : 's'}`}
          badge={`${Math.round(forecast.ratio * 100)}%`}
        />
      )}
    </div>
  )
}
