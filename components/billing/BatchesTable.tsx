'use client'

import { useEffect, useState } from 'react'
import { Download, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GUIDE_TYPE_LABELS } from '@/lib/billing/constants'
import type { BatchStatus } from '@/lib/billing/types'
import type { TissGuideType } from '@/types/database'
import type { InsurerOption } from './PatientInsurances'
import { formatCents } from './money'
import { friendlyErrorMessage } from '@/lib/friendly-errors'

interface BatchRow {
  id: string
  insurer_id: string
  batch_number: number
  tiss_version: string
  guide_type: TissGuideType
  status: BatchStatus
  guide_count: number
  total_cents: number
  error_message: string | null
  sent_at: string | null
  created_by: string | null
  created_at: string
  health_insurers: { name: string } | null
}

const STATUS_LABELS: Record<BatchStatus, string> = { generated: 'Gerado', sent: 'Enviado', error: 'Erro' }
const STATUS_BADGE: Record<BatchStatus, string> = {
  generated: 'border-none bg-[var(--cyan-10)] text-[var(--cyan-dark)]',
  sent: 'border-none bg-green-50 text-green-700',
  error: 'border-none bg-red-50 text-red-600',
}

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })

export function BatchesTable({ insurers }: { insurers: InsurerOption[] }) {
  const [batches, setBatches] = useState<BatchRow[] | null>(null)
  const [insurerId, setInsurerId] = useState(insurers[0]?.id ?? '')
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const fetchBatches = (): Promise<BatchRow[] | null> =>
    fetch('/api/billing/batches').then((r) => (r.ok ? r.json() : null))

  useEffect(() => {
    let cancelled = false
    fetchBatches().then((rows) => !cancelled && rows && setBatches(rows))
    return () => {
      cancelled = true
    }
  }, [])

  const generate = async () => {
    if (!insurerId) return
    setGenerating(true)
    setMessage(null)
    try {
      const res = await fetch('/api/billing/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ insurer_id: insurerId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ kind: 'error', text: data.error ?? 'Não foi possível gerar o lote.' })
        return
      }
      const results = data.batches as Array<{ status: string; guideCount: number }>
      const ok = results.filter((r) => r.status === 'generated')
      const failed = results.filter((r) => r.status === 'error')
      if (results.length === 0) setMessage({ kind: 'error', text: 'Nenhuma guia pronta para esta operadora.' })
      else if (failed.length > 0)
        setMessage({ kind: 'error', text: `${failed.length} lote(s) com erro de validação — veja a mensagem na lista.` })
      else
        setMessage({
          kind: 'ok',
          text: `${ok.length} lote(s) gerado(s) com ${ok.reduce((s, r) => s + r.guideCount, 0)} guia(s).`,
        })
      const rows = await fetchBatches()
      if (rows) setBatches(rows)
    } finally {
      setGenerating(false)
    }
  }

  const download = async (b: BatchRow) => {
    setBusyId(b.id)
    try {
      const res = await fetch(`/api/billing/batches/${b.id}/download`)
      const data = await res.json()
      if (res.ok) window.location.assign(data.url)
      else setMessage({ kind: 'error', text: data.error ?? 'Não foi possível baixar o XML.' })
    } finally {
      setBusyId(null)
    }
  }

  const markSent = async (b: BatchRow) => {
    if (!confirm(`Marcar o lote ${b.batch_number} como enviado à operadora?`)) return
    setBusyId(b.id)
    try {
      const res = await fetch(`/api/billing/batches/${b.id}/sent`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) setBatches((prev) => (prev ?? []).map((x) => (x.id === b.id ? (data as BatchRow) : x)))
      else setMessage({ kind: 'error', text: data.error ?? 'Não foi possível marcar como enviado.' })
    } finally {
      setBusyId(null)
    }
  }

  const insurerLabels = Object.fromEntries(insurers.map((i) => [i.id, i.name]))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
        <div className="min-w-[200px] flex-1">
          <Label className="text-xs">Operadora</Label>
          <Select items={insurerLabels} value={insurerId} onValueChange={(v) => v && setInsurerId(v)}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {insurers.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={generate}
          disabled={generating || !insurerId}
          className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
        >
          {generating ? 'Gerando…' : 'Gerar lote agora'}
        </Button>
        <p className="w-full text-xs text-gray-400">
          Junta as guias prontas da operadora em lotes XML (TISS). Os lotes também saem sozinhos no horário
          configurado em Convênios.
        </p>
        {message && (
          <p className={message.kind === 'ok' ? 'w-full text-xs text-green-600' : 'w-full text-xs text-red-600'}>
            {message.kind === 'error' ? friendlyErrorMessage(message.text, "Não foi possível concluir esta ação com o lote. Confira os dados das guias e tente novamente.") : message.text}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        {batches === null ? (
          <p className="py-10 text-center text-sm text-gray-400">Carregando…</p>
        ) : batches.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">Nenhum lote gerado ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[var(--navy-06)] text-left text-xs text-gray-400">
                  <th className="px-4 py-2.5 font-normal">Lote</th>
                  <th className="px-3 py-2.5 font-normal">Operadora</th>
                  <th className="px-3 py-2.5 font-normal">Guias</th>
                  <th className="px-3 py-2.5 font-normal">Valor total</th>
                  <th className="px-3 py-2.5 font-normal">Gerado em</th>
                  <th className="px-3 py-2.5 font-normal">Status</th>
                  <th className="px-4 py-2.5 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-b border-[var(--navy-06)] align-top last:border-0">
                    <td className="px-4 py-2.5 text-gray-900">
                      {b.batch_number}
                      <span className="ml-1.5 text-xs text-gray-400">
                        {GUIDE_TYPE_LABELS[b.guide_type]} · TISS {b.tiss_version}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{b.health_insurers?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{b.guide_count}</td>
                    <td className="px-3 py-2.5 text-gray-600">{formatCents(b.total_cents)}</td>
                    <td className="px-3 py-2.5 text-gray-600">
                      {formatDateTime(b.created_at)}
                      <span className="block text-xs text-gray-400">{b.created_by ? 'Manual' : 'Automático'}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge className={STATUS_BADGE[b.status]}>{STATUS_LABELS[b.status]}</Badge>
                      {b.status === 'sent' && b.sent_at && (
                        <span className="block pt-1 text-xs text-gray-400">{formatDateTime(b.sent_at)}</span>
                      )}
                      {b.status === 'error' && b.error_message && (
                        <p className="max-w-xs whitespace-pre-line pt-1 text-xs text-red-600">{friendlyErrorMessage(b.error_message, "Não foi possível concluir esta ação com o lote. Confira os dados das guias e tente novamente.")}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {b.status !== 'error' && (
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busyId === b.id}
                            onClick={() => download(b)}
                            className="gap-1"
                          >
                            <Download className="h-3.5 w-3.5" />
                            XML
                          </Button>
                          {b.status === 'generated' && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busyId === b.id}
                              onClick={() => markSent(b)}
                              className="gap-1"
                            >
                              <Send className="h-3.5 w-3.5" />
                              Enviado
                            </Button>
                          )}
                        </div>
                      )}
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
