'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SUPPORTED_TISS_VERSIONS, GUIDE_TYPE_LABELS } from '@/lib/billing/constants'
import type { TissGuideType } from '@/types/database'
import { friendlyErrorMessage } from '@/lib/friendly-errors'

export interface InsurerRow {
  id: string
  name: string
  ans_registry: string
  provider_code: string
  tiss_version: string
  default_consult_guide: TissGuideType
  batch_weekdays: number[]
  batch_hour: number
  max_guides_per_batch: number
  is_active: boolean
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const EMPTY = {
  name: '',
  ans_registry: '',
  provider_code: '',
  tiss_version: SUPPORTED_TISS_VERSIONS[0] as string,
  default_consult_guide: 'consulta' as TissGuideType,
  batch_weekdays: [1, 2, 3, 4, 5],
  batch_hour: 18,
  max_guides_per_batch: 100,
  is_active: true,
}

export function InsurerForm({
  open,
  onOpenChange,
  insurer,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  insurer: InsurerRow | null
  onSaved: (insurer: InsurerRow) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <InsurerFormBody insurer={insurer} onSaved={onSaved} onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  )
}

function InsurerFormBody({
  insurer,
  onSaved,
  onOpenChange,
}: {
  insurer: InsurerRow | null
  onSaved: (insurer: InsurerRow) => void
  onOpenChange: (open: boolean) => void
}) {
  const [form, setForm] = useState(insurer ? { ...insurer } : EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleDay = (day: number) =>
    setForm((f) => ({
      ...f,
      batch_weekdays: f.batch_weekdays.includes(day)
        ? f.batch_weekdays.filter((d) => d !== day)
        : [...f.batch_weekdays, day].sort(),
    }))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/insurers', {
        method: insurer ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(insurer ? { id: insurer.id } : {}),
          name: form.name,
          ans_registry: form.ans_registry,
          provider_code: form.provider_code,
          tiss_version: form.tiss_version,
          default_consult_guide: form.default_consult_guide,
          batch_weekdays: form.batch_weekdays,
          batch_hour: form.batch_hour,
          max_guides_per_batch: form.max_guides_per_batch,
          is_active: form.is_active,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao salvar.')
        return
      }
      onSaved(data as InsurerRow)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{insurer ? 'Editar convênio' : 'Novo convênio'}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label htmlFor="insurer_name">Nome da operadora</Label>
          <Input id="insurer_name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="ans_registry">Registro ANS</Label>
            <Input
              id="ans_registry"
              inputMode="numeric"
              maxLength={6}
              placeholder="6 dígitos"
              value={form.ans_registry}
              onChange={(e) => setForm((f) => ({ ...f, ans_registry: e.target.value.replace(/\D/g, '') }))}
            />
          </div>
          <div>
            <Label htmlFor="provider_code">Código do prestador</Label>
            <Input
              id="provider_code"
              maxLength={14}
              placeholder="Na operadora"
              value={form.provider_code}
              onChange={(e) => setForm((f) => ({ ...f, provider_code: e.target.value }))}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Versão TISS</Label>
            <Select value={form.tiss_version} onValueChange={(v) => v && setForm((f) => ({ ...f, tiss_version: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_TISS_VERSIONS.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Guia padrão da consulta</Label>
            <Select
              value={form.default_consult_guide}
              onValueChange={(v) => v && setForm((f) => ({ ...f, default_consult_guide: v as TissGuideType }))}
            >
              <SelectTrigger>
                <SelectValue>{(v) => GUIDE_TYPE_LABELS[v as TissGuideType] ?? ''}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="consulta">Consulta</SelectItem>
                <SelectItem value="sp_sadt">SP/SADT</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Fechamento automático do lote (horário de Brasília)</Label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {WEEKDAYS.map((label, day) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleDay(day)}
                aria-pressed={form.batch_weekdays.includes(day)}
                className={
                  form.batch_weekdays.includes(day)
                    ? 'rounded-md bg-[var(--cyan-10)] px-2.5 py-1 text-xs font-medium text-[var(--cyan-dark)]'
                    : 'rounded-md bg-[var(--navy-06)] px-2.5 py-1 text-xs text-gray-500'
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="batch_hour">Hora</Label>
            <Input
              id="batch_hour"
              type="number"
              min={0}
              max={23}
              value={form.batch_hour}
              onChange={(e) => setForm((f) => ({ ...f, batch_hour: Number(e.target.value) }))}
            />
          </div>
          <div>
            <Label htmlFor="max_guides">Máx. guias por lote</Label>
            <Input
              id="max_guides"
              type="number"
              min={1}
              max={100}
              value={form.max_guides_per_batch}
              onChange={(e) => setForm((f) => ({ ...f, max_guides_per_batch: Number(e.target.value) }))}
            />
          </div>
        </div>
        <label className="flex items-center justify-between pt-1">
          <span className="text-sm text-gray-700">Ativa</span>
          <Switch checked={form.is_active} onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
        </label>
        {error && <p className="text-xs text-red-600">{friendlyErrorMessage(error, "Não foi possível concluir esta ação de faturamento. Confira os dados e tente novamente.")}</p>}
      </div>
      <DialogFooter>
        <Button
          onClick={save}
          disabled={saving}
          className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </Button>
      </DialogFooter>
    </>
  )
}
