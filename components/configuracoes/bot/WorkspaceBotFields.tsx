'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { HandoffHoursSettings } from './HandoffHoursSettings'
import type { Database } from '@/types/database'

type HandoffHour = Database['public']['Tables']['handoff_hours']['Row']

export interface WorkspaceBotRow {
  id: string
  name: string
  address: string | null
  business_hours: string | null
  directions_parking: string | null
  contact_info: string | null
  consultation_price_from: number | null
  handoff_number: string | null
}

interface UnitForm {
  address: string
  business_hours: string
  directions_parking: string
  contact_info: string
  consultation_price_from: number | null
  handoff_number: string
}

function toUnitForm(w: WorkspaceBotRow): UnitForm {
  return {
    address: w.address ?? '',
    business_hours: w.business_hours ?? '',
    directions_parking: w.directions_parking ?? '',
    contact_info: w.contact_info ?? '',
    consultation_price_from: w.consultation_price_from,
    handoff_number: w.handoff_number ?? '',
  }
}

export function WorkspaceBotFields({
  workspaces,
  handoffHoursByWorkspace,
  activeWorkspaceId,
}: {
  workspaces: WorkspaceBotRow[]
  handoffHoursByWorkspace: Record<string, HandoffHour[]>
  activeWorkspaceId: string
}) {
  const multiUnit = workspaces.length > 1
  const initialId = workspaces.some((w) => w.id === activeWorkspaceId)
    ? activeWorkspaceId
    : workspaces[0]?.id
  const [selectedId, setSelectedId] = useState(initialId)
  const [forms, setForms] = useState<Record<string, UnitForm>>(
    () => Object.fromEntries(workspaces.map((w) => [w.id, toUnitForm(w)]))
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unitItems = useMemo(
    () => Object.fromEntries(workspaces.map((w) => [w.id, w.name])),
    [workspaces]
  )

  if (workspaces.length === 0) return null

  const form = forms[selectedId]
  const setField = <K extends keyof UnitForm>(key: K, value: UnitForm[K]) =>
    setForms((prev) => ({ ...prev, [selectedId]: { ...prev[selectedId], [key]: value } }))

  const save = async () => {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: form.address || null,
          business_hours: form.business_hours || null,
          directions_parking: form.directions_parking || null,
          contact_info: form.contact_info || null,
          consultation_price_from: form.consultation_price_from,
          handoff_number: form.handoff_number || null,
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
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        Estes campos variam por unidade — endereço, horário presencial, contato, preço e o
        atendimento humano. O resto da configuração da Maria (personalidade, convênios, FAQ,
        políticas) vale para todas as unidades.
      </p>

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

      <div className="space-y-4 rounded-lg border border-[var(--navy-06)] p-4">
        {!multiUnit && <p className="text-xs font-medium text-gray-500">{workspaces[0].name}</p>}
        <div>
          <Label htmlFor="address">Endereço</Label>
          <Input
            id="address"
            value={form.address}
            onChange={(e) => setField('address', e.target.value)}
            placeholder="Ex: Rua Exemplo, 123 - Sala 45, Bairro, Cidade/UF"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="business_hours">Horário de atendimento presencial (texto livre)</Label>
          <Textarea
            id="business_hours"
            value={form.business_hours}
            onChange={(e) => setField('business_hours', e.target.value)}
            rows={2}
            className="mt-1"
            placeholder="Ex: Segunda a sexta das 08h às 17h. Sábados das 08h às 12h."
          />
          <p className="mt-1.5 text-xs text-gray-400">
            Texto exibido ao paciente — a Maria conversa e agenda 24/7. Quem controla os horários
            reais para agendar é a{' '}
            <a href="/expediente" className="text-[var(--cyan-dark)] hover:underline">
              disponibilidade da unidade
            </a>
            .
          </p>
        </div>
        <div>
          <Label htmlFor="directions_parking">Como chegar / estacionamento</Label>
          <Textarea
            id="directions_parking"
            value={form.directions_parking}
            onChange={(e) => setField('directions_parking', e.target.value)}
            rows={2}
            className="mt-1"
            placeholder="Ex: Estacionamento próprio no local. Em frente ao metrô X."
          />
        </div>
        <div>
          <Label htmlFor="contact_info">Contatos</Label>
          <Textarea
            id="contact_info"
            value={form.contact_info}
            onChange={(e) => setField('contact_info', e.target.value)}
            rows={2}
            className="mt-1"
            placeholder="Ex: Telefone fixo, e-mail, Instagram"
          />
        </div>
        <div>
          <Label htmlFor="price">Valor da consulta particular a partir de (R$)</Label>
          <Input
            id="price"
            type="number"
            value={form.consultation_price_from ?? ''}
            onChange={(e) =>
              setField('consultation_price_from', e.target.value ? Number(e.target.value) : null)
            }
            placeholder="Deixe vazio para não informar preço"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="handoff_number">Número para transferência (handoff)</Label>
          <p className="mb-1 text-xs text-gray-400">Formato internacional: +5511999999999. Opcional.</p>
          <Input
            id="handoff_number"
            value={form.handoff_number}
            onChange={(e) => setField('handoff_number', e.target.value)}
            placeholder="+5511999999999"
            className="mt-1 font-mono"
          />
        </div>

        <div className="border-t border-[var(--navy-06)] pt-4">
          <Label className="mb-1 block">Horário de atendimento humano desta unidade</Label>
          <HandoffHoursSettings
            key={selectedId}
            initialHours={handoffHoursByWorkspace[selectedId] ?? []}
            workspaceId={selectedId === activeWorkspaceId ? undefined : selectedId}
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button
          onClick={save}
          disabled={saving}
          className="bg-[var(--cyan)] font-medium text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
        >
          {saving ? 'Salvando...' : saved ? '✓ Salvo' : `Salvar dados de ${multiUnit ? 'unidade' : 'contato'}`}
        </Button>
      </div>
    </div>
  )
}
