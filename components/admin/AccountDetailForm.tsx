'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { TOGGLEABLE_MODULES } from '@/lib/admin/accounts'
import { cn } from '@/lib/utils'
import type { AccountPlan, ModuleSlug } from '@/types/database'

const PLAN_OPTIONS: { value: AccountPlan; label: string }[] = [
  { value: 'essencial', label: 'Essencial' },
  { value: 'avancado', label: 'Avançado' },
  { value: 'premium', label: 'Premium' },
]

interface AccountDetailFormProps {
  accountId: string
  initialPlan: AccountPlan
  initialModules: ModuleSlug[]
  initialIsActive: boolean
}

interface Snapshot {
  plan: AccountPlan
  modules: ModuleSlug[]
  isActive: boolean
}

// Cada campo diferente do último estado salvo conta 1: plano, status e cada
// módulo ligado/desligado.
function countChanges(current: Snapshot, saved: Snapshot): number {
  let n = 0
  if (current.plan !== saved.plan) n += 1
  if (current.isActive !== saved.isActive) n += 1
  for (const m of TOGGLEABLE_MODULES) {
    if (current.modules.includes(m.slug) !== saved.modules.includes(m.slug)) n += 1
  }
  return n
}

export function AccountDetailForm({ accountId, initialPlan, initialModules, initialIsActive }: AccountDetailFormProps) {
  const [plan, setPlan] = useState(initialPlan)
  const [modules, setModules] = useState<ModuleSlug[]>(initialModules)
  const [isActive, setIsActive] = useState(initialIsActive)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [savedState, setSavedState] = useState<Snapshot>({
    plan: initialPlan,
    modules: initialModules,
    isActive: initialIsActive,
  })

  const changes = countChanges({ plan, modules, isActive }, savedState)

  const toggleModule = (slug: ModuleSlug) => {
    setSaved(false)
    setModules((prev) => (prev.includes(slug) ? prev.filter((m) => m !== slug) : [...prev, slug]))
  }

  const save = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, modules, is_active: isActive }),
      })
      if (res.ok) {
        setSaved(true)
        setSavedState({ plan, modules, isActive })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
      <div className="space-y-5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-gray-900">Plano e módulos</h2>
            <p className="mt-0.5 text-xs text-gray-400">Dashboard, Pacientes e Configurações estão sempre ativos.</p>
          </div>
          <label className="flex shrink-0 items-center gap-2.5 text-sm text-gray-700">
            Account ativa
            <Switch
              checked={isActive}
              onCheckedChange={(v) => {
                setSaved(false)
                setIsActive(v)
              }}
            />
          </label>
        </div>

        <div role="radiogroup" aria-label="Plano" className="grid gap-2 sm:grid-cols-3">
          {PLAN_OPTIONS.map((p) => {
            const selected = plan === p.value
            return (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setSaved(false)
                  setPlan(p.value)
                }}
                className={cn(
                  'rounded-[10px] border px-4 py-3 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)] active:translate-y-px',
                  selected
                    ? 'border-[var(--cyan)] bg-[var(--cyan-10)] text-gray-900'
                    : 'border-[var(--navy-10)] text-gray-700 hover:border-[var(--cyan)]'
                )}
              >
                {p.label}
              </button>
            )
          })}
        </div>

        <ul className="grid gap-x-8 sm:grid-cols-2" aria-label="Módulos">
          {TOGGLEABLE_MODULES.map((m) => {
            const on = modules.includes(m.slug)
            return (
              <li key={m.slug} className="border-t border-[var(--navy-06)]">
                <label className="flex cursor-pointer items-center justify-between gap-3 py-2.5 text-sm">
                  <span className={on ? 'text-gray-900' : 'text-gray-500'}>{m.label}</span>
                  <Switch size="sm" checked={on} onCheckedChange={() => toggleModule(m.slug)} />
                </label>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="flex items-center gap-3 border-t border-[var(--navy-06)] bg-[var(--navy-06)]/40 px-5 py-3">
        <Button
          onClick={save}
          disabled={saving}
          className="h-9 rounded-[10px] bg-[var(--cyan)] px-4 text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </Button>
        {changes > 0 ? (
          <span className="text-xs whitespace-nowrap text-gray-500">
            {changes} {changes === 1 ? 'alteração não salva' : 'alterações não salvas'}
          </span>
        ) : (
          saved && <span className="text-xs text-green-700">Salvo com sucesso.</span>
        )}
      </div>
    </div>
  )
}
