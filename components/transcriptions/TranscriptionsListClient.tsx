'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TranscriptionStatusBadge } from './TranscriptionStatusBadge'
import { Archive, ArchiveRestore } from 'lucide-react'
import type { TranscriptionStatus } from '@/types/database'

type Row = {
  id: string
  status: TranscriptionStatus
  createdAt: string
  durationSeconds: number | null
  patientName: string
  doctorName: string
  archivedAt: string | null
}

const STATUS_OPTIONS: { value: TranscriptionStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos os status' },
  { value: 'pending', label: 'Na fila' },
  { value: 'transcribing', label: 'Transcrevendo' },
  { value: 'transcribed', label: 'Transcrito' },
  { value: 'generating', label: 'Gerando prontuário' },
  { value: 'draft_ready', label: 'Aguardando revisão' },
  { value: 'signed', label: 'Assinado' },
  { value: 'error', label: 'Erro' },
]

const PERIOD_OPTIONS = [
  { value: 'all', label: 'Todo o período' },
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
]

function formatDuration(seconds: number | null) {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}min ${s}s`
}

export function TranscriptionsListClient({ rows }: { rows: Row[] }) {
  const [items, setItems] = useState(rows)
  const [status, setStatus] = useState<TranscriptionStatus | 'all'>('all')
  const [period, setPeriod] = useState('all')
  const [showArchived, setShowArchived] = useState(false)
  const [now] = useState(() => Date.now())
  const [archivingId, setArchivingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const cutoff = period === 'all' ? null : now - Number(period) * 24 * 60 * 60 * 1000
    return items.filter((r) => {
      if (!showArchived && r.archivedAt) return false
      if (status !== 'all' && r.status !== status) return false
      if (cutoff && new Date(r.createdAt).getTime() < cutoff) return false
      return true
    })
  }, [items, status, period, showArchived, now])

  async function toggleArchived(id: string, archived: boolean) {
    setArchivingId(id)
    const previous = items
    setItems((prev) =>
      prev.map((r) => (r.id === id ? { ...r, archivedAt: archived ? new Date().toISOString() : null } : r))
    )
    try {
      const res = await fetch(`/api/transcriptions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      })
      if (!res.ok) setItems(previous)
    } catch {
      setItems(previous)
    } finally {
      setArchivingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={status} onValueChange={(v) => setStatus(v as TranscriptionStatus | 'all')}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={period} onValueChange={(v) => setPeriod(v ?? 'all')}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="ml-auto flex items-center gap-2 text-sm text-gray-500">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Mostrar arquivadas
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">Nenhuma transcrição encontrada.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 text-left text-xs text-gray-400">
                <th className="px-5 py-3 font-normal">Paciente</th>
                <th className="px-5 py-3 font-normal">Médico</th>
                <th className="px-5 py-3 font-normal">Data</th>
                <th className="px-5 py-3 font-normal">Duração</th>
                <th className="px-5 py-3 font-normal">Status</th>
                <th className="px-5 py-3 font-normal" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-[var(--navy-06)] last:border-0 hover:bg-[var(--navy-06)]/40">
                  <td className="px-5 py-3">
                    <Link
                      href={`/transcricoes/${r.id}`}
                      className="font-medium text-gray-900 hover:text-[var(--cyan-dark)]"
                    >
                      {r.patientName}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-600">{r.doctorName}</td>
                  <td className="px-5 py-3 text-gray-600">
                    {new Date(r.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td className="px-5 py-3 text-gray-600">{formatDuration(r.durationSeconds)}</td>
                  <td className="px-5 py-3">
                    <TranscriptionStatusBadge status={r.status} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => toggleArchived(r.id, !r.archivedAt)}
                      disabled={archivingId === r.id}
                      title={r.archivedAt ? 'Desarquivar' : 'Arquivar'}
                      className="text-gray-300 hover:text-[var(--cyan-dark)] disabled:opacity-50"
                    >
                      {r.archivedAt ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  )
}
