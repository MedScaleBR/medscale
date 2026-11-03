'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { saveAskInsuranceFirst } from './clara-api'

// Opções da Clara que valem para a account inteira (só equipe MedScale).
export function ClaraAccountOptions({
  accountId,
  askInsuranceFirst: initial,
  unitsCount,
}: {
  accountId: string
  askInsuranceFirst: boolean
  unitsCount: number
}) {
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = async (next: boolean) => {
    setSaving(true)
    setError(null)
    setValue(next)
    const res = await saveAskInsuranceFirst(accountId, next)
    setSaving(false)
    if (res.data === null) {
      setValue(!next)
      setError(res.error)
    }
  }

  return (
    <section className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
      <h3 className="mb-1 font-medium text-gray-900">Clara nesta account</h3>
      <label className="mt-3 flex items-start justify-between gap-4">
        <span className="text-sm text-gray-700">
          Perguntar o convênio antes da unidade
          <span className="mt-0.5 block text-xs text-gray-400">
            A Clara pergunta o convênio (ou particular) primeiro e só mostra as unidades que aceitam esse convênio.
            {unitsCount <= 1 && ' Só tem efeito com mais de uma unidade ativa.'}
          </span>
        </span>
        <Switch
          checked={value}
          disabled={saving}
          onCheckedChange={toggle}
          aria-label="Perguntar o convênio antes da unidade"
        />
      </label>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </section>
  )
}
