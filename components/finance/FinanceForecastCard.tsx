'use client'

import { formatBRL, type ForecastSummary } from '@/lib/finance/summary'

function Line({ label, value, width, tone }: { label: string; value: number; width: number; tone: 'solid' | 'faded' }) {
  return (
    <div>
      <div className="flex justify-between text-[13px] text-gray-600">
        <span>{label}</span>
        <span className="font-medium text-gray-900">{formatBRL(value)}</span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[var(--navy-06)]">
        <div
          className={`h-full rounded-full ${tone === 'solid' ? 'bg-green-600' : 'bg-green-600/35'}`}
          style={{ width: `${Math.min(Math.max(width, 0), 100)}%` }}
        />
      </div>
    </div>
  )
}

export function FinanceForecastCard({ forecast }: { forecast: ForecastSummary }) {
  const total = forecast.confirmado + forecast.aConfirmar
  const confirmadoPct = total > 0 ? (forecast.confirmado / total) * 100 : 0

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <h2 className="text-sm font-medium text-gray-900">Realizado vs. previsto</h2>
      <p className="mt-0.5 text-xs text-gray-400">Receitas espelhadas do Ciclo de receita</p>

      <div className="mt-4 flex flex-col gap-3">
        <Line label="Confirmado" value={forecast.confirmado} width={confirmadoPct} tone="solid" />
        <Line label="A confirmar" value={forecast.aConfirmar} width={100 - confirmadoPct} tone="faded" />
        <div className="flex justify-between border-t border-[var(--navy-06)] pt-3 text-[13px] text-gray-600">
          <span>Lançado manualmente</span>
          <span className="font-medium text-gray-900">{formatBRL(forecast.manual)}</span>
        </div>
      </div>
    </div>
  )
}
