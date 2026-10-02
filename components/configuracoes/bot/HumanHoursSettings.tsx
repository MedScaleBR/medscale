'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { HandoffHoursSettings, type HandoffScheduleHour } from './HandoffHoursSettings'

export interface HumanHoursSettingsProps {
  workspaces: { id: string; name: string }[]
  initialGlobalHours: HandoffScheduleHour[]
  initialUnitHours: (HandoffScheduleHour & { workspace_id: string })[]
}

export function HumanHoursSettings({ workspaces, initialGlobalHours, initialUnitHours }: HumanHoursSettingsProps) {
  const [selected, setSelected] = useState('global')
  const [saving, setSaving] = useState(false)
  const [hoursByScope, setHoursByScope] = useState<Record<string, HandoffScheduleHour[]>>(() => ({
    global: initialGlobalHours,
    ...Object.fromEntries(workspaces.map((unit) => [unit.id, initialUnitHours.filter((hour) => hour.workspace_id === unit.id)])),
  }))
  const globalHours = hoursByScope.global
  const unitHours = hoursByScope[selected] ?? []
  const inheritsGlobal = selected !== 'global' && unitHours.length === 0 && globalHours.length > 0
  const items = { global: 'Global', ...Object.fromEntries(workspaces.map((unit) => [unit.id, unit.name])) }

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="human-hours-scope">Horário de atendimento humano</Label>
        <Select disabled={saving} items={items} value={selected} onValueChange={(value) => value && setSelected(value)}>
          <SelectTrigger id="human-hours-scope" className="mt-1 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="global">Global</SelectItem>
            {workspaces.map((unit) => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-gray-400">
        Global vale para todas as unidades sem horário próprio. Ao cadastrar um horário na unidade,
        ele substitui o Global por completo, inclusive nos dias sem atendimento. Sem horário próprio
        nem Global, o atendimento humano fica disponível 24/7. As alterações de horário são salvas automaticamente.
      </p>
      <HandoffHoursSettings
        key={selected}
        initialHours={unitHours}
        scope={selected === 'global' ? 'global' : undefined}
        workspaceId={selected === 'global' ? undefined : selected}
        onHoursChange={(hours) => setHoursByScope((previous) => ({ ...previous, [selected]: hours }))}
        onSavingChange={setSaving}
        emptyMessage={inheritsGlobal
          ? 'Esta unidade usa o horário Global. Adicione um horário para definir um expediente humano próprio.'
          : selected === 'global'
            ? 'Sem horário Global — unidades sem horário próprio têm atendimento humano disponível 24/7.'
            : 'Sem horário próprio nem Global — atendimento humano disponível 24/7.'}
      />
    </div>
  )
}
