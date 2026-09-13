'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { FinanceGoalCard } from './FinanceGoalCard'
import { FinanceGoalForm } from './FinanceGoalForm'
import type { GoalStatus } from '@/lib/finance/goals'
import type { FinanceEntryType, FinanceGoal } from '@/lib/finance/types'

export interface GoalWithStatus {
  goal: FinanceGoal
  status: GoalStatus
}

export function FinanceGoalsClient({
  goals,
  reserves,
}: {
  goals: GoalWithStatus[]
  reserves: { id: string; name: string; kind: FinanceEntryType }[]
}) {
  const router = useRouter()
  const [kind, setKind] = useState<FinanceEntryType>('pf')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<FinanceGoal | null>(null)

  const ofKind = useMemo(() => goals.filter((g) => g.goal.kind === kind), [goals, kind])
  const reserveNames = useMemo(() => new Map(reserves.map((r) => [r.id, r.name])), [reserves])

  const refresh = () => router.refresh()

  const remove = async (goal: FinanceGoal) => {
    if (!window.confirm(`Excluir a meta ${goal.name}?`)) return
    const res = await fetch(`/api/finance/metas/${goal.id}`, { method: 'DELETE' })
    if (res.ok) refresh()
    else window.alert('Não foi possível excluir.')
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Metas</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            Quanto falta juntar — pergunte também no WhatsApp: &quot;quanto falta pra minha meta de
            viagem?&quot;
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
            <Plus className="mr-1 h-4 w-4" /> Nova meta
          </Button>
        </div>
      </div>

      {ofKind.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--navy-06)] bg-white p-8 text-center">
          <p className="text-sm text-gray-500">Nenhuma meta por aqui ainda.</p>
          <p className="mt-1 text-xs text-gray-400">
            Escolha um valor ou deixe o sistema calcular a partir das suas projeções.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {ofKind.map(({ goal, status }) => (
            <FinanceGoalCard
              key={goal.id}
              goal={goal}
              status={status}
              reserveName={goal.linked_reserve_id ? reserveNames.get(goal.linked_reserve_id) ?? null : null}
              onEdit={() => {
                setEditing(goal)
                setFormOpen(true)
              }}
              onDelete={() => remove(goal)}
            />
          ))}
        </div>
      )}

      <FinanceGoalForm
        open={formOpen}
        onOpenChange={setFormOpen}
        kind={kind}
        goal={editing}
        reserves={reserves}
        onSaved={refresh}
      />
    </div>
  )
}
