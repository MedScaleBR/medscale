'use client'

import { Pencil, Target, Trash2 } from 'lucide-react'
import { formatBRL } from '@/lib/finance/summary'
import type { GoalStatus } from '@/lib/finance/goals'
import type { FinanceGoal } from '@/lib/finance/types'

export function FinanceGoalCard({
  goal,
  status,
  reserveName,
  onEdit,
  onDelete,
}: {
  goal: FinanceGoal
  status: GoalStatus
  reserveName: string | null
  onEdit: () => void
  onDelete: () => void
}) {
  const done = status.remaining === 0 && status.requiredTotal > 0

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--navy-06)] text-[var(--navy)]">
          <Target className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-gray-900">{goal.name}</span>
            <span className="rounded-md bg-[var(--navy-06)] px-1.5 py-0.5 text-[11px] text-gray-600">
              {goal.mode === 'auto' ? `automática · ${goal.months_of_expenses} mês(es) de despesa` : 'manual'}
            </span>
            {reserveName && <span className="text-xs text-gray-400">reserva: {reserveName}</span>}
          </div>

          <p className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-gray-900">
            {formatBRL(status.currentSaved)}
            <span className="ml-1 text-sm font-normal text-gray-400">
              de {formatBRL(status.requiredTotal)}
            </span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Editar meta"
            onClick={onEdit}
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-[var(--navy-06)] hover:text-gray-600"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Excluir meta"
            onClick={onDelete}
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--navy-06)]">
        <div
          className={`h-full rounded-full ${done ? 'bg-green-500' : 'bg-[var(--cyan)]'}`}
          style={{ width: `${Math.min(100, status.progressPct)}%` }}
        />
      </div>

      <p className="mt-2 text-xs text-gray-500">
        {done ? (
          'Meta batida.'
        ) : (
          <>
            Faltam <span className="font-medium text-gray-900">{formatBRL(status.remaining)}</span>
            {status.monthlyRequired != null && (
              <>
                {' '}— {formatBRL(status.monthlyRequired)}/mês
                {status.monthsRemaining ? ` por ${status.monthsRemaining} mês(es)` : ' (prazo vencido)'}
              </>
            )}
            {status.monthlyRequired == null && ' — sem prazo definido'}
          </>
        )}
      </p>
    </div>
  )
}
