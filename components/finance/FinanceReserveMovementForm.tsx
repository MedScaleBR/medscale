'use client'

import { useEffect, useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatBRL } from '@/lib/finance/summary'
import type { ReserveMovementType, ReserveWithBalance } from '@/lib/finance/types'

const todayISO = () => new Date().toISOString().slice(0, 10)

// Depósito ou retirada. O valor é sempre positivo; o sinal está no tipo —
// mesma regra da API e do agente do WhatsApp.
export function FinanceReserveMovementForm({
  open,
  onOpenChange,
  reserve,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  reserve: ReserveWithBalance | null
  onSaved: () => void
}) {
  const [type, setType] = useState<ReserveMovementType>('deposit')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null)
    setType('deposit')
    setAmount('')
    setDate(todayISO())
    setNote('')
  }, [open])

  const submit = () => {
    if (!reserve) return
    const value = Number(amount.replace(',', '.'))
    if (!Number.isFinite(value) || value <= 0) {
      setError('Informe um valor maior que zero.')
      return
    }

    startTransition(async () => {
      const res = await fetch(`/api/finance/reservas/${reserve.id}/movimentos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: value, type, occurred_at: date, note: note.trim() || null }),
      })
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
          <DialogTitle>{reserve?.name ?? 'Reserva'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-gray-500">
            Saldo atual: <span className="font-medium text-gray-900">{formatBRL(reserve?.balance ?? 0)}</span>
          </p>

          <div className="flex gap-2">
            <Button variant={type === 'deposit' ? 'default' : 'ghost'} onClick={() => setType('deposit')}>
              Guardar
            </Button>
            <Button variant={type === 'withdrawal' ? 'default' : 'ghost'} onClick={() => setType('withdrawal')}>
              Retirar
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-400">Valor (R$)</label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Data</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-400">Observação (opcional)</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: sobra do mês" />
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
