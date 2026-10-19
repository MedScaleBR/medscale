'use client'

import { useEffect, useState } from 'react'
import { AUTHORIZATION_STATUS_LABELS } from '@/lib/billing/authorizations/constants'
import type { ProfessionalOption } from '@/lib/billing/authorizations/payload'
import type { AuthorizationEventRow, AuthorizationEventType } from '@/lib/billing/authorizations/types'

export const AUTHORIZATION_EVENT_LABELS: Record<AuthorizationEventType, string> = {
  created: 'Criada',
  updated: 'Editada',
  items_changed: 'Itens alterados',
  refreshed: 'Dados recarregados',
  ready: 'Pronta para envio',
  sent: 'Marcada como enviada',
  response_recorded: 'Resposta registrada',
  cancelled: 'Cancelada',
  xml_generated: 'XML gerado',
}

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })

// Histórico. O autor só tem nome quando é um dos profissionais listados
// (profiles é privado por RLS); senão "Equipe". O payload do evento (senha,
// número, hash) não vem nesta resposta.
export function AuthorizationTimeline({
  authorizationId,
  professionals,
  refreshKey,
}: {
  authorizationId: string
  professionals: ProfessionalOption[]
  refreshKey: number
}) {
  // Mantém a lista anterior enquanto recarrega (refreshKey muda após cada ação).
  const [state, setState] = useState<{ events: AuthorizationEventRow[] | null; failed: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/billing/authorizations/${authorizationId}/events`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { events?: AuthorizationEventRow[] } | null) => {
        if (!cancelled) setState({ events: d?.events ?? null, failed: d === null })
      })
      .catch(() => !cancelled && setState({ events: null, failed: true }))
    return () => {
      cancelled = true
    }
  }, [authorizationId, refreshKey])

  const names = new Map(professionals.map((p) => [p.id, p.full_name]))
  if (state?.failed) return <p className="text-xs text-red-600">Não foi possível carregar o histórico.</p>
  if (!state?.events) return <p className="text-xs text-gray-400">Carregando…</p>
  if (state.events.length === 0) return <p className="text-xs text-gray-400">Sem eventos.</p>

  return (
    <ol className="space-y-2 border-l border-[var(--navy-06)] pl-3">
      {state.events.map((e) => (
        <li key={e.id} className="text-xs">
          <p className="text-gray-900">
            {AUTHORIZATION_EVENT_LABELS[e.event] ?? e.event}
            {e.from_status && e.to_status && e.from_status !== e.to_status && (
              <span className="text-gray-500">
                {' '}
                · {AUTHORIZATION_STATUS_LABELS[e.from_status]} → {AUTHORIZATION_STATUS_LABELS[e.to_status]}
              </span>
            )}
            {!e.from_status && e.to_status && e.event === 'created' && (
              <span className="text-gray-500"> · {AUTHORIZATION_STATUS_LABELS[e.to_status]}</span>
            )}
          </p>
          <p className="text-gray-400">
            {formatDateTime(e.created_at)} · {(e.actor_id && names.get(e.actor_id)) || 'Equipe'}
          </p>
        </li>
      ))}
    </ol>
  )
}
