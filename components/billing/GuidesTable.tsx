'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { GuideStatus } from '@/lib/billing/types'
import { GuideEditSheet, GUIDE_STATUS_LABELS, formatDate, type GuideRow } from './GuideEditSheet'
import type { InsurerOption } from './PatientInsurances'
import { formatCents } from './money'

const ALL = '__all__'

export const STATUS_BADGE: Record<GuideStatus, string> = {
  draft: 'border-none bg-amber-50 text-amber-700',
  ready: 'border-none bg-[var(--cyan-10)] text-[var(--cyan-dark)]',
  batched: 'border-none bg-[var(--navy-06)] text-[var(--navy)]',
  sent: 'border-none bg-green-50 text-green-700',
  cancelled: 'border-none bg-gray-100 text-gray-400',
}

export function GuidesTable({ insurers }: { insurers: InsurerOption[] }) {
  const [status, setStatus] = useState<string>(ALL)
  const [insurerId, setInsurerId] = useState<string>(ALL)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ guides: GuideRow[]; total: number; pageSize: number } | null>(null)
  const [selected, setSelected] = useState<GuideRow | null>(null)

  useEffect(() => {
    let cancelled = false
    const qs = new URLSearchParams({ page: String(page) })
    if (status !== ALL) qs.set('status', status)
    if (insurerId !== ALL) qs.set('insurer_id', insurerId)
    if (from) qs.set('from', from)
    if (to) qs.set('to', to)
    fetch(`/api/billing/guides?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && d && setData(d))
    return () => {
      cancelled = true
    }
  }, [page, status, insurerId, from, to])

  const statusLabels = { [ALL]: 'Todos os status', ...GUIDE_STATUS_LABELS }
  const insurerLabels = { [ALL]: 'Todas as operadoras', ...Object.fromEntries(insurers.map((i) => [i.id, i.name])) }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  const onSaved = (saved: GuideRow) => {
    setData((d) => (d ? { ...d, guides: d.guides.map((g) => (g.id === saved.id ? saved : g)) } : d))
    setSelected((s) => (s && s.id === saved.id && saved.status !== 'cancelled' ? saved : s))
  }

  return (
    <div className="ph-no-capture ph-mask space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <Label className="text-xs">Status</Label>
          <Select
            items={statusLabels}
            value={status}
            onValueChange={(v) => {
              setStatus(v ?? ALL)
              setPage(1)
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(statusLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Operadora</Label>
          <Select
            items={insurerLabels}
            value={insurerId}
            onValueChange={(v) => {
              setInsurerId(v ?? ALL)
              setPage(1)
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(insurerLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="guides_from" className="text-xs">
            Atendimento de
          </Label>
          <Input
            id="guides_from"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <div>
          <Label htmlFor="guides_to" className="text-xs">
            até
          </Label>
          <Input
            id="guides_to"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value)
              setPage(1)
            }}
          />
        </div>
      </div>

      <div className="rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        {data === null ? (
          <p className="py-10 text-center text-sm text-gray-400">Carregando…</p>
        ) : data.guides.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">
            Nenhuma guia. As guias nascem quando uma consulta de convênio é marcada como realizada.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-[var(--navy-06)] text-left text-xs text-gray-400">
                  <th className="px-4 py-2.5 font-normal">Paciente</th>
                  <th className="px-3 py-2.5 font-normal">Médico</th>
                  <th className="px-3 py-2.5 font-normal">Operadora</th>
                  <th className="px-3 py-2.5 font-normal">Procedimento</th>
                  <th className="px-3 py-2.5 font-normal">Valor</th>
                  <th className="px-3 py-2.5 font-normal">Data</th>
                  <th className="px-4 py-2.5 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.guides.map((g) => (
                  <tr
                    key={g.id}
                    onClick={() => setSelected(g)}
                    className="cursor-pointer border-b border-[var(--navy-06)] last:border-0 hover:bg-[var(--navy-06)]/40"
                  >
                    <td className="px-4 py-2.5 text-gray-900">{g.payload.beneficiary.name}</td>
                    <td className="px-3 py-2.5 text-gray-600">{g.payload.professional.name || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{g.health_insurers?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">
                      {g.payload.service.tuss_code ? (
                        <span title={g.payload.service.description ?? undefined}>{g.payload.service.tuss_code}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{formatCents(g.total_cents)}</td>
                    <td className="px-3 py-2.5 text-gray-600">{formatDate(g.service_date)}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-1.5">
                        <Badge className={STATUS_BADGE[g.status]}>{GUIDE_STATUS_LABELS[g.status]}</Badge>
                        {g.status === 'draft' && g.missing_fields.length > 0 && (
                          <span
                            className="flex items-center gap-0.5 text-xs text-amber-700"
                            title={`${g.missing_fields.length} campo(s) faltando`}
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {g.missing_fields.length}
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-gray-500">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <span>
            Página {page} de {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Próxima
          </Button>
        </div>
      )}

      <GuideEditSheet guide={selected} onOpenChange={(open) => !open && setSelected(null)} onSaved={onSaved} />
    </div>
  )
}
