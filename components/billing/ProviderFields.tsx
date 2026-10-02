'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { friendlyErrorMessage } from '@/lib/friendly-errors'

export interface ProviderWorkspace {
  id: string
  name: string
  cnes: string | null
  cnpj: string | null
  legal_name: string | null
}

// CNES/CNPJ/razão social de cada unidade — identificação do prestador na guia.
// Grava em /api/workspaces/[id] (owner/admin), a mesma rota dos outros dados
// da unidade.
export function ProviderFields({ workspaces }: { workspaces: ProviderWorkspace[] }) {
  return (
    <div className="space-y-4">
      {workspaces.map((w) => (
        <WorkspaceProvider key={w.id} workspace={w} showName={workspaces.length > 1} />
      ))}
    </div>
  )
}

function WorkspaceProvider({ workspace, showName }: { workspace: ProviderWorkspace; showName: boolean }) {
  const [form, setForm] = useState({
    cnes: workspace.cnes ?? '',
    cnpj: workspace.cnpj ?? '',
    legal_name: workspace.legal_name ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Erro ao salvar.')
      else setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-[var(--navy-06)] p-4">
      {showName && <p className="text-xs font-medium text-gray-500">{workspace.name}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor={`cnes-${workspace.id}`}>CNES</Label>
          <Input
            id={`cnes-${workspace.id}`}
            inputMode="numeric"
            maxLength={7}
            placeholder="7 dígitos"
            value={form.cnes}
            onChange={(e) => setForm((f) => ({ ...f, cnes: e.target.value.replace(/\D/g, '') }))}
          />
        </div>
        <div>
          <Label htmlFor={`cnpj-${workspace.id}`}>CNPJ</Label>
          <Input
            id={`cnpj-${workspace.id}`}
            inputMode="numeric"
            maxLength={18}
            placeholder="Só números"
            value={form.cnpj}
            onChange={(e) => setForm((f) => ({ ...f, cnpj: e.target.value.replace(/\D/g, '') }))}
          />
        </div>
        <div>
          <Label htmlFor={`legal-${workspace.id}`}>Razão social</Label>
          <Input
            id={`legal-${workspace.id}`}
            maxLength={150}
            value={form.legal_name}
            onChange={(e) => setForm((f) => ({ ...f, legal_name: e.target.value }))}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving} variant="outline" size="sm">
          {saving ? 'Salvando...' : 'Salvar dados da unidade'}
        </Button>
        {saved && <span className="text-xs text-green-600">Salvo.</span>}
        {error && <span className="text-xs text-red-600">{friendlyErrorMessage(error, "Não foi possível concluir esta ação de faturamento. Confira os dados e tente novamente.")}</span>}
      </div>
    </div>
  )
}
