'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  clickDay,
  dayState,
  draftToRange,
  draftTooLong,
  monthGrid,
  rangeLabel,
  type RangeDraft,
} from '@/lib/admin/calendar-grid'
import { presetRange, type CalendarPreset } from '@/lib/admin/cost-range'

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]
const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

const PRESETS: { id: CalendarPreset; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'ontem', label: 'Ontem' },
  { id: 'esta_semana', label: 'Esta semana' },
  { id: 'este_mes', label: 'Este mês' },
  { id: 'mes_passado', label: 'Mês passado' },
]

type Range = { from: string; to: string }

function shiftMonth(ym: { y: number; m: number }, delta: number) {
  const t = new Date(Date.UTC(ym.y, ym.m + delta, 1))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() }
}

function Month({
  ym,
  draft,
  today,
  onPick,
}: {
  ym: { y: number; m: number }
  draft: RangeDraft
  today: string
  onPick: (day: string) => void
}) {
  return (
    <div className="grid grid-cols-7 gap-y-0.5 text-center">
      {WEEKDAYS.map((w, i) => (
        <span key={i} className="pb-1 text-[10px] text-gray-400">
          {w}
        </span>
      ))}
      {monthGrid(ym.y, ym.m)
        .flat()
        .map((day, i) => {
          if (!day) return <span key={i} className="size-8" />
          const state = dayState(day, draft, today)
          return (
            <button
              key={day}
              type="button"
              disabled={state === 'future'}
              onClick={() => onPick(day)}
              aria-pressed={state === 'start' || state === 'end' || state === 'single'}
              className={cn(
                'size-8 text-xs tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--cyan)]',
                state === 'normal' && 'rounded-[9px] text-gray-800 hover:bg-[var(--navy-06)]',
                state === 'today' && 'rounded-[9px] text-gray-800 ring-1 ring-[var(--cyan)] ring-inset hover:bg-[var(--navy-06)]',
                state === 'future' && 'cursor-not-allowed text-gray-300',
                state === 'in' && 'bg-[var(--cyan)]/12 text-[var(--navy-dark)]',
                state === 'start' && 'rounded-l-[9px] bg-[var(--navy-dark)] font-medium text-white',
                state === 'end' && 'rounded-r-[9px] bg-[var(--navy-dark)] font-medium text-white',
                state === 'single' && 'rounded-[9px] bg-[var(--navy-dark)] font-medium text-white',
              )}
            >
              {Number(day.slice(8, 10))}
            </button>
          )
        })}
    </div>
  )
}

export function DateRangeCalendar({
  initial,
  today,
  onApply,
  onClose,
}: {
  initial: Range | null
  today: string
  onApply: (r: Range) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<RangeDraft>({ start: initial?.from ?? null, end: initial?.to ?? null })
  // Mostra o mês do fim escolhido (ou de hoje) à direita e o anterior à esquerda.
  const anchor = initial?.to ?? today
  const [right, setRight] = useState({ y: Number(anchor.slice(0, 4)), m: Number(anchor.slice(5, 7)) - 1 })
  const left = shiftMonth(right, -1)
  const canGoForward = `${right.y}-${String(right.m + 1).padStart(2, '0')}` < today.slice(0, 7)

  const range = draftToRange(draft)
  const tooLong = draftTooLong(draft)

  return (
    <div
      role="dialog"
      aria-label="Escolher período"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      className="absolute top-full right-0 z-30 mt-2 flex overflow-hidden rounded-2xl border border-[var(--navy-06)] bg-white shadow-[0_12px_32px_rgba(11,27,63,0.12)]"
    >
      <div className="w-36 border-r border-[var(--navy-06)] bg-[#fafbfd] p-2">
        <p className="px-2.5 py-1 text-[10px] tracking-wide text-gray-400 uppercase">Atalhos</p>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onApply(presetRange(p.id, new Date(`${today}T15:00:00Z`)))}
            className="block w-full rounded-lg px-2.5 py-1.5 text-left text-xs text-gray-600 outline-none hover:bg-[var(--navy-06)] focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="p-3.5">
        <div className="flex gap-6">
          {[left, right].map((ym, i) => (
            <div key={i}>
              <div className="mb-2 flex items-center justify-between text-sm font-medium text-[var(--navy-dark)]">
                {i === 0 ? (
                  <button
                    type="button"
                    aria-label="Mês anterior"
                    onClick={() => setRight(shiftMonth(right, -1))}
                    className="flex size-6 items-center justify-center rounded-lg border border-[var(--navy-06)] text-gray-500 hover:bg-[var(--navy-06)]"
                  >
                    ‹
                  </button>
                ) : (
                  <span className="size-6" />
                )}
                <span>
                  {MONTHS[ym.m]} {ym.y}
                </span>
                {i === 1 ? (
                  <button
                    type="button"
                    aria-label="Próximo mês"
                    disabled={!canGoForward}
                    onClick={() => setRight(shiftMonth(right, 1))}
                    className="flex size-6 items-center justify-center rounded-lg border border-[var(--navy-06)] text-gray-500 hover:bg-[var(--navy-06)] disabled:opacity-30"
                  >
                    ›
                  </button>
                ) : (
                  <span className="size-6" />
                )}
              </div>
              <Month ym={ym} draft={draft} today={today} onPick={(d) => setDraft(clickDay(draft, d))} />
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-4 border-t border-[var(--navy-06)] pt-3 text-xs">
          <span className={cn('text-gray-500', tooLong && 'text-red-500')}>
            {tooLong ? 'Escolha no máximo 366 dias' : range ? rangeLabel(range) : 'Clique num dia ou em dois para um período'}
          </span>
          <span className="flex gap-1">
            <button
              type="button"
              onClick={() => setDraft({ start: null, end: null })}
              className="rounded-lg px-3 py-1.5 text-gray-500 hover:text-gray-900"
            >
              Limpar
            </button>
            <button
              type="button"
              disabled={!range || tooLong}
              onClick={() => range && onApply(range)}
              className="rounded-lg bg-[var(--navy-dark)] px-3.5 py-1.5 text-white disabled:opacity-40"
            >
              Aplicar
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
