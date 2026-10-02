'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Settings {
  daily_summary_enabled: boolean
  daily_summary_hour: number
  daily_summary_only_with_activity: boolean
  overdue_tolerance_days: number
}

export function RevenueSettingsClient({ initialSettings }: { initialSettings: Settings }) {
  const [settings, setSettings] = useState(initialSettings)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)

  const saveSettings = async () => {
    setSavingSettings(true)
    setSettingsSaved(false)
    try {
      const res = await fetch('/api/revenue-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (res.ok) setSettingsSaved(true)
    } finally {
      setSavingSettings(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Fechamento diário ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="text-sm font-medium text-gray-900">Fechamento diário</h2>
        <p className="mt-0.5 text-xs text-gray-400">
          Resumo de receita do dia enviado no seu WhatsApp.
        </p>
        <Separator className="my-4" />
        <div className="space-y-4">
          <label className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Enviar resumo diário</span>
            <Switch
              checked={settings.daily_summary_enabled}
              onCheckedChange={(v) => setSettings((s) => ({ ...s, daily_summary_enabled: v }))}
            />
          </label>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-gray-700">Horário do envio</span>
            <Select
              value={String(settings.daily_summary_hour)}
              onValueChange={(v) => setSettings((s) => ({ ...s, daily_summary_hour: Number(v) }))}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, h) => (
                  <SelectItem key={h} value={String(h)}>
                    {String(h).padStart(2, '0')}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Só enviar em dias com consultas realizadas</span>
            <Switch
              checked={settings.daily_summary_only_with_activity}
              onCheckedChange={(v) => setSettings((s) => ({ ...s, daily_summary_only_with_activity: v }))}
            />
          </label>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-gray-700">
              Alertar inadimplência após
              <span className="ml-1 text-xs text-gray-400">(dias sem pagamento)</span>
            </span>
            <Input
              type="number"
              min={0}
              className="w-24"
              value={settings.overdue_tolerance_days}
              onChange={(e) =>
                setSettings((s) => ({ ...s, overdue_tolerance_days: Math.max(0, Number(e.target.value) || 0) }))
              }
            />
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Button
            onClick={saveSettings}
            disabled={savingSettings}
            className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            {savingSettings ? 'Salvando...' : 'Salvar preferências'}
          </Button>
          {settingsSaved && <span className="text-xs text-green-600">Salvo com sucesso.</span>}
        </div>
      </div>
    </div>
  )
}
