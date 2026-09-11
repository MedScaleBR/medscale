'use client'

import { AlertTriangle, X } from 'lucide-react'
import { formatBRL } from '@/lib/finance/summary'
import type { Suggestion } from '@/lib/finance/suggestions'

export function FinanceSuggestionCard({
  suggestion,
  onDismiss,
}: {
  suggestion: Suggestion
  onDismiss: () => void
}) {
  const base =
    suggestion.referenceType === 'projection'
      ? 'a projeção do mês'
      : 'a média dos últimos meses'

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-600">
          <AlertTriangle className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">{suggestion.categoryPath}</p>
          <p className="mt-1 text-sm text-gray-600">
            {formatBRL(suggestion.realizedAmount)} gastos no mês — {formatBRL(suggestion.overAmount)} acima
            de {base} ({formatBRL(suggestion.referenceAmount)}).
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {Math.round(suggestion.overPct)}% acima da referência
          </p>
        </div>

        <button
          type="button"
          aria-label="Dispensar alerta"
          title="Dispensar até o fim do mês"
          onClick={onDismiss}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-amber-600 transition-colors hover:bg-amber-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
