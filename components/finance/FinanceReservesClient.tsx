'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { FinanceReserveCard } from './FinanceReserveCard'
import { FinanceReserveForm } from './FinanceReserveForm'
import { FinanceReserveMovementForm } from './FinanceReserveMovementForm'
import { formatBRL } from '@/lib/finance/summary'
import type { FinanceEntryType, ReserveWithBalance } from '@/lib/finance/types'

export function FinanceReservesClient({ reserves }: { reserves: ReserveWithBalance[] }) {
  const router = useRouter()
  const [kind, setKind] = useState<FinanceEntryType>('pf')
  const [showArchived, setShowArchived] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ReserveWithBalance | null>(null)
  const [moveTarget, setMoveTarget] = useState<ReserveWithBalance | null>(null)

  const ofKind = useMemo(() => reserves.filter((r) => r.kind === kind), [reserves, kind])
  const visible = useMemo(
    () => ofKind.filter((r) => showArchived || r.archived_at == null),
    [ofKind, showArchived]
  )
  // Arquivada não conta no total: o dinheiro pode ter saído de cena faz tempo.
  const total = useMemo(
    () => ofKind.filter((r) => r.archived_at == null).reduce((sum, r) => sum + r.balance, 0),
    [ofKind]
  )
  const archivedCount = ofKind.length - ofKind.filter((r) => r.archived_at == null).length

  const refresh = () => router.refresh()

  const call = async (url: string, init: RequestInit) => {
    const res = await fetch(url, init)
    if (res.ok) {
      refresh()
      return
    }
    const j = await res.json().catch(() => ({}))
    window.alert(j.error ?? 'Não foi possível concluir.')
  }

  const archive = (r: ReserveWithBalance, archived: boolean) =>
    call(`/api/finance/reservas/${r.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived }),
    })

  const remove = (r: ReserveWithBalance) => {
    if (!window.confirm(`Excluir a reserva ${r.name}?`)) return
    call(`/api/finance/reservas/${r.id}`, { method: 'DELETE' })
  }

  const removeMovement = (r: ReserveWithBalance, movementId: string) => {
    if (!window.confirm('Excluir este movimento?')) return
    call(`/api/finance/reservas/${r.id}/movimentos?movimento=${movementId}`, { method: 'DELETE' })
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Reservas</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            Dinheiro guardado em caixinhas — aqui ou pelo WhatsApp (&quot;guardei 500 na reserva de
            emergência&quot;)
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
            <Plus className="mr-1 h-4 w-4" /> Nova reserva
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
        <p className="text-[13px] font-medium text-gray-600">Total guardado</p>
        <p className="mt-2 text-3xl font-semibold tracking-[-0.02em] text-gray-900">{formatBRL(total)}</p>
        <p className="mt-1 text-xs text-gray-400">
          em {ofKind.filter((r) => r.archived_at == null).length} reserva
          {ofKind.filter((r) => r.archived_at == null).length === 1 ? '' : 's'} ativa
          {ofKind.filter((r) => r.archived_at == null).length === 1 ? '' : 's'}
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--navy-06)] bg-white p-8 text-center">
          <p className="text-sm text-gray-500">Nenhuma reserva por aqui ainda.</p>
          <p className="mt-1 text-xs text-gray-400">
            Crie uma caixinha e comece a guardar — o saldo é sempre a soma dos movimentos.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {visible.map((r) => (
            <FinanceReserveCard
              key={r.id}
              reserve={r}
              onMove={() => setMoveTarget(r)}
              onRename={() => {
                setEditing(r)
                setFormOpen(true)
              }}
              onArchive={(archived) => archive(r, archived)}
              onDelete={() => remove(r)}
              onDeleteMovement={(movementId) => removeMovement(r, movementId)}
            />
          ))}
        </div>
      )}

      {archivedCount > 0 && (
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="self-start text-xs text-gray-500 hover:text-gray-900"
        >
          {showArchived ? 'Esconder' : 'Mostrar'} {archivedCount} arquivada
          {archivedCount === 1 ? '' : 's'}
        </button>
      )}

      <FinanceReserveForm
        open={formOpen}
        onOpenChange={setFormOpen}
        kind={kind}
        reserve={editing}
        onSaved={refresh}
      />

      <FinanceReserveMovementForm
        open={moveTarget !== null}
        onOpenChange={(o) => !o && setMoveTarget(null)}
        reserve={moveTarget}
        onSaved={refresh}
      />
    </div>
  )
}
