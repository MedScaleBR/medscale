'use client'

import { useEffect, useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { FinanceEntryType, FinanceInvestment, InvestmentKind, InvestmentRateType } from '@/lib/finance/types'

const NONE = '__none__'
const todayISO = () => new Date().toISOString().slice(0, 10)

const TYPES: Record<InvestmentKind, string> = {
  renda_fixa: 'Renda fixa',
  renda_variavel: 'Renda variável',
  cripto: 'Cripto',
  outro: 'Outro',
}

const RATE_TYPES: Record<InvestmentRateType, string> = {
  fixed_annual: 'Taxa fixa (% a.a.)',
  pct_cdi: '% do CDI',
  ipca_plus: 'IPCA + (%)',
}

const RATE_HINTS: Record<InvestmentRateType, string> = {
  fixed_annual: 'Ex.: 12 para 12% ao ano',
  pct_cdi: 'Ex.: 110 para 110% do CDI',
  ipca_plus: 'Ex.: 6 para IPCA + 6%',
}

export function FinanceInvestmentForm({
  open,
  onOpenChange,
  kind,
  investment,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  kind: FinanceEntryType
  investment: FinanceInvestment | null
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<InvestmentKind>('renda_fixa')
  const [invested, setInvested] = useState('')
  const [currentValue, setCurrentValue] = useState('')
  const [rateType, setRateType] = useState<InvestmentRateType | null>(null)
  const [rateValue, setRateValue] = useState('')
  const [startDate, setStartDate] = useState(todayISO())
  const [maturityDate, setMaturityDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null)
    setName(investment?.name ?? '')
    setType(investment?.type ?? 'renda_fixa')
    setInvested(investment ? String(investment.invested_amount) : '')
    setCurrentValue(investment?.current_value != null ? String(investment.current_value) : '')
    setRateType(investment?.rate_type ?? null)
    setRateValue(investment?.rate_value != null ? String(investment.rate_value) : '')
    setStartDate(investment?.start_date ?? todayISO())
    setMaturityDate(investment?.maturity_date ?? '')
  }, [open, investment])

  const submit = () => {
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Dê um nome ao investimento.')
      return
    }
    const investedValue = Number(invested.replace(',', '.'))
    if (!Number.isFinite(investedValue) || investedValue <= 0) {
      setError('Informe o valor investido.')
      return
    }
    // Taxa é tudo-ou-nada, igual à API e ao agente: meia taxa viraria projeção
    // sem base.
    const rate = rateType ? Number(rateValue.replace(',', '.')) : null
    if (rateType && (!Number.isFinite(rate as number) || (rate as number) <= 0)) {
      setError('Informe o valor da taxa (ou deixe o tipo de taxa em branco).')
      return
    }

    const payload = {
      kind,
      name: trimmed,
      type,
      invested_amount: investedValue,
      current_value: currentValue.trim() ? Number(currentValue.replace(',', '.')) : null,
      rate_type: rateType,
      rate_value: rate,
      start_date: startDate || null,
      maturity_date: maturityDate || null,
    }

    startTransition(async () => {
      const res = await fetch(
        investment ? `/api/finance/investimentos/${investment.id}` : '/api/finance/investimentos',
        {
          method: investment ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
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
          <DialogTitle>{investment ? 'Editar investimento' : 'Novo investimento'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-gray-400">Nome</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: CDB Banco X" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-400">Tipo</label>
              <Select items={TYPES} value={type} onValueChange={(v) => setType(v as InvestmentKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Valor investido (R$)</label>
              <Input inputMode="decimal" value={invested} onChange={(e) => setInvested(e.target.value)} placeholder="0,00" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-400">Valor atual (opcional)</label>
              <Input
                inputMode="decimal"
                value={currentValue}
                onChange={(e) => setCurrentValue(e.target.value)}
                placeholder="deixe vazio para estimar"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Aplicado em</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-400">Rendimento (opcional)</label>
              <Select
                items={{ [NONE]: 'Sem taxa informada', ...RATE_TYPES }}
                value={rateType ?? NONE}
                onValueChange={(v) => setRateType(v === NONE ? null : (v as InvestmentRateType))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem taxa informada</SelectItem>
                  {Object.entries(RATE_TYPES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Taxa</label>
              <Input
                inputMode="decimal"
                value={rateValue}
                disabled={rateType === null}
                onChange={(e) => setRateValue(e.target.value)}
                placeholder={rateType ? RATE_HINTS[rateType] : '—'}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-400">Vencimento (opcional)</label>
            <Input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} />
          </div>

          <p className="text-xs text-gray-400">
            Sem tipo e valor da taxa não há projeção — preferimos mostrar &quot;dados
            insuficientes&quot; a estimar rendimento sem base.
          </p>

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
