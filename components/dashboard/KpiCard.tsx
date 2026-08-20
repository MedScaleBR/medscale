import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'

interface KpiCardProps {
  label: string
  value: string | number
  delta?: string
  deltaUp?: boolean
  icon: LucideIcon
  barWidth?: number // 0-100, largura da barra de acento no rodapé
  barColor?: 'cyan' | 'green' | 'red'
}

export function KpiCard({ label, value, delta, deltaUp, icon: Icon, barWidth = 0, barColor = 'cyan' }: KpiCardProps) {
  const barColors = {
    cyan: 'bg-[var(--cyan)]',
    green: 'bg-green-500',
    red: 'bg-red-500',
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
      <div
        className={cn('absolute bottom-0 left-0 h-[3px] rounded-tr-sm transition-all', barColors[barColor])}
        style={{ width: `${barWidth}%` }}
      />
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cyan-10)]">
        <Icon className="h-4 w-4 text-[var(--cyan)]" />
      </div>
      <p className="text-2xl font-medium tracking-tight text-gray-900">{value}</p>
      <p className="mt-1 text-xs text-gray-400">{label}</p>
      {delta && (
        <p className={cn('mt-1.5 flex items-center gap-1 text-xs', deltaUp ? 'text-green-600' : 'text-red-500')}>
          {delta}
        </p>
      )}
    </div>
  )
}
