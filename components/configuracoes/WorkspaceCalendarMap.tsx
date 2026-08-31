'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface WorkspaceCalendarRow {
  id: string
  name: string
  gcalCalendarId: string | null
}

interface GoogleCalendar {
  id: string
  name: string
  primary: boolean
}

const PRIMARY = '__primary__'
const CREATE = '__create__'

export function WorkspaceCalendarMap({ workspaces }: { workspaces: WorkspaceCalendarRow[] }) {
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mapping, setMapping] = useState<Record<string, string | null>>(
    () => Object.fromEntries(workspaces.map((w) => [w.id, w.gcalCalendarId]))
  )
  const [savingId, setSavingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})

  const loadCalendars = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/google/calendars')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao listar calendários.')
      setCalendars(json)
    } catch (err) {
      setLoadError(String(err instanceof Error ? err.message : err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCalendars()
  }, [])

  const items = useMemo(() => {
    const map: Record<string, string> = { [PRIMARY]: 'Calendário principal', [CREATE]: '+ Criar calendário para esta unidade' }
    for (const c of calendars) map[c.id] = c.name + (c.primary ? ' (principal)' : '')
    return map
  }, [calendars])

  const onChange = async (workspaceId: string, value: string) => {
    setSavingId(workspaceId)
    setRowError((e) => ({ ...e, [workspaceId]: '' }))
    try {
      const payload =
        value === CREATE
          ? { workspace_id: workspaceId, create: true }
          : { workspace_id: workspaceId, calendar_id: value === PRIMARY ? null : value }

      const res = await fetch('/api/google/workspace-calendar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Não foi possível salvar.')

      setMapping((m) => ({ ...m, [workspaceId]: json.calendar_id ?? null }))
      if (value === CREATE) await loadCalendars()
    } catch (err) {
      setRowError((e) => ({ ...e, [workspaceId]: String(err instanceof Error ? err.message : err) }))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-900">Calendário por unidade</h3>
      <p className="mt-0.5 text-xs text-gray-400">
        Qual calendário do Google representa cada unidade. Consultas marcadas na unidade vão para o
        calendário escolhido; a disponibilidade é lida dele.
      </p>

      {loadError && <p className="mt-3 text-xs text-red-500">{loadError}</p>}
      {loading && <p className="mt-3 text-xs text-gray-400">Carregando calendários…</p>}

      {!loading && (
        <div className="mt-3 space-y-2">
          {workspaces.map((w) => {
            const current = mapping[w.id]
            const value = current ?? PRIMARY
            return (
              <div key={w.id} className="flex flex-wrap items-center gap-2">
                <span className="w-40 shrink-0 truncate text-xs font-medium text-gray-600">{w.name}</span>
                <Select
                  items={items}
                  value={value}
                  onValueChange={(v) => v && onChange(w.id, v)}
                  disabled={savingId === w.id}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PRIMARY}>Calendário principal</SelectItem>
                    {calendars
                      .filter((c) => !c.primary)
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id!}>
                          {c.name}
                        </SelectItem>
                      ))}
                    <SelectItem value={CREATE}>+ Criar calendário para esta unidade</SelectItem>
                  </SelectContent>
                </Select>
                {savingId === w.id && <span className="text-xs text-gray-400">salvando…</span>}
                {rowError[w.id] && <span className="text-xs text-red-500">{rowError[w.id]}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
