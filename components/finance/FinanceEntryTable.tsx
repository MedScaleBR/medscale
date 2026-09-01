'use client'

import { MoreVertical } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import type { FinanceEntry } from '@/lib/finance/types'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

const MAX_ROWS = 200

function names(tree: FinanceCategoryTree, e: FinanceEntry): { cat: string; sub: string } {
  const roots = e.type === 'pf' ? tree.pf : tree.pj
  const cat = roots.find((c) => c.id === e.category_id)
  const sub = cat?.children.find((s) => s.id === e.subcategory_id)
  return {
    cat: cat?.name ?? (e.category_id ? '—' : 'Sem categoria'),
    sub: sub?.name ?? '—',
  }
}

export function FinanceEntryTable({
  entries, tree, kind, unitNames, onEdit, onDelete,
}: {
  entries: FinanceEntry[]
  tree: FinanceCategoryTree
  kind: 'pf' | 'pj'
  unitNames: Record<string, string>
  onEdit: (e: FinanceEntry) => void
  onDelete: (e: FinanceEntry) => void
}) {
  const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const rows = entries.slice(0, MAX_ROWS)

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
      {rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">Nenhum lançamento neste período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 text-left text-xs text-gray-400">
                <th className="px-5 py-3 font-normal">Data</th>
                <th className="px-5 py-3 font-normal">Descrição</th>
                <th className="px-5 py-3 font-normal">Categoria</th>
                <th className="px-5 py-3 font-normal">Subcategoria</th>
                {kind === 'pj' && <th className="px-5 py-3 font-normal">Unidade</th>}
                <th className="px-5 py-3 font-normal">Valor</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const n = names(tree, e)
                return (
                  <tr key={e.id} className="border-b border-[var(--navy-06)] last:border-0">
                    <td className="px-5 py-3 text-gray-600">
                      {new Date(e.entry_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-5 py-3 text-gray-600">{e.description ?? '—'}</td>
                    <td className={`px-5 py-3 ${e.category_id ? 'text-gray-600' : 'text-amber-600'}`}>{n.cat}</td>
                    <td className="px-5 py-3 text-gray-600">{n.sub}</td>
                    {kind === 'pj' && (
                      <td className="px-5 py-3 text-gray-600">
                        {e.workspace_id ? (unitNames[e.workspace_id] ?? 'Unidade') : 'Consolidado'}
                      </td>
                    )}
                    <td className="px-5 py-3 font-medium text-gray-900">{formatBRL(e.amount)}</td>
                    <td className="px-2 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="rounded p-1 hover:bg-[var(--navy-06)]">
                          <MoreVertical className="h-4 w-4 text-gray-400" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onEdit(e)}>Editar</DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600" onClick={() => onDelete(e)}>Excluir</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
