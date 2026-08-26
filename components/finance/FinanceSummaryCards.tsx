import { Wallet, TrendingUp } from 'lucide-react'

interface FinanceSummaryCardsProps {
  total: number
  topCategory: { name: string; value: number } | null
}

export function FinanceSummaryCards({ total, topCategory }: FinanceSummaryCardsProps) {
  const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
        <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cyan-10)]">
          <Wallet className="h-4 w-4 text-[var(--cyan)]" />
        </div>
        <p className="text-2xl font-medium tracking-tight text-gray-900">{formatBRL(total)}</p>
        <p className="mt-1 text-xs text-gray-400">Total do mês</p>
      </div>

      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
        <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cyan-10)]">
          <TrendingUp className="h-4 w-4 text-[var(--cyan)]" />
        </div>
        <p className="text-2xl font-medium tracking-tight text-gray-900">
          {topCategory ? formatBRL(topCategory.value) : '—'}
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Maior gasto{topCategory ? ` — ${topCategory.name}` : ''}
        </p>
      </div>
    </div>
  )
}
