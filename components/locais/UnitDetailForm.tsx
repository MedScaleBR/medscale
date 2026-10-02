'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { lookupCep, maskCep } from '@/lib/cep'
import { friendlyErrorMessage } from '@/lib/friendly-errors'

export interface UnitDetail {
  id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  directions_parking: string | null
  contact_info: string | null
  handoff_number: string | null
}

type UnitForm = Record<Exclude<keyof UnitDetail, 'id'>, string>

function toForm(w: UnitDetail): UnitForm {
  return {
    name: w.name,
    address: w.address ?? '',
    city: w.city ?? '',
    state: w.state ?? '',
    zip_code: w.zip_code ?? '',
    directions_parking: w.directions_parking ?? '',
    contact_info: w.contact_info ?? '',
    handoff_number: w.handoff_number ?? '',
  }
}

// Dados da unidade que o paciente vê e que a Clara usa. Member só lê.
export function UnitDetailForm({
  workspace,
  canManage,
}: {
  workspace: UnitDetail
  canManage: boolean
}) {
  const [form, setForm] = useState(() => toForm(workspace))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cepError, setCepError] = useState(false)

  const setField = (key: keyof UnitForm, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const handleCepChange = async (raw: string) => {
    const { digits, masked } = maskCep(raw)
    setField('zip_code', masked)
    setCepError(false)
    if (digits.length !== 8) return
    const found = await lookupCep(digits)
    if (!found) {
      setCepError(true)
      return
    }
    setForm((f) => ({ ...f, address: found.address, city: found.city || f.city, state: found.state || f.state }))
  }

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          address: form.address || null,
          city: form.city || null,
          state: form.state || null,
          zip_code: form.zip_code || null,
          directions_parking: form.directions_parking || null,
          contact_info: form.contact_info || null,
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

  const card = 'rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]'

  return (
    <div className="space-y-6">
      <section className={card}>
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">Identificação e endereço</h2>
        <fieldset disabled={!canManage} className="space-y-4">
          <div>
            <Label htmlFor="name">Nome da unidade</Label>
            <Input id="name" value={form.name} onChange={(e) => setField('name', e.target.value)} className="mt-1" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_1fr]">
            <div>
              <Label htmlFor="zip_code">CEP</Label>
              <Input id="zip_code" value={form.zip_code} onChange={(e) => handleCepChange(e.target.value)} className="mt-1" />
              {cepError && <p className="mt-1 text-xs text-red-500">CEP não encontrado.</p>}
            </div>
            <div>
              <Label htmlFor="address">Endereço</Label>
              <Input
                id="address"
                value={form.address}
                onChange={(e) => setField('address', e.target.value)}
                placeholder="Ex: Rua Exemplo, 123 - Sala 45, Bairro"
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-4">
            <div>
              <Label htmlFor="city">Cidade</Label>
              <Input id="city" value={form.city} onChange={(e) => setField('city', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="state">UF</Label>
              <Input id="state" maxLength={2} value={form.state} onChange={(e) => setField('state', e.target.value.toUpperCase())} className="mt-1" />
            </div>
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
        </fieldset>
      </section>

      <section className={card}>
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">Atendimento ao paciente</h2>
        <fieldset disabled={!canManage} className="space-y-4">
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
        </fieldset>

        {canManage && (
          <div className="mt-4 space-y-3">
            {error && (
              <p className="text-sm text-red-500">
                {friendlyErrorMessage(error, 'Não foi possível salvar esta alteração. Tente novamente.')}
              </p>
            )}
            <Button
              onClick={save}
              disabled={saving || !form.name.trim()}
              className="bg-[var(--cyan)] font-medium text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
            >
              {saving ? 'Salvando...' : saved ? '✓ Salvo' : 'Salvar unidade'}
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
