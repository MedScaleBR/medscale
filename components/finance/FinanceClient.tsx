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
import { FinanceCategoryManager } from './FinanceCategoryManager'
import type { FinanceEntry, FinanceEntryType } from '@/lib/finance/types'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
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

        <TabsContent value="categories" className="mt-4">
          <FinanceCategoryManager kind={kind} onChanged={refresh} />
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
