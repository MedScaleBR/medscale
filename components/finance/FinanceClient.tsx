'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Plus, Tags } from 'lucide-react'
import { FinanceMonthPicker } from './FinanceMonthPicker'
import { FinanceBalanceCard } from './FinanceBalanceCard'
import { FinanceStatCards } from './FinanceStatCards'
import { FinanceCategoryBreakdown } from './FinanceCategoryBreakdown'
import { FinanceForecastCard } from './FinanceForecastCard'
import { FinanceUncategorizedAlert } from './FinanceUncategorizedAlert'
import { FinanceEntryTable } from './FinanceEntryTable'
import { FinanceEntryForm } from './FinanceEntryForm'
import { FinanceCategoriesDialog } from './FinanceCategoriesDialog'
import type { NodeWithCount } from './FinanceCategoryManager'
import {
  buildMonthlySeries,
  categoryBreakdown,
  forecastSummary,
  monthKey,
  type PendingRevenue,
} from '@/lib/finance/summary'
import type { FinanceEntry, FinanceEntryType } from '@/lib/finance/types'
import type { CategoryNode, FinanceCategoryTree } from '@/lib/finance/categories'

// Janela do gráfico principal — casa com MONTHS_OF_HISTORY do page.tsx.
const TREND_MONTHS = 12

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
  pendingRevenue,
}: {
  initialEntries: FinanceEntry[]
  categoryTree: FinanceCategoryTree
  workspaces: { id: string; name: string }[]
  pendingRevenue: PendingRevenue[]
}) {
  const router = useRouter()
  const [kind, setKind] = useState<FinanceEntryType>('pf')
  const [month, setMonth] = useState(() => monthKey(new Date()))
  const [formOpen, setFormOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [editing, setEditing] = useState<FinanceEntry | null>(null)
  // Lado da quebra por categoria — independente das abas PF/PJ. Default
  // despesa porque é o caso mais comum (toda conta tem gasto; nem toda tem
  // receita ainda cadastrada).
  const [side, setSide] = useState<'out' | 'in'>('out')
  const [uncategorizedOnly, setUncategorizedOnly] = useState(false)

  const unitNames = useMemo(
    () => Object.fromEntries(workspaces.map((w) => [w.id, w.name])),
    [workspaces]
  )

  // Todos os meses da janela, só do tipo selecionado — base da série de 12 meses.
  const ofKind = useMemo(() => initialEntries.filter((e) => e.type === kind), [initialEntries, kind])
  const series = useMemo(() => buildMonthlySeries(ofKind, month, TREND_MONTHS), [ofKind, month])
  const current = series[series.length - 1]
  const previous = series[series.length - 2]

  const monthEntries = useMemo(() => ofKind.filter((e) => e.entry_date.startsWith(month)), [ofKind, month])
  const receitas = useMemo(() => monthEntries.filter((e) => e.direction === 'in'), [monthEntries])
  const despesas = useMemo(() => monthEntries.filter((e) => e.direction === 'out'), [monthEntries])

  const roots = useMemo(
    () => (kind === 'pf' ? categoryTree.pf : categoryTree.pj).filter((c) => c.direction === side),
    [categoryTree, kind, side]
  )
  const slices = useMemo(
    () => categoryBreakdown(side === 'in' ? receitas : despesas, roots),
    [side, receitas, despesas, roots]
  )

  const despesaRoots = useMemo(
    () => (kind === 'pf' ? categoryTree.pf : categoryTree.pj).filter((c) => c.direction === 'out'),
    [categoryTree, kind]
  )
  const topCategory = useMemo(() => {
    const top = categoryBreakdown(despesas, despesaRoots)[0]
    return top ? { name: top.name, total: top.total } : null
  }, [despesas, despesaRoots])

  const forecast = useMemo(
    () => forecastSummary(receitas, pendingRevenue, month),
    [receitas, pendingRevenue, month]
  )
  // O ciclo de receita é da clínica: só faz sentido no PJ, e só quando há algo
  // vindo dele (senão o card diria "R$ 0,00 a confirmar em 0 consultas").
  const showForecast = kind === 'pj' && (forecast.confirmado > 0 || forecast.aConfirmar > 0)

  const uncategorized = useMemo(
    () => monthEntries.filter((e) => !e.category_id && !e.category),
    [monthEntries]
  )
  const uncategorizedTotal = uncategorized.reduce((s, e) => s + e.amount, 0)

  // Árvore com contagem para o gerenciador de categorias — derivada aqui em vez
  // de um GET /api/finance/categories no mount (que refazia auth + provision +
  // scan de finance_entries em série).
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

  const hasAside = showForecast || uncategorized.length > 0

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Financeiro</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            Lançamentos pessoais (PF) e da clínica (PJ) — pelo WhatsApp ou aqui na tela
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Tabs value={kind} onValueChange={(v) => setKind(v as FinanceEntryType)}>
            <TabsList>
              <TabsTrigger value="pf">Pessoal (PF)</TabsTrigger>
              <TabsTrigger value="pj">Clínica (PJ)</TabsTrigger>
            </TabsList>
          </Tabs>
          <FinanceMonthPicker month={month} onChange={setMonth} />
          <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
            <Tags className="mr-1 h-4 w-4" /> Categorias
          </Button>
          <Button onClick={openNew}>
            <Plus className="mr-1 h-4 w-4" /> Novo lançamento
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        <FinanceBalanceCard series={series} month={month} />
        <FinanceStatCards
          current={current}
          previous={previous}
          topCategory={topCategory}
          forecast={forecast}
          showForecast={showForecast}
        />
      </div>

      <div
        className={`grid grid-cols-1 items-start gap-4 ${
          hasAside ? 'lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]' : ''
        }`}
      >
        <FinanceCategoryBreakdown slices={slices} side={side} onSideChange={setSide} />

        {hasAside && (
          <div className="flex flex-col gap-4">
            {showForecast && <FinanceForecastCard forecast={forecast} />}
            {uncategorized.length > 0 && (
              <FinanceUncategorizedAlert
                count={uncategorized.length}
                total={uncategorizedTotal}
                onReview={() => setUncategorizedOnly(true)}
              />
            )}
          </div>
        )}
      </div>

      <FinanceEntryTable
        entries={monthEntries}
        tree={categoryTree}
        kind={kind}
        month={month}
        unitNames={unitNames}
        uncategorizedCount={uncategorized.length}
        uncategorizedOnly={uncategorizedOnly}
        onUncategorizedOnlyChange={setUncategorizedOnly}
        onEdit={openEdit}
        onDelete={del}
      />

      <FinanceEntryForm
        open={formOpen}
        onOpenChange={setFormOpen}
        kind={kind}
        tree={categoryTree}
        workspaces={workspaces}
        entry={editing}
        onSaved={refresh}
      />

      <FinanceCategoriesDialog
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        kind={kind}
        data={kind === 'pf' ? categoryManagerData.pf : categoryManagerData.pj}
        onChanged={refresh}
      />
    </div>
  )
}
