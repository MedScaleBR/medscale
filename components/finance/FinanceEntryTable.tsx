'use client'

import { useMemo, useState } from 'react'
import { MoreVertical, Search } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { bareMonthLabel, formatBRL } from '@/lib/finance/summary'
import type { FinanceEntry } from '@/lib/finance/types'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

// Quantas linhas a tela mostra antes de pedir "ver todos" — o card é um resumo
// do mês, não a lista inteira.
const PREVIEW_ROWS = 6
const MAX_ROWS = 200

function names(tree: FinanceCategoryTree, e: FinanceEntry): { cat: string; sub: string; uncategorized: boolean } {
  const roots = (e.type === 'pf' ? tree.pf : tree.pj).filter((c) => c.direction === e.direction)
  const cat = roots.find((c) => c.id === e.category_id)
  const sub = cat?.children.find((s) => s.id === e.subcategory_id)
  if (cat) return { cat: cat.name, sub: sub?.name ?? '—', uncategorized: false }
  // Espelho do ciclo de receita sem categoria resolvida (seed degradado) —
  // ainda tem o snapshot em `category`, não é "sem categoria" de verdade.
  if (e.category) return { cat: e.category, sub: '—', uncategorized: false }
  return { cat: 'Sem categoria', sub: '—', uncategorized: true }
}

export function FinanceEntryTable({
  entries, tree, kind, month, unitNames, uncategorizedCount, uncategorizedOnly,
  onUncategorizedOnlyChange, onEdit, onDelete,
}: {
  entries: FinanceEntry[]
  tree: FinanceCategoryTree
  kind: 'pf' | 'pj'
  month: string
  unitNames: Record<string, string>
  uncategorizedCount: number
  uncategorizedOnly: boolean
  onUncategorizedOnlyChange: (value: boolean) => void
  onEdit: (e: FinanceEntry) => void
  onDelete: (e: FinanceEntry) => void
}) {
  const [search, setSearch] = useState('')
  const [dir, setDir] = useState<'all' | 'in' | 'out'>('all')
  const [expanded, setExpanded] = useState(false)

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (dir !== 'all' && e.direction !== dir) return false
      if (uncategorizedOnly && (e.category_id || e.category)) return false
      if (!term) return true
      const n = names(tree, e)
      return (
        (e.description ?? '').toLowerCase().includes(term) ||
        n.cat.toLowerCase().includes(term) ||
        n.sub.toLowerCase().includes(term)
      )
    })
  }, [entries, tree, search, dir, uncategorizedOnly])

  const capped = filtered.slice(0, MAX_ROWS)
  const rows = expanded ? capped : capped.slice(0, PREVIEW_ROWS)
  const hidden = capped.length - rows.length

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--navy-06)] px-5 py-4">
        <h2 className="text-sm font-medium text-gray-900">Lançamentos de {bareMonthLabel(month)}</h2>
        <span className="text-[13px] text-gray-400">
          {entries.length} no mês
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex h-8 min-w-[200px] items-center gap-2 rounded-lg border border-[var(--navy-06)] px-2.5 focus-within:border-[var(--cyan)]">
            <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar descrição…"
              className="w-full bg-transparent text-[13px] text-gray-900 outline-none placeholder:text-gray-400"
            />
          </label>

          <Tabs value={dir} onValueChange={(v) => setDir(v as typeof dir)}>
            <TabsList>
              <TabsTrigger value="all">Tudo</TabsTrigger>
              <TabsTrigger value="in">Receitas</TabsTrigger>
              <TabsTrigger value="out">Despesas</TabsTrigger>
            </TabsList>
          </Tabs>

          {uncategorizedCount > 0 && (
            <button
              type="button"
              onClick={() => onUncategorizedOnlyChange(!uncategorizedOnly)}
              aria-pressed={uncategorizedOnly}
              className={`inline-flex h-8 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                uncategorizedOnly
                  ? 'border-amber-400 bg-amber-100 text-amber-800'
                  : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
              }`}
            >
              Sem categoria · {uncategorizedCount}
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">
          {entries.length === 0
            ? 'Nenhum lançamento neste período.'
            : 'Nenhum lançamento com esses filtros.'}
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 text-left text-xs text-gray-400">
                  <th className="px-5 py-3 font-normal">Data</th>
                  <th className="px-5 py-3 font-normal">Tipo</th>
                  <th className="px-5 py-3 font-normal">Descrição</th>
                  <th className="px-5 py-3 font-normal">Categoria</th>
                  <th className="px-5 py-3 font-normal">Subcategoria</th>
                  {kind === 'pj' && <th className="px-5 py-3 font-normal">Unidade</th>}
                  <th className="px-5 py-3 text-right font-normal">Valor</th>
                  <th className="px-2 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const n = names(tree, e)
                  const isIncome = e.direction === 'in'
                  const isMirror = !!e.revenue_entry_id
                  return (
                    <tr key={e.id} className="border-b border-[var(--navy-06)] last:border-0">
                      <td className="px-5 py-3 text-gray-600">
                        {new Date(e.entry_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            isIncome ? 'bg-green-100 text-green-700' : 'bg-[var(--navy-06)] text-gray-500'
                          }`}
                        >
                          {isIncome ? 'Receita' : 'Despesa'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-600">{e.description ?? '—'}</td>
                      <td className={`px-5 py-3 ${n.uncategorized ? 'text-amber-700' : 'text-gray-600'}`}>{n.cat}</td>
                      <td className="px-5 py-3 text-gray-600">{n.sub}</td>
                      {kind === 'pj' && (
                        <td className="px-5 py-3 text-gray-600">
                          {e.workspace_id ? (unitNames[e.workspace_id] ?? 'Unidade') : 'Consolidado'}
                        </td>
                      )}
                      <td
                        className={`px-5 py-3 text-right font-medium ${
                          isIncome ? 'text-green-600' : 'text-gray-900'
                        }`}
                      >
                        {isIncome ? '+' : ''}{formatBRL(e.amount)}
                      </td>
                      <td className="px-2 py-3 text-right">
                        {isMirror ? (
                          <span className="text-xs text-gray-400">Ciclo de receita</span>
                        ) : (
                          <DropdownMenu>
                            <DropdownMenuTrigger className="rounded p-1 hover:bg-[var(--navy-06)]">
                              <MoreVertical className="h-4 w-4 text-gray-400" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => onEdit(e)}>Editar</DropdownMenuItem>
                              <DropdownMenuItem className="text-red-600" onClick={() => onDelete(e)}>Excluir</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-[var(--navy-06)] md:hidden">
            {rows.map((e) => {
              const n = names(tree, e)
              const isIncome = e.direction === 'in'
              const isMirror = !!e.revenue_entry_id
              return (
                <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-gray-900">
                        {e.description ?? n.cat}
                      </span>
                      <span
                        className={`shrink-0 text-sm font-medium ${
                          isIncome ? 'text-green-600' : 'text-gray-900'
                        }`}
                      >
                        {isIncome ? '+' : ''}
                        {formatBRL(e.amount)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
                      <span>{new Date(e.entry_date + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
                      <span aria-hidden>·</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 ${
                          isIncome ? 'bg-green-100 text-green-700' : 'bg-[var(--navy-06)] text-gray-500'
                        }`}
                      >
                        {isIncome ? 'Receita' : 'Despesa'}
                      </span>
                      <span aria-hidden>·</span>
                      <span className={n.uncategorized ? 'text-amber-700' : undefined}>{n.cat}</span>
                      {n.sub !== '—' && (
                        <>
                          <span aria-hidden>·</span>
                          <span>{n.sub}</span>
                        </>
                      )}
                      {kind === 'pj' && (
                        <>
                          <span aria-hidden>·</span>
                          <span>
                            {e.workspace_id ? (unitNames[e.workspace_id] ?? 'Unidade') : 'Consolidado'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {isMirror ? (
                    <span className="shrink-0 pt-0.5 text-[11px] text-gray-400">Ciclo</span>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger className="-mr-1.5 flex size-11 shrink-0 items-center justify-center rounded hover:bg-[var(--navy-06)]">
                        <MoreVertical className="h-4 w-4 text-gray-400" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(e)}>Editar</DropdownMenuItem>
                        <DropdownMenuItem className="text-red-600" onClick={() => onDelete(e)}>
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              )
            })}
          </ul>

          {(hidden > 0 || expanded) && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="w-full border-t border-[var(--navy-06)] p-3 text-center text-[13px] font-medium text-[var(--cyan-dark)] transition-colors hover:bg-[var(--navy-06)]/40"
            >
              {expanded ? 'Mostrar menos' : `Ver os ${capped.length} lançamentos do mês`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
