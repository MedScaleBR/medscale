'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { monthKey, monthLabel, shiftMonth } from '@/lib/finance/summary'

interface FinanceMonthPickerProps {
  month: string // 'YYYY-MM'
  onChange: (month: string) => void
}

export function FinanceMonthPicker({ month, onChange }: FinanceMonthPickerProps) {
  const isCurrentMonth = month >= monthKey(new Date())

  return (
    <div className="flex h-8 items-center gap-0.5 rounded-lg border border-[var(--navy-06)] bg-white px-0.5">
      <button
        type="button"
        aria-label="Mês anterior"
        onClick={() => onChange(shiftMonth(month, -1))}
        className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-[var(--navy-06)]"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[132px] text-center text-sm font-medium text-gray-900">{monthLabel(month)}</span>
      <button
        type="button"
        aria-label="Próximo mês"
        disabled={isCurrentMonth}
        onClick={() => onChange(shiftMonth(month, 1))}
        className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-[var(--navy-06)] disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}
