'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { friendlyErrorMessage } from '@/lib/friendly-errors'

// "Aceita particular" é da conta inteira (bot_config) — a Clara usa junto com
// a lista de convênios. Salva na hora, sem botão.
export function AcceptsPrivateToggle({ initialValue }: { initialValue: boolean }) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)

  const toggle = async (next: boolean) => {
    setValue(next)
    setError(null)
    const res = await fetch('/api/bot/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accepts_private: next }),
    })
    if (!res.ok) {
      setValue(!next)
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Erro ao salvar.')
    }
  }

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
      <label className="flex items-center justify-between gap-4">
        <div>
          <span className="text-sm font-medium text-gray-900">Aceita consultas particulares</span>
          <p className="mt-0.5 text-xs text-gray-400">A Clara informa ao paciente junto com os convênios abaixo.</p>
        </div>
        <Switch checked={value} onCheckedChange={toggle} />
      </label>
      {error && (
        <p className="mt-2 text-xs text-red-600">
          {friendlyErrorMessage(error, 'Não foi possível salvar esta alteração. Tente novamente.')}
        </p>
      )}
    </div>
  )
}
