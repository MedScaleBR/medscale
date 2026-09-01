'use client'

import { useMemo, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FinanceMonthPicker } from './FinanceMonthPicker'
import { FinanceSummaryCards } from './FinanceSummaryCards'
import { FinanceCategoryChart } from './FinanceCategoryChart'
import { FinanceEntryTable } from './FinanceEntryTable'
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
  // categoryTree/workspaces são consumidos na reestruturação da Task 15.
  void categoryTree
  void workspaces

  const [activeTab, setActiveTab] = useState<FinanceEntryType>('pf')
  const [month, setMonth] = useState(currentMonth())

  const filtered = useMemo(
    () => initialEntries.filter((e) => e.type === activeTab && e.entry_date.startsWith(month)),
    [initialEntries, activeTab, month]
  )

  const total = filtered.reduce((s, e) => s + e.amount, 0)

  const byCategory = useMemo(() => {
    const totals = new Map<string, number>()
    for (const e of filtered) {
      const cat = e.category ?? 'Outros'
      totals.set(cat, (totals.get(cat) ?? 0) + e.amount)
    }
    return Array.from(totals.entries())
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total)
  }, [filtered])

  const topCategory = byCategory[0] ? { name: byCategory[0].category, value: byCategory[0].total } : null

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FinanceEntryType)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="pf">Pessoal (PF)</TabsTrigger>
          <TabsTrigger value="pj">Clínica (PJ)</TabsTrigger>
        </TabsList>
        <FinanceMonthPicker month={month} onChange={setMonth} />
      </div>

      <TabsContent value="pf" className="mt-4 space-y-4">
        <FinanceSummaryCards total={total} topCategory={topCategory} />
        <FinanceCategoryChart data={byCategory} />
        <FinanceEntryTable entries={filtered} />
      </TabsContent>

      <TabsContent value="pj" className="mt-4 space-y-4">
        <FinanceSummaryCards total={total} topCategory={topCategory} />
        <FinanceCategoryChart data={byCategory} />
        <FinanceEntryTable entries={filtered} />
      </TabsContent>
    </Tabs>
  )
}
