'use client'

import {
  averageSaldo,
  bareMonthLabel,
  formatBRL,
  formatPct,
  pctDelta,
  type MonthPoint,
} from '@/lib/finance/summary'

// Altura útil das barras dentro da caixa de 176px — sobra folga no topo para a
// coluna mais alta não encostar na borda do card.
const TRACK_H = 176
const MAX_BAR_H = 150

interface FinanceBalanceCardProps {
  series: MonthPoint[]
  month: string
}

export function FinanceBalanceCard({ series, month }: FinanceBalanceCardProps) {
  const current = series[series.length - 1]
  const previous = series[series.length - 2]
  const delta = previous ? pctDelta(current?.saldo ?? 0, previous.saldo) : null
  const media = averageSaldo(series)

  // Escala compartilhada pelas duas barras para receita e despesa ficarem
  // comparáveis entre si e ao longo dos meses.
  const peak = Math.max(...series.map((p) => Math.max(p.receitas, p.despesas)), 0)
  const heightOf = (value: number) => (peak > 0 ? Math.max((value / peak) * MAX_BAR_H, value > 0 ? 2 : 0) : 0)

  const saldo = current?.saldo ?? 0

  return (
    <div className="flex flex-col rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-gray-600">Saldo de {bareMonthLabel(month)}</p>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-3">
            <p
              className={`whitespace-nowrap text-[40px] font-semibold leading-none tracking-[-0.03em] ${
                saldo < 0 ? 'text-red-600' : 'text-[var(--navy-dark)]'
              }`}
            >
              {formatBRL(saldo)}
            </p>
            {delta !== null && (
              <span
                className={`inline-flex items-center rounded-full px-[9px] py-[3px] text-[13px] font-semibold ${
                  delta >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                }`}
              >
                {formatPct(delta)}
              </span>
            )}
          </div>
          <p className="mt-2 text-[13px] text-gray-600">
            {previous ? `vs. ${formatBRL(previous.saldo)} em ${bareMonthLabel(previous.month)}` : 'Sem mês anterior para comparar'}
            {' · '}
            média de {series.length} meses {formatBRL(media)}
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[9px] w-[9px] rounded-[2px] bg-green-600" />
            Receitas
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[9px] w-[9px] rounded-[2px] bg-[var(--cyan)]" />
            Despesas
          </span>
        </div>
      </div>

      <div
        className="mt-4 flex items-end gap-2.5 border-b border-[var(--navy-06)]"
        style={{ height: TRACK_H }}
        role="img"
        aria-label={`Receitas e despesas dos últimos ${series.length} meses`}
      >
        {series.map((point) => {
          const isCurrent = point.month === month
          return (
            <div key={point.month} className="flex flex-1 items-end justify-center gap-[3px]">
              <div
                className={`w-[13px] rounded-t-[6px] ${isCurrent ? 'bg-green-600' : 'bg-green-200'}`}
                style={{ height: heightOf(point.receitas) }}
                title={`${point.label}: receitas ${formatBRL(point.receitas)}`}
              />
              <div
                className={`w-[13px] rounded-t-[6px] ${isCurrent ? 'bg-[var(--cyan)]' : 'bg-[var(--cyan-30)]'}`}
                style={{ height: heightOf(point.despesas) }}
                title={`${point.label}: despesas ${formatBRL(point.despesas)}`}
              />
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex gap-2.5 text-[11px] text-gray-400">
        {series.map((point) => (
          <span
            key={point.month}
            className={`flex-1 text-center ${
              point.month === month ? 'font-semibold text-[var(--navy-dark)]' : ''
            }`}
          >
            {point.label}
          </span>
        ))}
      </div>
    </div>
  )
}
