'use client'

import { useEffect, useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { FinanceEntryType, ReserveWithBalance } from '@/lib/finance/types'

// Criar ou renomear uma caixinha. `kind` não é editável depois de criada —
// mudar o lado PF/PJ moveria patrimônio com histórico de lugar.
export function FinanceReserveForm({
  open,
  onOpenChange,
  kind,
  reserve,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  kind: FinanceEntryType
  reserve: ReserveWithBalance | null
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null)
    setName(reserve?.name ?? '')
  }, [open, reserve])

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Dê um nome à reserva.')
      return
    }

    startTransition(async () => {
      const res = await fetch(
        reserve ? `/api/finance/reservas/${reserve.id}` : '/api/finance/reservas',
        {
          method: reserve ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(reserve ? { name: trimmed } : { name: trimmed, kind }),
        }
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? 'Não foi possível salvar.')
        return
      }
      onOpenChange(false)
      onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {reserve ? 'Renomear reserva' : `Nova reserva — ${kind === 'pf' ? 'Pessoal' : 'Clínica'}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-gray-400">Nome</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Reserva de emergência"
              autoFocus
            />
            <p className="mt-1 text-xs text-gray-400">
              É por este nome que você fala com o agente no WhatsApp — &quot;guardei 500 na reserva
              de emergência&quot;.
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
