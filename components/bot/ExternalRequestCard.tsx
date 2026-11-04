'use client'

import { useState } from 'react'
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import { ClipboardList, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ExternalRequestView {
  id: string
  /** Linhas do resumo (formatExternalRequestLines), já montadas no servidor. */
  lines: string[]
  sentAt: string
  resolvedAt: string | null
  /** Foto da carteirinha (só o id; a imagem abre por signed URL curta). */
  cardPhoto?: { id: string; isPdf: boolean } | null
}

// Resumo da solicitação de agendamento de uma unidade com agenda externa: a
// equipe confere a agenda da clínica, confirma com o paciente e marca aqui.
export function ExternalRequestCard({ request }: { request: ExternalRequestView }) {
  const [resolvedAt, setResolvedAt] = useState(request.resolvedAt)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const open = !resolvedAt

  const toggle = async () => {
    setSaving(true)
    setError(false)
    try {
      const res = await fetch(`/api/bot/external-requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: open }),
      })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setResolvedAt(data.resolved_at ?? null)
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  const sent = format(new TZDate(new Date(request.sentAt), 'America/Sao_Paulo'), "dd/MM 'às' HH:mm")

  return (
    <div
      className={cn(
        'border-b px-4 py-3 md:px-5',
        open ? 'border-amber-200 bg-amber-50/60' : 'border-[var(--navy-06)] bg-white'
      )}
    >
      <div className="flex items-start gap-3">
        <ClipboardList className={cn('mt-0.5 h-4 w-4 shrink-0', open ? 'text-amber-700' : 'text-gray-400')} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--navy)]">Solicitação de agendamento</p>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-medium',
                open ? 'bg-amber-100 text-amber-700' : 'bg-[var(--navy-06)] text-[var(--navy)]'
              )}
            >
              {open ? 'Aberta' : 'Tratada'}
            </span>
            <span className="text-[11px] text-gray-400">{sent}</span>
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-gray-700">
            {request.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {request.cardPhoto && (
            <a
              href={`/api/bot/attachments/${request.cardPhoto.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-[var(--cyan-dark)] hover:underline"
            >
              {request.cardPhoto.isPdf ? (
                <FileText className="h-4 w-4" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL privada, fora do otimizador de imagens
                <img
                  src={`/api/bot/attachments/${request.cardPhoto.id}`}
                  alt="Foto da carteirinha"
                  className="h-14 w-20 rounded border border-[var(--navy-06)] object-cover"
                />
              )}
              Abrir foto da carteirinha
            </a>
          )}
          {error && <p className="mt-1 text-[11px] text-[var(--danger-text)]">Não foi possível atualizar. Tente de novo.</p>}
        </div>
        <Button variant="outline" size="sm" onClick={toggle} disabled={saving} className="shrink-0">
          {open ? 'Marcar como tratada' : 'Reabrir'}
        </Button>
      </div>
    </div>
  )
}
