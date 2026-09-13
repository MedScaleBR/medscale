'use client'

import { useState } from 'react'
import { Archive, ArchiveRestore, ChevronDown, PiggyBank, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatBRL } from '@/lib/finance/summary'
import type { ReserveWithBalance } from '@/lib/finance/types'

function movementLabel(type: 'deposit' | 'withdrawal'): string {
  return type === 'deposit' ? 'Guardado' : 'Retirado'
}

function dateLabel(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  })
}

export function FinanceReserveCard({
  reserve,
  onMove,
  onRename,
  onArchive,
  onDelete,
  onDeleteMovement,
}: {
  reserve: ReserveWithBalance
  onMove: () => void
  onRename: () => void
  onArchive: (archived: boolean) => void
  onDelete: () => void
  onDeleteMovement: (movementId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const archived = reserve.archived_at != null

  return (
    <div
      className={`rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)] ${
        archived ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--cyan-10)] text-[var(--cyan)]">
          <PiggyBank className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRename}
              className="truncate text-sm font-medium text-gray-900 hover:underline"
              title="Renomear"
            >
              {reserve.name}
            </button>
            {archived && <span className="text-xs text-gray-400">arquivada</span>}
          </div>
          <p className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-gray-900">
            {formatBRL(reserve.balance)}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            {reserve.movements.length} movimento{reserve.movements.length === 1 ? '' : 's'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!archived && (
            <Button variant="outline" onClick={onMove}>
              Movimentar
            </Button>
          )}
          <button
            type="button"
            aria-label={archived ? 'Desarquivar' : 'Arquivar'}
            title={archived ? 'Desarquivar' : 'Arquivar'}
            onClick={() => onArchive(!archived)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-[var(--navy-06)] hover:text-gray-600"
          >
            {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </button>
          {reserve.movements.length === 0 && (
            <button
              type="button"
              aria-label="Excluir reserva"
              title="Excluir reserva"
              onClick={onDelete}
              className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {reserve.movements.length > 0 && (
        <div className="mt-3 border-t border-[var(--navy-06)] pt-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
            Histórico
          </button>

          {open && (
            <ul className="mt-2 space-y-1">
              {reserve.movements.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-sm">
                  <span className="w-14 shrink-0 text-xs text-gray-400">{dateLabel(m.occurred_at)}</span>
                  <span className="text-gray-600">{movementLabel(m.type)}</span>
                  <span
                    className={`font-medium ${m.type === 'deposit' ? 'text-green-600' : 'text-red-600'}`}
                  >
                    {m.type === 'deposit' ? '+' : '−'}
                    {formatBRL(m.amount)}
                  </span>
                  {m.note && <span className="truncate text-xs text-gray-400">{m.note}</span>}
                  <button
                    type="button"
                    aria-label="Excluir movimento"
                    onClick={() => onDeleteMovement(m.id)}
                    className="ml-auto shrink-0 text-gray-300 transition-colors hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
