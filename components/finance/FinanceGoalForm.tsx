'use client'

import { useEffect, useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { FinanceEntryType, FinanceGoal, GoalMode } from '@/lib/finance/types'

const NONE = '__none__'

export function FinanceGoalForm({
  open,
  onOpenChange,
  kind,
  goal,
  reserves,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  kind: FinanceEntryType
  goal: FinanceGoal | null
  reserves: { id: string; name: string; kind: FinanceEntryType }[]
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<GoalMode>('manual')
  const [targetAmount, setTargetAmount] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [months, setMonths] = useState('1')
  const [reserveId, setReserveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null)
    setName(goal?.name ?? '')
    setMode(goal?.mode ?? 'manual')
    setTargetAmount(goal?.target_amount != null ? String(goal.target_amount) : '')
    setTargetDate(goal?.target_date ?? '')
    setMonths(String(goal?.months_of_expenses ?? 1))
    setReserveId(goal?.linked_reserve_id ?? null)
  }, [open, goal])

  const options = reserves.filter((r) => r.kind === (goal?.kind ?? kind))

  const submit = () => {
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Dê um nome à meta.')
      return
    }

    let target: number | null = null
    if (mode === 'manual') {
      target = Number(targetAmount.replace(',', '.'))
      if (!Number.isFinite(target) || target <= 0) {
        setError('Informe quanto você quer juntar.')
        return
      }
    }

    const payload = {
      kind,
      name: trimmed,
      mode,
      target_amount: target,
      target_date: targetDate || null,
      months_of_expenses: mode === 'auto' ? Number(months.replace(',', '.')) || 1 : 1,
      linked_reserve_id: reserveId,
    }

    startTransition(async () => {
      const res = await fetch(goal ? `/api/finance/metas/${goal.id}` : '/api/finance/metas', {
        method: goal ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
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
          <DialogTitle>{goal ? 'Editar meta' : 'Nova meta'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-gray-400">Nome</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Viagem" />
          </div>

          <div className="flex gap-2">
            <Button variant={mode === 'manual' ? 'default' : 'ghost'} onClick={() => setMode('manual')}>
              Valor que eu escolho
            </Button>
            <Button variant={mode === 'auto' ? 'default' : 'ghost'} onClick={() => setMode('auto')}>
              Calculada pelas projeções
            </Button>
          </div>

          {mode === 'manual' ? (
            <div>
              <label className="mb-1 block text-xs text-gray-400">Quanto quer juntar (R$)</label>
              <Input
                inputMode="decimal"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                placeholder="0,00"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs text-gray-400">Meses de despesa</label>
              <Input inputMode="decimal" value={months} onChange={(e) => setMonths(e.target.value)} />
              <p className="mt-1 text-xs text-gray-400">
                O alvo é a soma das projeções do mês × esse número, menos o que já está em reservas e
                investimentos. Recalculado toda vez que a tela abre.
              </p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-gray-400">Prazo (opcional)</label>
            <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            <p className="mt-1 text-xs text-gray-400">Sem prazo não dá para dividir por mês.</p>
          </div>

          {options.length > 0 && (
            <div>
              <label className="mb-1 block text-xs text-gray-400">Reserva vinculada (opcional)</label>
              <Select
                items={{ [NONE]: 'Todo o patrimônio', ...Object.fromEntries(options.map((r) => [r.id, r.name])) }}
                value={reserveId ?? NONE}
                onValueChange={(v) => setReserveId(v === NONE ? null : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Todo o patrimônio</SelectItem>
                  {options.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-gray-400">
                Vinculada, só o saldo daquela caixinha conta para a meta.
              </p>
            </div>
          )}

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
