'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WorkspaceBotSettingsForm, type BotSettingsValue } from '@/components/admin/WorkspaceBotSettingsForm'
import { createPreset, deletePreset, updatePreset, type PresetWithUsage } from '@/components/admin/clara-api'
import { INTAKE_FIELD_LABELS, SCHEDULING_MODE_LABELS } from '@/lib/bot/unit-settings'

type Editing = { id: string | null; name: string; description: string; value: BotSettingsValue }

const EMPTY: Editing = {
  id: null,
  name: '',
  description: '',
  value: { scheduling_mode: 'internal', intake_fields: [], bot_instructions: null },
}

function sortByName(list: PresetWithUsage[]): PresetWithUsage[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

function PresetEditor({
  editing,
  onCancel,
  onSaved,
}: {
  editing: Editing
  onCancel: () => void
  onSaved: (preset: PresetWithUsage) => void
}) {
  const [name, setName] = useState(editing.name)
  const [description, setDescription] = useState(editing.description)
  const idPrefix = `preset-${editing.id ?? 'new'}`

  const handleSubmit = async (value: BotSettingsValue): Promise<string | null> => {
    if (!name.trim()) return 'Dê um nome ao modelo.'
    const input = { ...value, name: name.trim(), description: description.trim() || null }
    if (editing.id) {
      const res = await updatePreset(editing.id, input)
      if (res.data === null) return res.error
      onSaved({ ...res.data.preset, units_count: 0 })
    } else {
      const res = await createPreset(input)
      if (res.data === null) return res.error
      onSaved(res.data.preset)
    }
    return null
  }

  return (
    <section className="space-y-4 rounded-xl border border-[var(--cyan)] bg-white p-6 shadow-[var(--shadow-sm)]">
      <h3 className="font-medium text-gray-900">{editing.id ? 'Editar modelo' : 'Novo modelo'}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${idPrefix}-name`}>Nome</Label>
          <Input id={`${idPrefix}-name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-description`}>Descrição</Label>
          <Input
            id={`${idPrefix}-description`}
            value={description}
            maxLength={300}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>
      <WorkspaceBotSettingsForm
        idPrefix={idPrefix}
        value={editing.value}
        submitLabel={editing.id ? 'Salvar modelo' : 'Criar modelo'}
        onSubmit={handleSubmit}
        footer={
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Fechar
          </Button>
        }
      />
      {editing.id && (
        <p className="text-xs text-gray-400">
          Editar o modelo não muda as unidades que já o aplicaram. Elas passam a aparecer como “(alterado)”.
        </p>
      )}
    </section>
  )
}

// /admin/clara/modelos — lista, cria, edita, duplica e exclui modelos.
export function PresetsManager({ initialPresets }: { initialPresets: PresetWithUsage[] }) {
  const [presets, setPresets] = useState(sortByName(initialPresets))
  const [editing, setEditing] = useState<Editing | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const upsert = (preset: PresetWithUsage) => {
    setPresets((prev) => {
      const existing = prev.find((p) => p.id === preset.id)
      const merged = existing ? { ...preset, units_count: existing.units_count } : preset
      return sortByName([...prev.filter((p) => p.id !== preset.id), merged])
    })
  }

  const duplicate = async (preset: PresetWithUsage) => {
    setMessage(null)
    let name = `Cópia de ${preset.name}`.slice(0, 80)
    for (let n = 2; presets.some((p) => p.name === name); n++) name = `Cópia ${n} de ${preset.name}`.slice(0, 80)
    const res = await createPreset({
      name,
      description: preset.description,
      scheduling_mode: preset.scheduling_mode,
      intake_fields: preset.intake_fields,
      bot_instructions: preset.bot_instructions,
    })
    if (res.data === null) setMessage({ ok: false, text: res.error })
    else {
      upsert(res.data.preset)
      setMessage({ ok: true, text: `“${name}” criado.` })
    }
  }

  const remove = async (preset: PresetWithUsage) => {
    setMessage(null)
    const res = await deletePreset(preset.id)
    setConfirmDelete(null)
    if (res.data === null) setMessage({ ok: false, text: res.error })
    else {
      setPresets((prev) => prev.filter((p) => p.id !== preset.id))
      setMessage({ ok: true, text: `“${preset.name}” excluído. As unidades continuam com a mesma configuração.` })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500">
          Aplicar um modelo copia os valores para a unidade. Mudar o modelo depois não altera quem já usa.
        </p>
        {!editing && (
          <Button
            onClick={() => setEditing(EMPTY)}
            className="shrink-0 bg-[var(--cyan)] font-medium text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            Novo modelo
          </Button>
        )}
      </div>

      {message && <p className={`text-sm ${message.ok ? 'text-gray-500' : 'text-red-500'}`}>{message.text}</p>}

      {editing && (
        <PresetEditor
          key={editing.id ?? 'new'}
          editing={editing}
          onCancel={() => setEditing(null)}
          onSaved={(preset) => {
            upsert(preset)
            setEditing(null)
            setMessage({ ok: true, text: `“${preset.name}” salvo.` })
          }}
        />
      )}

      {presets.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhum modelo ainda.</p>
      ) : (
        <ul className="space-y-3">
          {presets.map((preset) => (
            <li key={preset.id} className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <h3 className="font-medium text-gray-900">{preset.name}</h3>
                  {preset.description && <p className="text-sm text-gray-500">{preset.description}</p>}
                  <p className="text-xs text-gray-500">{SCHEDULING_MODE_LABELS[preset.scheduling_mode]}</p>
                  <p className="text-xs text-gray-400">
                    Dados a coletar:{' '}
                    {preset.intake_fields.length ? preset.intake_fields.map((f) => INTAKE_FIELD_LABELS[f]).join(', ') : 'nenhum'}
                    {preset.bot_instructions ? ' · com instruções' : ''}
                  </p>
                  <p className="text-xs text-gray-400">
                    {preset.units_count === 0
                      ? 'Nenhuma unidade usa'
                      : `${preset.units_count} ${preset.units_count === 1 ? 'unidade usa' : 'unidades usam'}`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setEditing({
                        id: preset.id,
                        name: preset.name,
                        description: preset.description ?? '',
                        value: {
                          scheduling_mode: preset.scheduling_mode,
                          intake_fields: preset.intake_fields,
                          bot_instructions: preset.bot_instructions,
                        },
                      })
                    }
                  >
                    Editar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => duplicate(preset)}>
                    Duplicar
                  </Button>
                  {confirmDelete === preset.id ? (
                    <>
                      <Button size="sm" className="bg-red-600 text-white hover:bg-red-700" onClick={() => remove(preset)}>
                        Confirmar exclusão
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setConfirmDelete(preset.id)}>
                      Excluir
                    </Button>
                  )}
                </div>
              </div>
              {confirmDelete === preset.id && preset.units_count > 0 && (
                <p className="mt-2 text-xs text-gray-500">
                  {preset.units_count} {preset.units_count === 1 ? 'unidade usa' : 'unidades usam'} este modelo. Elas continuam
                  com a mesma configuração, só deixam de mostrar “Baseado em”.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
