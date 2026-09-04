'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { FinanceMonthPicker } from './FinanceMonthPicker'
import { FinanceSummaryCards } from './FinanceSummaryCards'
import { FinanceCategoryChart } from './FinanceCategoryChart'
import { FinanceEntryTable } from './FinanceEntryTable'
import { FinanceEntryForm } from './FinanceEntryForm'
import { FinanceCategoryManager, type NodeWithCount } from './FinanceCategoryManager'
import type { FinanceEntry, FinanceEntryType } from '@/lib/finance/types'
import type { CategoryNode, FinanceCategoryTree } from '@/lib/finance/categories'

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// Anexa entryCount a cada nó da árvore a partir dos lançamentos já em memória,
// para o gerenciador de categorias montar sem bater na API. Conta abrange a
// janela de initialEntries (MONTHS_OF_HISTORY meses); a checagem "em uso" ao
// excluir é feita à parte no servidor, então isso é só o rótulo "(N)" da tela.
function withEntryCounts(nodes: CategoryNode[], counts: Map<string, number>): NodeWithCount[] {
  return nodes.map((n) => ({
    id: n.id,
    name: n.name,
    direction: n.direction,
    sortOrder: n.sortOrder,
    isArchived: n.isArchived,
    entryCount: counts.get(n.id) ?? 0,
    children: withEntryCounts(n.children, counts),
  }))
}

export function FinanceClient({
  initialEntries,
  categoryTree,
  workspaces,
}: {
  initialEntries: FinanceEntry[]
  categoryTree: FinanceCategoryTree
  workspaces: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [kind, setKind] = useState<FinanceEntryType>('pf')
  const [view, setView] = useState<'overview' | 'entries' | 'categories'>('overview')
  const [month, setMonth] = useState(currentMonth())
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<FinanceEntry | null>(null)
  // Lado do gráfico "Por categoria" — independente das abas PF/PJ. Default
  // despesa porque é o caso mais comum (toda conta tem gasto; nem toda tem
  // receita ainda cadastrada).
  const [chartSide, setChartSide] = useState<'out' | 'in'>('out')

  const unitNames = useMemo(
    () => Object.fromEntries(workspaces.map((w) => [w.id, w.name])),
    [workspaces]
  )

  const filtered = useMemo(
    () => initialEntries.filter((e) => e.type === kind && e.entry_date.startsWith(month)),
    [initialEntries, kind, month]
  )
  const receitas = useMemo(() => filtered.filter((e) => e.direction === 'in'), [filtered])
  const despesas = useMemo(() => filtered.filter((e) => e.direction === 'out'), [filtered])
  const totalReceitas = receitas.reduce((s, e) => s + e.amount, 0)
  const totalDespesas = despesas.reduce((s, e) => s + e.amount, 0)

  const roots = (kind === 'pf' ? categoryTree.pf : categoryTree.pj).filter((c) => c.direction === chartSide)
  const chartEntries = chartSide === 'in' ? receitas : despesas

  // Árvore com contagem para o gerenciador de categorias — derivada aqui em vez
  // de um GET /api/finance/categories no mount da aba (que refazia auth +
  // provision + scan de finance_entries em série).
  const categoryManagerData = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of initialEntries) {
      for (const id of [e.category_id, e.subcategory_id]) {
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
      }
    }
    return {
      pf: withEntryCounts(categoryTree.pf, counts),
      pj: withEntryCounts(categoryTree.pj, counts),
    }
  }, [initialEntries, categoryTree])

  const byCategory = useMemo(() => {
    const catName = (e: FinanceEntry) =>
      roots.find((c) => c.id === e.category_id)?.name ?? (e.category_id ? '—' : 'Sem categoria')
    const totals = new Map<string, number>()
    for (const e of chartEntries) {
      const key = catName(e)
      totals.set(key, (totals.get(key) ?? 0) + e.amount)
    }
    return Array.from(totals.entries())
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total)
  }, [chartEntries, roots])

  const topCategory = chartSide === 'out' && byCategory[0]
    ? { name: byCategory[0].category, value: byCategory[0].total }
    : null
  const uncategorized = chartEntries.filter((e) => !e.category_id).length

  const refresh = () => router.refresh()
  const openNew = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const openEdit = (e: FinanceEntry) => {
    setEditing(e)
    setFormOpen(true)
  }
  const del = async (e: FinanceEntry) => {
    if (!window.confirm('Excluir este lançamento?')) return
    const res = await fetch(`/api/finance/entries/${e.id}`, { method: 'DELETE' })
    if (res.ok) refresh()
    else window.alert('Não foi possível excluir.')
  }

  return (
    <>
      <Tabs value={kind} onValueChange={(v) => setKind(v as FinanceEntryType)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="pf">Pessoal (PF)</TabsTrigger>
            <TabsTrigger value="pj">Clínica (PJ)</TabsTrigger>
          </TabsList>
          <FinanceMonthPicker month={month} onChange={setMonth} />
        </div>
      </Tabs>

      <Tabs value={view} onValueChange={(v) => setView(v as typeof view)} className="mt-4">
        <TabsList>
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="entries">Lançamentos</TabsTrigger>
          <TabsTrigger value="categories">Categorias</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <FinanceSummaryCards receitas={totalReceitas} despesas={totalDespesas} topCategory={topCategory} />
          {uncategorized > 0 && (
            <button
              onClick={() => setView('entries')}
              className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-700"
            >
              {uncategorized} lançamento(s) sem categoria neste período — clique para revisar.
            </button>
          )}
          <Tabs value={chartSide} onValueChange={(v) => setChartSide(v as 'out' | 'in')}>
            <TabsList>
              <TabsTrigger value="out">Despesas</TabsTrigger>
              <TabsTrigger value="in">Receitas</TabsTrigger>
            </TabsList>
          </Tabs>
          <FinanceCategoryChart data={byCategory} />
        </TabsContent>

        <TabsContent value="entries" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={openNew}>
              <Plus className="mr-1 h-4 w-4" /> Novo lançamento
            </Button>
          </div>
          <FinanceEntryTable
            entries={filtered}
            tree={categoryTree}
            kind={kind}
            unitNames={unitNames}
            onEdit={openEdit}
            onDelete={del}
          />
        </TabsContent>

        <TabsContent value="categories" className="mt-4 space-y-4">
          <Tabs value={chartSide} onValueChange={(v) => setChartSide(v as 'out' | 'in')}>
            <TabsList>
              <TabsTrigger value="out">Despesas</TabsTrigger>
              <TabsTrigger value="in">Receitas</TabsTrigger>
            </TabsList>
          </Tabs>
          <FinanceCategoryManager
            key={`${kind}-${chartSide}`}
            kind={kind}
            direction={chartSide}
            initialData={(kind === 'pf' ? categoryManagerData.pf : categoryManagerData.pj).filter(
              (n) => n.direction === chartSide
            )}
            onChanged={refresh}
          />
        </TabsContent>
      </Tabs>

      <FinanceEntryForm
        open={formOpen}
        onOpenChange={setFormOpen}
        kind={kind}
        tree={categoryTree}
        workspaces={workspaces}
        entry={editing}
        onSaved={refresh}
      />
    </>
  )
}
