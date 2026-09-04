import { ArrowDownCircle, ArrowUpCircle, Scale } from 'lucide-react'

interface FinanceSummaryCardsProps {
  receitas: number
  despesas: number
  topCategory: { name: string; value: number } | null
}

export function FinanceSummaryCards({ receitas, despesas, topCategory }: FinanceSummaryCardsProps) {
  const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const saldo = receitas - despesas

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
        <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-green-50">
          <ArrowUpCircle className="h-4 w-4 text-green-600" />
        </div>
        <p className="text-2xl font-medium tracking-tight text-green-600">{formatBRL(receitas)}</p>
        <p className="mt-1 text-xs text-gray-400">Receitas do mês</p>
      </div>

      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
        <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cyan-10)]">
          <ArrowDownCircle className="h-4 w-4 text-[var(--cyan)]" />
        </div>
        <p className="text-2xl font-medium tracking-tight text-gray-900">{formatBRL(despesas)}</p>
        <p className="mt-1 text-xs text-gray-400">
          Despesas do mês{topCategory ? ` — maior: ${topCategory.name}` : ''}
        </p>
      </div>

      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
        <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--navy-06)]">
          <Scale className="h-4 w-4 text-[var(--navy)]" />
        </div>
        <p className={`text-2xl font-medium tracking-tight ${saldo >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {formatBRL(saldo)}
        </p>
        <p className="mt-1 text-xs text-gray-400">Saldo</p>
      </div>
    </div>
  )
}
