'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AccountPlan, ModuleSlug } from '@/types/database'

const PLAN_OPTIONS: { value: AccountPlan; label: string }[] = [
  { value: 'essencial', label: 'Essencial' },
  { value: 'avancado', label: 'Avançado' },
  { value: 'premium', label: 'Premium' },
]

const TOGGLEABLE_MODULES: { slug: ModuleSlug; label: string }[] = [
  { slug: 'agenda', label: 'Minha agenda' },
  { slug: 'conversations', label: 'Conversas' },
  { slug: 'locations', label: 'Meus locais' },
  { slug: 'schedule', label: 'Meu expediente' },
  { slug: 'waitlist', label: 'Lista de espera' },
  { slug: 'financial', label: 'Meu financeiro' },
  { slug: 'campaigns', label: 'Atribuição' },
  { slug: 'transcriptions', label: 'Transcrições' },
]

interface AccountDetailFormProps {
  accountId: string
  initialPlan: AccountPlan
  initialModules: ModuleSlug[]
  initialIsActive: boolean
}

export function AccountDetailForm({ accountId, initialPlan, initialModules, initialIsActive }: AccountDetailFormProps) {
  const [plan, setPlan] = useState(initialPlan)
  const [modules, setModules] = useState<ModuleSlug[]>(initialModules)
  const [isActive, setIsActive] = useState(initialIsActive)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const toggleModule = (slug: ModuleSlug) => {
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
      if (res.ok) setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
      <h2 className="text-sm font-medium text-gray-900">Plano e módulos</h2>
      <div className="mt-4 space-y-4">
        <div>
          <Label>Plano</Label>
          <Select value={plan} onValueChange={(v) => v && setPlan(v as AccountPlan)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLAN_OPTIONS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3">
          <Switch checked={isActive} onCheckedChange={setIsActive} />
          <Label>Account ativa</Label>
        </div>

        <div>
          <Label className="mb-2 block">Módulos ativos</Label>
          <p className="mb-2 text-xs text-gray-400">Dashboard, Pacientes e Configurações estão sempre ativos.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TOGGLEABLE_MODULES.map((m) => (
              <label key={m.slug} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={modules.includes(m.slug)}
                  onChange={() => toggleModule(m.slug)}
                  className="h-4 w-4 rounded border-gray-300 accent-[var(--cyan)]"
                />
                {m.label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={save}
            disabled={saving}
            className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
          {saved && <span className="text-xs text-green-600">Salvo com sucesso.</span>}
        </div>
      </div>
    </div>
  )
}
