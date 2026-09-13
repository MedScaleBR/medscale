'use client'

import { formatBRL } from '@/lib/finance/summary'
import type { InvestmentProjection } from '@/lib/finance/investments'

// Sem taxa completa não há projeção — e aí a tela diz isso, em vez de estimar
// um rendimento que o médico nunca informou.
export function FinanceInvestmentProjectionBadge({
  projection,
}: {
  projection: InvestmentProjection | null
}) {
  if (!projection) {
    return (
      <span className="text-xs text-gray-400" title="Informe tipo e valor da taxa para ver a projeção">
        dados insuficientes
      </span>
    )
  }

  const rate = projection.annualRatePct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

  return (
    <span className="flex flex-col">
      <span className="text-sm font-medium text-gray-900">
        {formatBRL(projection.estimatedCurrentValue)}
      </span>
      <span className="text-xs text-gray-400">
        ≈ {rate}% a.a.
        {projection.projectedAtMaturity != null &&
          ` · ${formatBRL(projection.projectedAtMaturity)} no vencimento`}
      </span>
    </span>
  )
}
