'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AUTHORIZATION_STATUS_LABELS, AUTHORIZATION_TYPE_LABELS } from '@/lib/billing/authorizations/constants'
import type { ProfessionalOption } from '@/lib/billing/authorizations/payload'
import type { AuthorizationListRow, AuthorizationType } from '@/lib/billing/authorizations/types'
import { formatDate } from '../GuideEditSheet'
import type { InsurerOption } from '../PatientInsurances'
import { AuthorizationStatusBadge } from './AuthorizationStatusBadge'
import { NewAuthorizationDialog, formatProfessional } from './NewAuthorizationDialog'
import { PatientSearch, type PatientHit } from './PatientSearch'

const ALL = '__all__'

type DialogDefaults = { type?: Exclude<AuthorizationType, 'opme_request'>; appointmentId?: string }

export function AuthorizationsTable({
  insurers,
  initial,
}: {
  insurers: InsurerOption[]
  initial?: { newType?: Exclude<AuthorizationType, 'opme_request'>; appointmentId?: string; openId?: string }
}) {
  const router = useRouter()
  const [status, setStatus] = useState<string>(ALL)
  const [type, setType] = useState<string>(ALL)
  const [insurerId, setInsurerId] = useState<string>(ALL)
  const [professionalId, setProfessionalId] = useState<string>(ALL)
  const [patient, setPatient] = useState<PatientHit | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [reloadKey, setReloadKey] = useState(0)
  const [professionals, setProfessionals] = useState<ProfessionalOption[]>([])
  const [data, setData] = useState<{ authorizations: AuthorizationListRow[]; total: number; pageSize: number } | null>(
    null,
  )
  const [loadFailed, setLoadFailed] = useState(false)
  const opensDialogFromUrl = Boolean(initial?.newType && initial.appointmentId)
  const [dialogOpen, setDialogOpen] = useState(opensDialogFromUrl)
  const [dialogDefaults, setDialogDefaults] = useState<DialogDefaults | undefined>(
    opensDialogFromUrl ? { type: initial?.newType, appointmentId: initial?.appointmentId } : undefined,
  )
  // O sheet de edição entra na Tarefa 17; aqui só guardamos qual abrir.
  const [selectedId, setSelectedId] = useState<string | null>(initial?.openId ?? null)

  // Parâmetros de URL valem uma vez: limpa a query para o refresh não reabrir.
  const hadUrlParams = opensDialogFromUrl || Boolean(initial?.openId)
  useEffect(() => {
    if (hadUrlParams) router.replace('/faturamento?tab=autorizacoes')
  }, [hadUrlParams, router])

  useEffect(() => {
    let cancelled = false
    fetch('/api/billing/authorizations/professionals')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && d && setProfessionals(d.professionals ?? []))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const qs = new URLSearchParams({ page: String(page) })
    if (status !== ALL) qs.set('status', status)
    if (type !== ALL) qs.set('type', type)
    if (insurerId !== ALL) qs.set('insurer_id', insurerId)
    if (professionalId !== ALL) qs.set('professional_id', professionalId)
    if (patient) qs.set('patient_id', patient.id)
    if (from) qs.set('from', from)
    if (to) qs.set('to', to)
    fetch(`/api/billing/authorizations?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        setLoadFailed(!d)
        if (d) setData(d)
      })
      .catch(() => !cancelled && setLoadFailed(true))
    return () => {
      cancelled = true
    }
  }, [page, status, type, insurerId, professionalId, patient, from, to, reloadKey])

  const statusLabels = { [ALL]: 'Todos os status', ...AUTHORIZATION_STATUS_LABELS }
  const typeLabels = { [ALL]: 'Todos os tipos', ...AUTHORIZATION_TYPE_LABELS }
  const insurerLabels = { [ALL]: 'Todas as operadoras', ...Object.fromEntries(insurers.map((i) => [i.id, i.name])) }
  const professionalLabels = {
    [ALL]: 'Todos os profissionais',
    ...Object.fromEntries(professionals.map((p) => [p.id, formatProfessional(p)])),
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  const filterSelect = (
    label: string,
    items: Record<string, string>,
    value: string,
    set: (v: string) => void,
  ) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select
        items={items}
        value={value}
        onValueChange={(v) => {
          set(v ?? ALL)
          setPage(1)
        }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(items).map(([k, l]) => (
            <SelectItem key={k} value={k}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <div className="ph-no-capture ph-mask space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-gray-500">
          Solicitações de SP/SADT, internação e OPME enviadas às operadoras antes do atendimento.
        </p>
        <Button
          className="shrink-0"
          onClick={() => {
            setDialogDefaults(undefined)
            setDialogOpen(true)
          }}
        >
          <Plus className="mr-1 h-4 w-4" />
          Nova autorização
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {filterSelect('Status', statusLabels, status, setStatus)}
        {filterSelect('Tipo', typeLabels, type, setType)}
        {filterSelect('Operadora', insurerLabels, insurerId, setInsurerId)}
        {filterSelect('Profissional', professionalLabels, professionalId, setProfessionalId)}
        <div className="col-span-2">
          <Label htmlFor="auth_patient" className="text-xs">
            Paciente
          </Label>
          <PatientSearch
            id="auth_patient"
            value={patient}
            onChange={(p) => {
              setPatient(p)
              setPage(1)
            }}
          />
        </div>
        <div>
          <Label htmlFor="auth_from" className="text-xs">
            Solicitada de
          </Label>
          <Input
            id="auth_from"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <div>
          <Label htmlFor="auth_to" className="text-xs">
            até
          </Label>
          <Input
            id="auth_to"
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
        {loadFailed ? (
          <p className="py-10 text-center text-sm text-red-600">Não foi possível carregar as autorizações.</p>
        ) : data === null ? (
          <p className="py-10 text-center text-sm text-gray-400">Carregando…</p>
        ) : data.authorizations.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">
            Nenhuma autorização. Use &ldquo;Nova autorização&rdquo; para solicitar uma à operadora.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b border-[var(--navy-06)] text-left text-xs text-gray-400">
                  <th className="px-4 py-2.5 font-normal">Nº</th>
                  <th className="px-3 py-2.5 font-normal">Tipo</th>
                  <th className="px-3 py-2.5 font-normal">Paciente</th>
                  <th className="px-3 py-2.5 font-normal">Operadora</th>
                  <th className="px-3 py-2.5 font-normal">Profissional</th>
                  <th className="px-3 py-2.5 font-normal">Solicitada em</th>
                  <th className="px-3 py-2.5 font-normal">Status</th>
                  <th className="px-4 py-2.5 font-normal">Nº na operadora</th>
                </tr>
              </thead>
              <tbody>
                {data.authorizations.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => setSelectedId(a.id)}
                    className="cursor-pointer border-b border-[var(--navy-06)] last:border-0 hover:bg-[var(--navy-06)]/40"
                  >
                    <td className="px-4 py-2.5 text-gray-900">{a.provider_guide_number}</td>
                    <td className="px-3 py-2.5 text-gray-600">{AUTHORIZATION_TYPE_LABELS[a.type]}</td>
                    <td className="px-3 py-2.5 text-gray-900">{a.patients?.full_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{a.health_insurers?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{a.professional_name || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{formatDate(a.requested_at)}</td>
                    <td className="px-3 py-2.5">
                      <AuthorizationStatusBadge
                        status={a.status}
                        missing={a.status === 'draft' ? a.missing_fields.length : 0}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{a.operator_guide_number || '—'}</td>
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

      <NewAuthorizationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        insurers={insurers}
        defaults={dialogDefaults}
        onCreated={(id) => {
          setReloadKey((k) => k + 1)
          setSelectedId(id)
        }}
      />
      {/* Tarefa 17: AuthorizationEditSheet com authorizationId={selectedId}. */}
      <span hidden data-selected-authorization={selectedId ?? ''} />
    </div>
  )
}
