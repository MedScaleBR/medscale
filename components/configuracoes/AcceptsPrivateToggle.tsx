'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { friendlyErrorMessage } from '@/lib/friendly-errors'

export interface PrivateUnit {
  id: string
  name: string
  accepts_private: boolean
}

// "Atende particular" é por unidade (workspaces.accepts_private). A Clara só
// oferece particular, e a Agenda só deixa marcar particular, nas unidades
// marcadas. Salva na hora, sem botão.
export function AcceptsPrivateToggle({ units: initialUnits }: { units: PrivateUnit[] }) {
  const [units, setUnits] = useState(initialUnits)
  const [error, setError] = useState<string | null>(null)
  const single = units.length === 1

  const toggle = async (id: string, next: boolean) => {
    const set = (value: boolean) =>
      setUnits((prev) => prev.map((u) => (u.id === id ? { ...u, accepts_private: value } : u)))
    set(next)
    setError(null)
    const res = await fetch(`/api/workspaces/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accepts_private: next }),
    })
    if (!res.ok) {
      set(!next)
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Erro ao salvar.')
    }
  }

  if (units.length === 0) return null

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
      {single ? (
        <label className="flex items-center justify-between gap-4">
          <div>
            <span className="text-sm font-medium text-gray-900">Aceita consultas particulares</span>
            <p className="mt-0.5 text-xs text-gray-400">A Clara informa ao paciente junto com os convênios abaixo.</p>
          </div>
          <Switch checked={units[0].accepts_private} onCheckedChange={(v) => toggle(units[0].id, v)} />
        </label>
      ) : (
        <>
          <h2 className="text-sm font-medium text-gray-900">Atendimento particular</h2>
          <p className="mt-0.5 text-xs text-gray-400">
            Unidades que atendem particular. Nas outras, a Clara e a Agenda não oferecem essa opção.
          </p>
          <ul className="mt-3 divide-y divide-[var(--navy-06)]">
            {units.map((u) => (
              <li key={u.id}>
                <label className="flex items-center justify-between gap-4 py-2.5">
                  <span className="text-sm text-gray-900">{u.name}</span>
                  <Switch
                    checked={u.accepts_private}
                    onCheckedChange={(v) => toggle(u.id, v)}
                    aria-label={`${u.name} atende particular`}
                  />
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-600">
          {friendlyErrorMessage(error, 'Não foi possível salvar esta alteração. Tente novamente.')}
        </p>
      )}
    </div>
  )
}
