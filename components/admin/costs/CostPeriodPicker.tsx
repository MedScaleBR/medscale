'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { buttonLabel } from '@/lib/admin/calendar-grid'
import { COST_PERIODS, type CostWindow } from '@/lib/admin/cost-range'
import { DateRangeCalendar } from '@/components/admin/costs/DateRangeCalendar'

function href(basePath: string, query: Record<string, string>): string {
  return `${basePath}?${new URLSearchParams(query).toString()}`
}

/** 7 · 30 · 90 dias + calendário de um dia ou intervalo. Mantém `extraQuery` (aba, cliente) na URL. */
export function CostPeriodPicker({
  window,
  basePath,
  extraQuery,
  today,
}: {
  window: CostWindow
  basePath: string
  extraQuery: Record<string, string>
  today: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const custom = window.kind === 'custom' ? { from: window.from, to: window.to } : null

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <nav
        aria-label="Período"
        className="flex items-center gap-1 rounded-xl border border-[var(--navy-06)] bg-white p-1 shadow-[var(--shadow-sm)]"
      >
        {COST_PERIODS.map((p) => {
          const active = window.kind === 'days' && window.days === p
          return (
            <Link
              key={p}
              href={href(basePath, { ...extraQuery, days: String(p) })}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-[10px] px-3 py-1.5 text-xs whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)]',
                active ? 'bg-[var(--navy-dark)] text-white' : 'text-gray-500 hover:text-gray-900',
              )}
            >
              {p} dias
            </Link>
          )
        })}
        <button
          type="button"
          aria-expanded={open}
          aria-current={custom ? 'page' : undefined}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)]',
            custom
              ? 'bg-[var(--cyan)]/12 text-[var(--navy-dark)] ring-1 ring-[var(--cyan)] ring-inset'
              : 'text-gray-500 hover:text-gray-900',
          )}
        >
          <span aria-hidden>📅</span>
          {custom ? buttonLabel(custom) : 'Escolher dia'}
        </button>
      </nav>

      {open && (
        <DateRangeCalendar
          initial={custom}
          today={today}
          onClose={() => setOpen(false)}
          onApply={(r) => {
            setOpen(false)
            router.push(href(basePath, { ...extraQuery, from: r.from, to: r.to }))
          }}
        />
      )}
    </div>
  )
}
