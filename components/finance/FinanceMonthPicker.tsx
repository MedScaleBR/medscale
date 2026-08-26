'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface FinanceMonthPickerProps {
  month: string // 'YYYY-MM'
  onChange: (month: string) => void
}

function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number)
  const date = new Date(year, m - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatLabel(month: string): string {
  const [year, m] = month.split('-').map(Number)
  const label = new Date(year, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function FinanceMonthPicker({ month, onChange }: FinanceMonthPickerProps) {
  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const isCurrentMonth = month >= currentMonth

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-gray-500"
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[140px] text-center text-sm font-medium text-gray-900">{formatLabel(month)}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-gray-500"
        disabled={isCurrentMonth}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
