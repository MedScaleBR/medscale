'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TagInput } from '@/components/configuracoes/bot/TagInput'
import { ProcedureCatalog, type Procedure } from './ProcedureCatalog'
import { friendlyErrorMessage } from '@/lib/friendly-errors'

interface Extras {
  payment_methods: string[]
  pricing_info: string
  exam_preparation: string
}

export function ServicesClient({
  workspaces,
  activeWorkspaceId,
  initialProceduresByWorkspace,
  initialExtras,
}: {
  workspaces: { id: string; name: string }[]
  activeWorkspaceId: string
  initialProceduresByWorkspace: Record<string, Procedure[]>
  initialExtras: Extras
}) {
  const multiUnit = workspaces.length > 1
  const [selectedId, setSelectedId] = useState(
    workspaces.some((w) => w.id === activeWorkspaceId) ? activeWorkspaceId : workspaces[0]?.id,
  )
  const [byWorkspace, setByWorkspace] = useState(initialProceduresByWorkspace)
  const [extras, setExtras] = useState(initialExtras)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unitItems = useMemo(() => Object.fromEntries(workspaces.map((w) => [w.id, w.name])), [workspaces])

  const saveExtras = async () => {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch('/api/bot/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_methods: extras.payment_methods,
          pricing_info: extras.pricing_info || null,
          exam_preparation: extras.exam_preparation || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Erro ao salvar.')
      else {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {multiUnit && (
        <div>
          <Label className="text-xs">Unidade</Label>
          <Select items={unitItems} value={selectedId} onValueChange={(v) => v && setSelectedId(v)}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {selectedId && (
        <ProcedureCatalog
          key={selectedId}
          workspaceId={selectedId}
          procedures={byWorkspace[selectedId] ?? []}
          onChange={(next) => setByWorkspace((prev) => ({ ...prev, [selectedId]: next }))}
        />
      )}

      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="text-sm font-medium text-gray-900">Pagamento e preparo</h2>
        <p className="mt-0.5 text-xs text-gray-400">Vale para todas as unidades. A Clara informa ao paciente.</p>
        <div className="mt-4 space-y-4">
          <div>
            <Label>Formas de pagamento</Label>
            <p className="mb-2 text-xs text-gray-400">Digite e pressione Enter para adicionar</p>
            <TagInput
              value={extras.payment_methods}
              onChange={(v) => setExtras((e) => ({ ...e, payment_methods: v }))}
              placeholder="Ex: Pix, Cartão, Dinheiro"
            />
          </div>
          <div>
            <Label htmlFor="pricing_info">Observações sobre preços</Label>
            <p className="mb-1 text-xs text-gray-400">Condições que não cabem na tabela acima (parcelamento, retorno, pacotes)</p>
            <Textarea
              id="pricing_info"
              value={extras.pricing_info}
              onChange={(e) => setExtras((x) => ({ ...x, pricing_info: e.target.value }))}
              rows={3}
              className="mt-1"
              placeholder="Ex: Retorno em até 30 dias sem custo. Parcelamos em até 3x."
            />
          </div>
          <div>
            <Label htmlFor="exam_preparation">Preparo para exames/procedimentos</Label>
            <Textarea
              id="exam_preparation"
              value={extras.exam_preparation}
              onChange={(e) => setExtras((x) => ({ ...x, exam_preparation: e.target.value }))}
              rows={3}
              className="mt-1"
              placeholder="Ex: Jejum de 8h para exame X. Trazer exames anteriores."
            />
          </div>
          {error && (
            <p className="text-sm text-red-500">
              {friendlyErrorMessage(error, 'Não foi possível salvar esta alteração. Tente novamente.')}
            </p>
          )}
          <Button
            onClick={saveExtras}
            disabled={saving}
            className="bg-[var(--cyan)] font-medium text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            {saving ? 'Salvando...' : saved ? '✓ Salvo' : 'Salvar pagamento e preparo'}
          </Button>
        </div>
      </div>
    </div>
  )
}
