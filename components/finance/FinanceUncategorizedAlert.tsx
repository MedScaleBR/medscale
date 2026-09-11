'use client'

import { AlertTriangle } from 'lucide-react'
import { formatBRL } from '@/lib/finance/summary'

interface FinanceUncategorizedAlertProps {
  count: number
  total: number
  /** Leva o owner até a lista já filtrada nos lançamentos sem categoria. */
  onReview: () => void
}

export function FinanceUncategorizedAlert({ count, total, onReview }: FinanceUncategorizedAlertProps) {
  return (
    <button
      type="button"
      onClick={onReview}
      className="flex w-full items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left transition-colors hover:bg-amber-100"
    >
      <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-amber-700" />
      <div>
        <p className="text-[13px] font-medium text-amber-700">
          {count} lançamento{count === 1 ? '' : 's'} sem categoria
        </p>
        <p className="mt-1 text-xs leading-relaxed text-amber-700">
          {formatBRL(total)} fora do gráfico. Revisar na lista abaixo.
        </p>
      </div>
    </button>
  )
}
