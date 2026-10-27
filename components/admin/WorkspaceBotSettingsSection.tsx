'use client'

import { useState } from 'react'
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import { WorkspaceBotSettingsForm, type BotSettingsValue } from './WorkspaceBotSettingsForm'

export interface WorkspaceBotSettingsRow {
  id: string
  name: string
  settings: BotSettingsValue
  updatedByName: string | null
  updatedAt: string | null
}

function formatUpdatedAt(iso: string): string {
  return format(new TZDate(new Date(iso), 'America/Sao_Paulo'), "dd/MM/yyyy 'às' HH:mm")
}

function WorkspaceBotSettingsCard({ row }: { row: WorkspaceBotSettingsRow }) {
  const [updatedByName, setUpdatedByName] = useState(row.updatedByName)
  const [updatedAt, setUpdatedAt] = useState(row.updatedAt)

  const handleSubmit = async (next: BotSettingsValue): Promise<string | null> => {
    try {
      const res = await fetch(`/api/admin/workspaces/${row.id}/bot-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return data.error ?? 'Não foi possível salvar.'
      setUpdatedByName(data.updated_by_name ?? null)
      setUpdatedAt(data.bot_settings_updated_at ?? null)
      return null
    } catch {
      return 'Não foi possível salvar. Verifique a conexão e tente de novo.'
    }
  }

  return (
    <section className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
      <h3 className="mb-4 font-medium text-gray-900">{row.name}</h3>
      <WorkspaceBotSettingsForm
        idPrefix={`ws-${row.id}`}
        value={row.settings}
        onSubmit={handleSubmit}
        footer={
          updatedAt ? (
            <p className="text-xs text-gray-400">
              Última alteração por {updatedByName ?? 'alguém da equipe'} em {formatUpdatedAt(updatedAt)}
            </p>
          ) : null
        }
      />
    </section>
  )
}

// "Clara nesta unidade" em /admin — uma configuração por workspace.
export function WorkspaceBotSettingsSection({ rows }: { rows: WorkspaceBotSettingsRow[] }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-medium text-gray-900">Clara nesta unidade</h2>
        <p className="text-sm text-gray-400">
          Como a Clara atende em cada unidade. Só a equipe MedScale altera; o cliente vê um resumo em Meus locais.
        </p>
      </div>
      {rows.map((row) => (
        <WorkspaceBotSettingsCard key={row.id} row={row} />
      ))}
    </div>
  )
}
