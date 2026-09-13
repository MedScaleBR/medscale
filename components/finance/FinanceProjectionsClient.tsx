'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FinanceMonthPicker } from './FinanceMonthPicker'
import { FinanceProjectionGrid, type ProjectionRow } from './FinanceProjectionGrid'
import { formatBRL } from '@/lib/finance/summary'
import { projectedMonthlyExpense } from '@/lib/finance/goals'
import type { CategoryNode, FinanceCategoryTree } from '@/lib/finance/categories'
import type { FinanceEntry, FinanceEntryType, FinanceProjection } from '@/lib/finance/types'

const rowKey = (categoryId: string, subcategoryId: string | null) => `${categoryId}:${subcategoryId ?? ''}`

// Realizado por categoria e por subcategoria. Um lançamento em
// "Mercado > Feira" conta nas duas linhas: a raiz mostra o total da subárvore,
// como na quebra por categoria da tela de lançamentos.
function realizedMap(entries: FinanceEntry[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const e of entries) {
    if (!e.category_id) continue
    const root = rowKey(e.category_id, null)
    map.set(root, (map.get(root) ?? 0) + e.amount)
    if (e.subcategory_id) {
      const sub = rowKey(e.category_id, e.subcategory_id)
      map.set(sub, (map.get(sub) ?? 0) + e.amount)
    }
  }
  return map
}

function buildRows(
  roots: CategoryNode[],
  projections: FinanceProjection[],
  realized: Map<string, number>
): ProjectionRow[] {
  const byKey = new Map(projections.map((p) => [rowKey(p.category_id, p.subcategory_id), p.projected_amount]))

  const rows: ProjectionRow[] = []
  for (const root of roots) {
    rows.push({
      categoryId: root.id,
      subcategoryId: null,
      path: root.name,
      depth: 0,
      projected: byKey.get(rowKey(root.id, null)) ?? null,
      realized: realized.get(rowKey(root.id, null)) ?? 0,
    })
    for (const child of root.children) {
      rows.push({
        categoryId: root.id,
        subcategoryId: child.id,
        path: child.name,
        depth: 1,
        projected: byKey.get(rowKey(root.id, child.id)) ?? null,
        realized: realized.get(rowKey(root.id, child.id)) ?? 0,
      })
    }
  }
  return rows
}

export function FinanceProjectionsClient({
  period,
  tree,
  projections,
  entries,
}: {
  period: string
  tree: FinanceCategoryTree
  projections: FinanceProjection[]
  entries: FinanceEntry[]
}) {
  const router = useRouter()
  const [kind, setKind] = useState<FinanceEntryType>('pf')
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const roots = useMemo(
    () => (kind === 'pf' ? tree.pf : tree.pj).filter((c) => c.direction === 'out'),
    [tree, kind]
  )
  const realized = useMemo(() => realizedMap(entries.filter((e) => e.type === kind)), [entries, kind])

  // Projeção não guarda PF/PJ — o lado vem da categoria.
  const ofKind = useMemo(() => {
    const ids = new Set(roots.map((r) => r.id))
    return projections.filter((p) => ids.has(p.category_id))
  }, [projections, roots])

  const rows = useMemo(() => buildRows(roots, ofKind, realized), [roots, ofKind, realized])

  // Mesma soma que alimenta a meta automática: categoria com valor próprio
  // manda na subárvore, sem contar o mesmo dinheiro duas vezes.
  const totalProjected = useMemo(() => projectedMonthlyExpense(ofKind), [ofKind])
  const totalRealized = useMemo(
    () => entries.filter((e) => e.type === kind).reduce((sum, e) => sum + e.amount, 0),
    [entries, kind]
  )

  const changeMonth = (next: string) => router.push(`/finance/projecoes?periodo=${next}`)

  const save = async (row: ProjectionRow, value: number) => {
    setSavingKey(rowKey(row.categoryId, row.subcategoryId))
    const res = await fetch('/api/finance/projecoes', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        period_month: period,
        category_id: row.categoryId,
        subcategory_id: row.subcategoryId,
        projected_amount: value,
      }),
    })
    setSavingKey(null)
    if (res.ok) router.refresh()
    else {
      const j = await res.json().catch(() => ({}))
      window.alert(j.error ?? 'Não foi possível salvar a projeção.')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Projeções</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            Quanto você planeja gastar em cada categoria no mês, lado a lado com o realizado
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Tabs value={kind} onValueChange={(v) => setKind(v as FinanceEntryType)}>
            <TabsList>
              <TabsTrigger value="pf">Pessoal (PF)</TabsTrigger>
              <TabsTrigger value="pj">Clínica (PJ)</TabsTrigger>
            </TabsList>
          </Tabs>
          <FinanceMonthPicker month={period} onChange={changeMonth} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
          <p className="text-[13px] font-medium text-gray-600">Projetado no mês</p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-gray-900">
            {formatBRL(totalProjected)}
          </p>
          <p className="mt-1 text-xs text-gray-400">soma das categorias com teto definido</p>
        </div>
        <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
          <p className="text-[13px] font-medium text-gray-600">Realizado no mês</p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-gray-900">
            {formatBRL(totalRealized)}
          </p>
          <p className="mt-1 text-xs text-gray-400">todas as despesas do período</p>
        </div>
      </div>

      <FinanceProjectionGrid roots={roots} rows={rows} savingKey={savingKey} onSave={save} />
    </div>
  )
}
