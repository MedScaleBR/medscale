'use client'

import { useEffect, useState } from 'react'
import { formatBRL } from '@/lib/finance/summary'
import type { CategoryNode } from '@/lib/finance/categories'

export interface ProjectionRow {
  categoryId: string
  subcategoryId: string | null
  path: string
  depth: 0 | 1
  projected: number | null
  realized: number
}

// Uma linha da grade. O input guarda o texto enquanto o owner digita e só
// chama a API quando ele sai do campo (ou aperta Enter) — sem salvar a cada
// tecla.
function Row({
  row,
  saving,
  onSave,
}: {
  row: ProjectionRow
  saving: boolean
  onSave: (value: number) => void
}) {
  const [draft, setDraft] = useState(row.projected != null ? String(row.projected) : '')

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(row.projected != null ? String(row.projected) : '')
  }, [row.projected])

  const commit = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    const value = Number(trimmed.replace(',', '.'))
    if (!Number.isFinite(value) || value < 0) return
    if (value === row.projected) return
    onSave(value)
  }

  // Sem projeção não há o que comparar — a coluna fica vazia em vez de
  // mostrar 100% de estouro contra um teto de zero.
  const over = row.projected != null && row.projected > 0 ? row.realized - row.projected : null
  const pct = row.projected != null && row.projected > 0 ? (row.realized / row.projected) * 100 : null

  return (
    <tr className="border-b border-[var(--navy-06)] last:border-0">
      <td className={`px-4 py-2 ${row.depth === 1 ? 'pl-9 text-gray-500' : 'text-gray-900'}`}>
        {row.path}
      </td>
      <td className="px-4 py-2">
        <input
          inputMode="decimal"
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          placeholder="—"
          className="h-8 w-28 rounded-md border border-[var(--navy-06)] px-2 text-right text-sm text-gray-900 outline-none focus:border-[var(--cyan)] disabled:opacity-50"
        />
      </td>
      <td className="px-4 py-2 text-right text-gray-900">{formatBRL(row.realized)}</td>
      <td className="px-4 py-2 text-right">
        {over == null ? (
          <span className="text-xs text-gray-400">sem projeção</span>
        ) : (
          <span className={`text-sm font-medium ${over > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {over > 0 ? '+' : ''}
            {formatBRL(over)}
            <span className="ml-1 text-xs font-normal text-gray-400">{Math.round(pct as number)}%</span>
          </span>
        )}
      </td>
    </tr>
  )
}

export function FinanceProjectionGrid({
  roots,
  rows,
  savingKey,
  onSave,
}: {
  roots: CategoryNode[]
  rows: ProjectionRow[]
  savingKey: string | null
  onSave: (row: ProjectionRow, value: number) => void
}) {
  if (roots.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--navy-06)] bg-white p-8 text-center text-sm text-gray-500">
        Nenhuma categoria de despesa cadastrada.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--navy-06)] text-left text-xs text-gray-400">
            <th className="px-4 py-2 font-medium">Categoria</th>
            <th className="px-4 py-2 font-medium">Projetado</th>
            <th className="px-4 py-2 text-right font-medium">Realizado</th>
            <th className="px-4 py-2 text-right font-medium">Diferença</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row
              key={`${row.categoryId}:${row.subcategoryId ?? ''}`}
              row={row}
              saving={savingKey === `${row.categoryId}:${row.subcategoryId ?? ''}`}
              onSave={(value) => onSave(row, value)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
