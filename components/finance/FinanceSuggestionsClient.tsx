'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FinanceSuggestionCard } from './FinanceSuggestionCard'
import { monthLabel } from '@/lib/finance/summary'
import type { Suggestion } from '@/lib/finance/suggestions'
import type { FinanceEntryType } from '@/lib/finance/types'

export function FinanceSuggestionsClient({
  periodMonth,
  tolerance,
  suggestions,
}: {
  periodMonth: string
  tolerance: { projectionPct: number; historyPct: number }
  suggestions: Record<FinanceEntryType, Suggestion[]>
}) {
  const router = useRouter()
  const [kind, setKind] = useState<FinanceEntryType>('pf')
  const [projectionPct, setProjectionPct] = useState(String(tolerance.projectionPct))
  const [historyPct, setHistoryPct] = useState(String(tolerance.historyPct))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const list = suggestions[kind]
  const refresh = () => router.refresh()

  const dismiss = async (s: Suggestion) => {
    const res = await fetch('/api/finance/sugestoes/dismiss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        category_id: s.categoryId,
        subcategory_id: s.subcategoryId,
        period_month: periodMonth,
      }),
    })
    if (res.ok) refresh()
    else window.alert('Não foi possível dispensar o alerta.')
  }

  const saveTolerance = () => {
    setError(null)
    const projection = Number(projectionPct.replace(',', '.'))
    const history = Number(historyPct.replace(',', '.'))
    if (!Number.isFinite(projection) || !Number.isFinite(history) || projection < 0 || history < 0) {
      setError('Use porcentagens a partir de zero.')
      return
    }

    startTransition(async () => {
      const res = await fetch('/api/finance/sugestoes', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projection_tolerance_pct: projection, history_tolerance_pct: history }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? 'Não foi possível salvar.')
        return
      }
      refresh()
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Sugestões</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            Gasto supérfluo fora da curva em {monthLabel(periodMonth).toLowerCase()}
          </p>
        </div>

        <Tabs value={kind} onValueChange={(v) => setKind(v as FinanceEntryType)}>
          <TabsList>
            <TabsTrigger value="pf">Pessoal (PF)</TabsTrigger>
            <TabsTrigger value="pj">Clínica (PJ)</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--navy-06)] bg-white p-8 text-center">
          <p className="text-sm text-gray-500">Nenhum alerta neste mês.</p>
          <p className="mt-1 text-xs text-gray-400">
            Categorias marcadas como essenciais nunca alertam, e onde não há projeção nem dois meses de
            histórico não há base de comparação — aí o silêncio é proposital.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((s) => (
            <FinanceSuggestionCard
              key={`${s.categoryId}:${s.subcategoryId ?? ''}`}
              suggestion={s}
              onDismiss={() => dismiss(s)}
            />
          ))}
        </div>
      )}

      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
        <p className="text-[13px] font-medium text-gray-600">Quando avisar</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-gray-400">Acima da projeção (%)</label>
            <Input
              inputMode="decimal"
              value={projectionPct}
              onChange={(e) => setProjectionPct(e.target.value)}
            />
            <p className="mt-1 text-xs text-gray-400">0% = avisa assim que passar do teto.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">Acima da média histórica (%)</label>
            <Input inputMode="decimal" value={historyPct} onChange={(e) => setHistoryPct(e.target.value)} />
            <p className="mt-1 text-xs text-gray-400">Usado só onde não existe projeção.</p>
          </div>
        </div>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <div className="mt-3 flex justify-end">
          <Button onClick={saveTolerance} disabled={pending}>
            {pending ? 'Salvando…' : 'Salvar tolerâncias'}
          </Button>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Alerta dispensado volta a aparecer no mês seguinte. Para silenciar de vez uma categoria, marque
        ela como essencial em Lançamentos → Categorias.
      </p>
    </div>
  )
}
