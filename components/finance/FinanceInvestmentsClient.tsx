'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { FinanceInvestmentTable, type InvestmentRow } from './FinanceInvestmentTable'
import { FinanceInvestmentForm } from './FinanceInvestmentForm'
import { investmentCurrentValue } from '@/lib/finance/investments'
import { formatBRL } from '@/lib/finance/summary'
import type { FinanceEntryType, FinanceInvestment } from '@/lib/finance/types'

export function FinanceInvestmentsClient({ rows }: { rows: InvestmentRow[] }) {
  const router = useRouter()
  const [kind, setKind] = useState<FinanceEntryType>('pf')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<FinanceInvestment | null>(null)

  const ofKind = useMemo(() => rows.filter((r) => r.investment.kind === kind), [rows, kind])
  const invested = useMemo(
    () => ofKind.reduce((sum, r) => sum + r.investment.invested_amount, 0),
    [ofKind]
  )
  // Mesma ordem de precedência do patrimônio nas metas: valor informado >
  // estimado pela taxa > valor investido.
  const current = useMemo(
    () => ofKind.reduce((sum, r) => sum + investmentCurrentValue(r.investment), 0),
    [ofKind]
  )

  const refresh = () => router.refresh()

  const remove = async (investment: FinanceInvestment) => {
    if (!window.confirm(`Excluir ${investment.name}?`)) return
    const res = await fetch(`/api/finance/investimentos/${investment.id}`, { method: 'DELETE' })
    if (res.ok) refresh()
    else window.alert('Não foi possível excluir.')
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Investimentos</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            O que está aplicado, com projeção quando você informa a taxa
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Tabs value={kind} onValueChange={(v) => setKind(v as FinanceEntryType)}>
            <TabsList>
              <TabsTrigger value="pf">Pessoal (PF)</TabsTrigger>
              <TabsTrigger value="pj">Clínica (PJ)</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Novo investimento
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
          <p className="text-[13px] font-medium text-gray-600">Total investido</p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-gray-900">{formatBRL(invested)}</p>
          <p className="mt-1 text-xs text-gray-400">
            {ofKind.length} aplicaç{ofKind.length === 1 ? 'ão' : 'ões'}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
          <p className="text-[13px] font-medium text-gray-600">Valor atual estimado</p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-gray-900">{formatBRL(current)}</p>
          <p className="mt-1 text-xs text-gray-400">
            sem taxa informada, vale o valor investido
          </p>
        </div>
      </div>

      <FinanceInvestmentTable
        rows={ofKind}
        onEdit={(investment) => {
          setEditing(investment)
          setFormOpen(true)
        }}
        onDelete={remove}
      />

      <FinanceInvestmentForm
        open={formOpen}
        onOpenChange={setFormOpen}
        kind={kind}
        investment={editing}
        onSaved={refresh}
      />
    </div>
  )
}
