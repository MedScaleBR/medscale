'use client'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatBRL, type CategorySlice } from '@/lib/finance/summary'

interface FinanceCategoryBreakdownProps {
  slices: CategorySlice[]
  side: 'out' | 'in'
  onSideChange: (side: 'out' | 'in') => void
}

export function FinanceCategoryBreakdown({ slices, side, onSideChange }: FinanceCategoryBreakdownProps) {
  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-gray-900">
          {side === 'out' ? 'Para onde o dinheiro foi' : 'De onde o dinheiro veio'}
        </h2>
        <Tabs value={side} onValueChange={(v) => onSideChange(v as 'out' | 'in')}>
          <TabsList>
            <TabsTrigger value="out">Despesas</TabsTrigger>
            <TabsTrigger value="in">Receitas</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {slices.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">
          {side === 'out' ? 'Nenhuma despesa neste período.' : 'Nenhuma receita neste período.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {slices.map((slice) => (
            <li key={slice.name} className="flex items-center gap-3">
              <span
                className={`w-[92px] shrink-0 truncate text-[13px] sm:w-[108px] ${
                  slice.uncategorized ? 'text-amber-700' : 'text-gray-600'
                }`}
                title={slice.name}
              >
                {slice.name}
              </span>

              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--navy-06)]">
                <div
                  className={`h-full rounded-full ${
                    slice.uncategorized ? 'bg-amber-500' : side === 'in' ? 'bg-green-600' : 'bg-[var(--cyan)]'
                  }`}
                  style={{ width: `${Math.min(slice.ratio * 100, 100)}%` }}
                />
              </div>

              <span className="w-[96px] shrink-0 text-right text-[13px] font-medium text-gray-900">
                {formatBRL(slice.total)}
              </span>
              <span className="w-9 shrink-0 text-right text-xs text-gray-400">
                {Math.round(slice.share * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
