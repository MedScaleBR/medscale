'use client'

import { Pencil, Trash2 } from 'lucide-react'
import { FinanceInvestmentProjectionBadge } from './FinanceInvestmentProjectionBadge'
import { formatBRL } from '@/lib/finance/summary'
import type { InvestmentProjection } from '@/lib/finance/investments'
import type { FinanceInvestment, InvestmentKind } from '@/lib/finance/types'

const TYPE_LABELS: Record<InvestmentKind, string> = {
  renda_fixa: 'Renda fixa',
  renda_variavel: 'Renda variável',
  cripto: 'Cripto',
  outro: 'Outro',
}

export interface InvestmentRow {
  investment: FinanceInvestment
  projection: InvestmentProjection | null
}

export function FinanceInvestmentTable({
  rows,
  onEdit,
  onDelete,
}: {
  rows: InvestmentRow[]
  onEdit: (investment: FinanceInvestment) => void
  onDelete: (investment: FinanceInvestment) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--navy-06)] bg-white p-8 text-center">
        <p className="text-sm text-gray-500">Nenhum investimento cadastrado.</p>
        <p className="mt-1 text-xs text-gray-400">
          Pelo WhatsApp também dá: &quot;investi 1000 no CDB do banco X, 110% do CDI&quot;.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--navy-06)] text-left text-xs text-gray-400">
            <th className="px-4 py-2 font-medium">Investimento</th>
            <th className="px-4 py-2 font-medium">Tipo</th>
            <th className="px-4 py-2 text-right font-medium">Investido</th>
            <th className="px-4 py-2 font-medium">Valor estimado hoje</th>
            <th className="w-20 px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ investment, projection }) => (
            <tr key={investment.id} className="border-b border-[var(--navy-06)] last:border-0">
              <td className="px-4 py-3">
                <span className="font-medium text-gray-900">{investment.name}</span>
                {investment.maturity_date && (
                  <span className="ml-2 text-xs text-gray-400">
                    vence {new Date(`${investment.maturity_date}T12:00:00`).toLocaleDateString('pt-BR')}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-gray-600">{TYPE_LABELS[investment.type]}</td>
              <td className="px-4 py-3 text-right text-gray-900">{formatBRL(investment.invested_amount)}</td>
              <td className="px-4 py-3">
                {investment.current_value != null ? (
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-gray-900">
                      {formatBRL(investment.current_value)}
                    </span>
                    <span className="text-xs text-gray-400">valor informado por você</span>
                  </span>
                ) : (
                  <FinanceInvestmentProjectionBadge projection={projection} />
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    aria-label="Editar"
                    onClick={() => onEdit(investment)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-[var(--navy-06)] hover:text-gray-600"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Excluir"
                    onClick={() => onDelete(investment)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
