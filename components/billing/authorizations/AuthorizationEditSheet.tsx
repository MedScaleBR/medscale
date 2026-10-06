'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, Download, Info, Plus, RefreshCw, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import {
  AUTHORIZATION_MISSING_LABELS, AUTHORIZATION_SETTINGS_FIELDS, AUTHORIZATION_TYPE_LABELS,
} from '@/lib/billing/authorizations/constants'
import type { ProfessionalOption } from '@/lib/billing/authorizations/payload'
import { canCancel, canMarkSent, canRecordResponse, isEditable } from '@/lib/billing/authorizations/status'
import type {
  AnyAuthorizationPayload, AuthorizationDetail, AuthorizationMissingField, AuthorizationType, RequestDataByType,
} from '@/lib/billing/authorizations/types'
import { friendlyErrorMessage } from '@/lib/friendly-errors'
import { formatDate } from '../GuideEditSheet'
import type { InsurerOption, PatientInsuranceRow } from '../PatientInsurances'
import { AuthorizationItemsEditor } from './AuthorizationItemsEditor'
import { AuthorizationRequestFields, MISSING_HIGHLIGHT } from './AuthorizationRequestFields'
import { AuthorizationResponseForm } from './AuthorizationResponseForm'
import { AuthorizationStatusBadge } from './AuthorizationStatusBadge'
import { AuthorizationTimeline } from './AuthorizationTimeline'
import { formatProfessional } from './NewAuthorizationDialog'
import { buildRequestPatch, fileNameFromDisposition, phoneDigits } from './sheet-helpers'

type Busy = 'save' | 'refresh' | 'items' | 'sent' | 'cancel' | 'response' | 'xml' | 'opme'
type Message = { kind: 'error' | 'info'; text: string; list?: string[] }
type RequestState = { [K in AuthorizationType]: { type: K; value: RequestDataByType[K] } }[AuthorizationType]

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const LOAD_ERROR = 'Não foi possível carregar a autorização.'
const CONFLICT_FALLBACK = 'A autorização foi alterada por outra pessoa.'
const RELOADED = 'Carregamos os dados mais recentes; revise e tente de novo.'
const TYPED = '__typed__'
const NONE = '__none__'

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null)
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
// As rotas de autorização devolvem mensagens fixas, sem dados do paciente.
const errorOf = (data: unknown): string | null => (isRecord(data) && typeof data.error === 'string' ? data.error : null)
const errorsOf = (data: unknown): string[] | undefined =>
  isRecord(data) && Array.isArray(data.errors) ? data.errors.filter((e): e is string => typeof e === 'string') : undefined
const isDetail = (data: unknown): data is AuthorizationDetail =>
  isRecord(data) && isRecord(data.authorization) && Array.isArray(data.items)

function requestStateOf(payload: AnyAuthorizationPayload): RequestState {
  switch (payload.type) {
    case 'sp_sadt_request':
      return { type: payload.type, value: payload.request }
    case 'hospitalization_request':
      return { type: payload.type, value: payload.request }
    case 'opme_request':
      return { type: payload.type, value: payload.request }
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">{title}</h3>
      {children}
    </section>
  )
}

// Sheet de detalhe/edição de uma autorização. Toda mutação manda o
// updated_at exatamente como veio da API (string, sem new Date()); 409 →
// recarrega o detalhe e avisa.
export function AuthorizationEditSheet({
  authorizationId,
  insurers,
  professionals,
  onOpenChange,
  onChanged,
  onOpenAuthorization,
}: {
  authorizationId: string | null
  insurers: InsurerOption[]
  professionals: ProfessionalOption[]
  onOpenChange: (open: boolean) => void
  onChanged: () => void
  onOpenAuthorization: (id: string) => void
}) {
  return (
    <Sheet open={authorizationId !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="ph-no-capture ph-mask w-full overflow-y-auto sm:max-w-2xl">
        {authorizationId && (
          <AuthorizationEditor
            key={authorizationId}
            id={authorizationId}
            insurers={insurers}
            professionals={professionals}
            onChanged={onChanged}
            onOpenAuthorization={onOpenAuthorization}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function AuthorizationEditor({
  id,
  insurers,
  professionals,
  onChanged,
  onOpenAuthorization,
}: {
  id: string
  insurers: InsurerOption[]
  professionals: ProfessionalOption[]
  onChanged: () => void
  onOpenAuthorization: (id: string) => void
}) {
  const [detail, setDetail] = useState<AuthorizationDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [timelineKey, setTimelineKey] = useState(0)

  const fetchDetail = useCallback(async (): Promise<AuthorizationDetail | string> => {
    try {
      const res = await fetch(`/api/billing/authorizations/${id}`)
      const data = await readJson(res)
      if (res.ok && isDetail(data)) return data
      return errorOf(data) ?? LOAD_ERROR
    } catch {
      return LOAD_ERROR
    }
  }, [id])

  useEffect(() => {
    let cancelled = false
    fetchDetail().then((r) => {
      if (cancelled) return
      if (typeof r === 'string') setLoadError(r)
      else setDetail(r)
    })
    return () => {
      cancelled = true
    }
  }, [fetchDetail])

  const reload = async () => {
    const r = await fetchDetail()
    if (typeof r !== 'string') setDetail(r)
    setTimelineKey((k) => k + 1)
  }

  const mutate = async (
    kind: Busy,
    path: string,
    method: 'PATCH' | 'PUT' | 'POST',
    body: Record<string, unknown>,
  ): Promise<boolean> => {
    if (!detail) return false
    setBusy(kind)
    setMessage(null)
    try {
      const res = await fetch(`/api/billing/authorizations/${id}${path}`, {
        method,
        headers: JSON_HEADERS,
        // Exatamente a string recebida da API: new Date() perderia os microssegundos.
        body: JSON.stringify({ ...body, expected_updated_at: detail.authorization.updated_at }),
      })
      const data = await readJson(res)
      if (res.ok) {
        if (isDetail(data)) {
          setDetail(data)
          setTimelineKey((k) => k + 1)
        } else {
          await reload()
        }
        onChanged()
        return true
      }
      if (res.status === 409) {
        setMessage({ kind: 'error', text: `${errorOf(data) ?? CONFLICT_FALLBACK} ${RELOADED}` })
        await reload()
        onChanged()
        return false
      }
      setMessage({ kind: 'error', text: errorOf(data) ?? 'Não foi possível concluir a operação.' })
      return false
    } catch (e) {
      setMessage({ kind: 'error', text: friendlyErrorMessage(e) })
      return false
    } finally {
      setBusy(null)
    }
  }

  const downloadXml = async () => {
    if (!detail) return
    setBusy('xml')
    setMessage(null)
    try {
      const res = await fetch(`/api/billing/authorizations/${id}/xml`)
      if (res.ok) {
        const blob = await res.blob()
        const name =
          fileNameFromDisposition(res.headers.get('Content-Disposition')) ??
          `autorizacao-${detail.authorization.provider_guide_number}.xml`
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = name
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setTimelineKey((k) => k + 1)
        return
      }
      const data = await readJson(res)
      setMessage({ kind: 'error', text: errorOf(data) ?? 'Não foi possível gerar o XML.', list: errorsOf(data) })
      if (res.status === 409) await reload()
    } catch (e) {
      setMessage({ kind: 'error', text: friendlyErrorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const addOpme = async () => {
    setBusy('opme')
    setMessage(null)
    try {
      const res = await fetch('/api/billing/authorizations', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ type: 'opme_request', parent_id: id }),
      })
      const data = await readJson(res)
      const newId = isRecord(data) && typeof data.id === 'string' ? data.id : null
      if (res.ok && newId) {
        onChanged()
        onOpenAuthorization(newId)
        return
      }
      setMessage({ kind: 'error', text: errorOf(data) ?? 'Não foi possível criar o anexo OPME.' })
    } catch (e) {
      setMessage({ kind: 'error', text: friendlyErrorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  if (!detail) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>Autorização</SheetTitle>
          <SheetDescription>{loadError ? '' : 'Carregando…'}</SheetDescription>
        </SheetHeader>
        {loadError && <p className="px-4 text-sm text-red-600">{loadError}</p>}
      </>
    )
  }

  const a = detail.authorization
  const editable = isEditable(a.status)
  const missing = editable ? (a.missing_fields as AuthorizationMissingField[]) : []
  const settingsMissing = AUTHORIZATION_SETTINGS_FIELDS.filter((f) => missing.includes(f))
  const activeOpme = detail.children.filter((c) => c.status !== 'cancelled')
  const parent = detail.parent
  const insurerName = a.health_insurers?.name ?? insurers.find((i) => i.id === a.insurer_id)?.name ?? 'Operadora'

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {AUTHORIZATION_TYPE_LABELS[a.type]} · Nº {a.provider_guide_number}
        </SheetTitle>
        <SheetDescription>
          <AuthorizationStatusBadge status={a.status} missing={a.status === 'draft' ? a.missing_fields.length : 0} />
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-5 px-4 pb-4">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-gray-400">Paciente</dt>
          <dd className="text-gray-900">{a.patients?.full_name ?? '—'}</dd>
          <dt className="text-gray-400">Operadora</dt>
          <dd className="text-gray-900">{insurerName}</dd>
          {a.sent_at && (
            <>
              <dt className="text-gray-400">Enviada em</dt>
              <dd className="text-gray-900">{formatDate(a.sent_at.slice(0, 10))}</dd>
            </>
          )}
        </dl>

        {parent && (
          <button
            type="button"
            className="text-xs text-[var(--navy)] underline"
            onClick={() => onOpenAuthorization(parent.id)}
          >
            Guia de origem nº {parent.provider_guide_number}
          </button>
        )}

        {a.type !== 'opme_request' && (
          <Section title="Anexos OPME">
            {detail.children.length === 0 ? (
              <p className="text-xs text-gray-400">Nenhum anexo OPME.</p>
            ) : (
              <ul className="space-y-1">
                {detail.children.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      className="text-[var(--navy)] underline"
                      onClick={() => onOpenAuthorization(c.id)}
                    >
                      OPME nº {c.provider_guide_number}
                    </button>
                    <AuthorizationStatusBadge status={c.status} missing={c.status === 'draft' ? c.missing_fields.length : 0} />
                  </li>
                ))}
              </ul>
            )}
            {activeOpme.length >= 2 && (
              <p className="flex items-start gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Com mais de um anexo, nenhum vai embutido; envie cada OPME pelo próprio XML.
              </p>
            )}
            {a.status !== 'cancelled' && (
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={addOpme}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {busy === 'opme' ? 'Criando…' : 'Adicionar OPME'}
              </Button>
            )}
          </Section>
        )}

        {missing.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              Faltam dados para a autorização ficar pronta
            </p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
              {missing.map((f) => (
                <li key={f}>{AUTHORIZATION_MISSING_LABELS[f] ?? f}</li>
              ))}
            </ul>
            {settingsMissing.length > 0 && (
              <p className="mt-2">
                Dados da unidade e do profissional se corrigem nas{' '}
                <Link href="/configuracoes" className="underline">
                  configurações
                </Link>{' '}
                (perfil e unidade); depois use “Recarregar dados”.
              </p>
            )}
          </div>
        )}

        {message && (
          <div
            className={`rounded-lg px-3 py-2 text-xs ${message.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-800'}`}
          >
            <p>{message.text}</p>
            {message.list && message.list.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {message.list.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <ContentForm
          key={`${JSON.stringify(a.payload)}|${a.requested_at}|${editable}`}
          detail={detail}
          professionals={professionals}
          editable={editable}
          missing={new Set(missing)}
          saving={busy === 'save'}
          disabled={busy !== null}
          onSave={(body) => mutate('save', '', 'PATCH', body)}
        />

        <Section title={a.type === 'opme_request' ? 'Materiais' : 'Procedimentos'}>
          <AuthorizationItemsEditor
            key={`${detail.items.map((i) => i.id).join(',')}|${editable}`}
            type={a.type}
            insurerId={a.insurer_id}
            items={detail.items}
            editable={editable}
            onSave={async (items) => {
              await mutate('items', '/items', 'PUT', { items })
            }}
          />
        </Section>

        {(canRecordResponse(a.status) || (a.status === 'cancelled' && a.responded_at)) && (
          <Section title="Resposta da operadora">
            <AuthorizationResponseForm
              key={a.updated_at}
              detail={detail}
              onSubmit={async (body) => {
                await mutate('response', '/response', 'POST', body)
              }}
            />
          </Section>
        )}

        <Section title="Histórico">
          <AuthorizationTimeline authorizationId={id} professionals={professionals} refreshKey={timelineKey} />
        </Section>
      </div>

      <SheetFooter className="flex-row flex-wrap justify-between gap-2 border-t border-[var(--navy-06)]">
        <div className="flex flex-wrap gap-2">
          {canCancel(a.status) && (
            <Button
              variant="ghost"
              className="text-red-600 hover:text-red-700"
              disabled={busy !== null}
              onClick={() => {
                if (confirm('Cancelar esta autorização? Ela não poderá mais ser editada nem enviada.')) {
                  void mutate('cancel', '/transitions', 'POST', { to: 'cancelled' })
                }
              }}
            >
              {busy === 'cancel' ? 'Cancelando…' : 'Cancelar autorização'}
            </Button>
          )}
          {editable && (
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={busy !== null}
              onClick={() => void mutate('refresh', '', 'PATCH', { action: 'refresh' })}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {busy === 'refresh' ? 'Recarregando…' : 'Recarregar dados'}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {a.status !== 'draft' && (
            <Button variant="outline" className="gap-1.5" disabled={busy !== null} onClick={downloadXml}>
              <Download className="h-3.5 w-3.5" />
              {busy === 'xml' ? 'Gerando…' : 'Baixar XML'}
            </Button>
          )}
          {canMarkSent(a.status) && (
            <Button
              className="gap-1.5 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
              disabled={busy !== null}
              onClick={() => {
                if (confirm('Marcar como enviada à operadora? Depois disso a autorização não pode mais ser editada.')) {
                  void mutate('sent', '/transitions', 'POST', { to: 'sent' })
                }
              }}
            >
              <Send className="h-3.5 w-3.5" />
              {busy === 'sent' ? 'Marcando…' : 'Marcar como enviada'}
            </Button>
          )}
        </div>
      </SheetFooter>
    </>
  )
}

// Data da solicitação, beneficiário, profissional e pedido clínico: um único
// PATCH com só o que mudou.
function ContentForm({
  detail,
  professionals,
  editable,
  missing,
  saving,
  disabled,
  onSave,
}: {
  detail: AuthorizationDetail
  professionals: ProfessionalOption[]
  editable: boolean
  missing: Set<string>
  saving: boolean
  disabled: boolean
  onSave: (body: Record<string, unknown>) => Promise<boolean>
}) {
  const a = detail.authorization
  const p = a.payload
  const opme = a.type === 'opme_request'
  const originalCardKey = p.beneficiary.patient_insurance_id ?? TYPED
  const originalProfessional = p.professional.id ?? NONE

  const [requestedAt, setRequestedAt] = useState(a.requested_at)
  const [cardKey, setCardKey] = useState(originalCardKey)
  const [cardNumber, setCardNumber] = useState(p.beneficiary.card_number ?? '')
  const [newborn, setNewborn] = useState(p.beneficiary.newborn)
  const [professionalId, setProfessionalId] = useState(originalProfessional)
  const [phone, setPhone] = useState(p.professional.phone ?? '')
  const [email, setEmail] = useState(p.professional.email ?? '')
  const [request, setRequest] = useState<RequestState>(() => requestStateOf(p))
  const [cards, setCards] = useState<PatientInsuranceRow[] | null>(null)
  const [cardsFailed, setCardsFailed] = useState(false)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    if (!editable) return
    let cancelled = false
    fetch(`/api/billing/patients/${a.patient_id}/insurances`)
      .then((r) => (r.ok ? r.json() : null))
      .then((rows: PatientInsuranceRow[] | null) => {
        if (cancelled) return
        setCardsFailed(rows === null)
        setCards((rows ?? []).filter((r) => r.insurer_id === a.insurer_id))
      })
      .catch(() => !cancelled && setCardsFailed(true))
    return () => {
      cancelled = true
    }
  }, [editable, a.patient_id, a.insurer_id])

  const professionalChanged = professionalId !== originalProfessional
  const pickProfessional = (v: string) => {
    setProfessionalId(v)
    if (v === originalProfessional) {
      setPhone(p.professional.phone ?? '')
      setEmail(p.professional.email ?? '')
    } else {
      setPhone('')
      setEmail('')
    }
  }

  const save = async () => {
    const body: Record<string, unknown> = {}
    if (requestedAt && requestedAt !== a.requested_at) body.requested_at = requestedAt
    if (cardKey !== originalCardKey) {
      if (cardKey === TYPED) {
        body.patient_insurance_id = null
        body.card_number = cardNumber
      } else {
        body.patient_insurance_id = cardKey
      }
    } else if (cardKey === TYPED && cardNumber.trim() !== (p.beneficiary.card_number ?? '')) {
      body.card_number = cardNumber
    }
    if (newborn !== p.beneficiary.newborn) body.newborn = newborn
    const typedPhone = phoneDigits(phone)
    const typedEmail = email.trim() || null
    if (professionalChanged) {
      body.professional_id = professionalId === NONE ? null : professionalId
      // Troca de profissional limpa telefone/e-mail no servidor; reenviados no mesmo PATCH.
      body.professional_phone = typedPhone
      body.professional_email = typedEmail
    } else {
      if (typedPhone !== (p.professional.phone ?? null)) body.professional_phone = typedPhone
      if (typedEmail !== (p.professional.email ?? null)) body.professional_email = typedEmail
    }
    const requestPatch = buildRequestPatch(p.request, request.value)
    if (requestPatch) body.request = requestPatch

    if (Object.keys(body).length === 0) {
      setInfo('Nenhuma alteração para salvar.')
      return
    }
    setInfo(null)
    await onSave(body)
  }

  const cardLabels: Record<string, string> = {
    ...Object.fromEntries(
      (cards ?? []).map((c) => [c.id, `${c.card_number}${c.plan_name ? ` · ${c.plan_name}` : ''}`]),
    ),
    ...(originalCardKey !== TYPED && !(cards ?? []).some((c) => c.id === originalCardKey)
      ? { [originalCardKey]: p.beneficiary.card_number ?? 'Carteirinha cadastrada' }
      : {}),
    [TYPED]: 'Digitar carteirinha',
  }
  const selectedCard = cards?.find((c) => c.id === cardKey)
  const professionalLabels: Record<string, string> = {
    [NONE]: 'Sem profissional',
    ...(originalProfessional !== NONE && !professionals.some((x) => x.id === originalProfessional)
      ? { [originalProfessional]: p.professional.name || 'Profissional atual' }
      : {}),
    ...Object.fromEntries(professionals.map((x) => [x.id, formatProfessional(x)])),
  }

  const renderRequest = () => {
    switch (request.type) {
      case 'sp_sadt_request':
        return (
          <AuthorizationRequestFields
            type={request.type}
            value={request.value}
            editable={editable}
            missing={missing}
            onChange={(value) => setRequest({ type: 'sp_sadt_request', value })}
          />
        )
      case 'hospitalization_request':
        return (
          <AuthorizationRequestFields
            type={request.type}
            value={request.value}
            editable={editable}
            missing={missing}
            onChange={(value) => setRequest({ type: 'hospitalization_request', value })}
          />
        )
      case 'opme_request':
        return (
          <AuthorizationRequestFields
            type={request.type}
            value={request.value}
            editable={editable}
            missing={missing}
            onChange={(value) => setRequest({ type: 'opme_request', value })}
          />
        )
    }
  }

  return (
    <div className="space-y-5">
      <Section title="Beneficiário">
        <div className="grid grid-cols-2 gap-3">
          {editable ? (
            <div>
              <Label className="text-xs">Carteirinha</Label>
              <Select items={cardLabels} value={cardKey} onValueChange={(v) => v && setCardKey(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(cardLabels).map(([k, l]) => (
                    <SelectItem key={k} value={k}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {cardsFailed && (
                <p className="mt-1 text-xs text-red-600">Não foi possível carregar as carteirinhas do paciente.</p>
              )}
            </div>
          ) : null}
          <div className={editable ? '' : 'col-span-2'}>
            <Label htmlFor="auth_card" className="text-xs">
              Número da carteirinha
            </Label>
            <Input
              id="auth_card"
              maxLength={20}
              disabled={!editable || cardKey !== TYPED}
              className={missing.has('beneficiary.card_number') ? MISSING_HIGHLIGHT : ''}
              value={cardKey === TYPED ? cardNumber : (selectedCard?.card_number ?? p.beneficiary.card_number ?? '')}
              onChange={(e) => setCardNumber(e.target.value)}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <Switch checked={newborn} disabled={!editable} onCheckedChange={setNewborn} />
          Atendimento a RN
        </label>
        <div className="max-w-[200px]">
          <Label htmlFor="auth_requested_at" className="text-xs">
            Data da solicitação
          </Label>
          <Input
            id="auth_requested_at"
            type="date"
            disabled={!editable}
            value={requestedAt}
            onChange={(e) => setRequestedAt(e.target.value)}
          />
        </div>
      </Section>

      <Section title="Profissional solicitante">
        <Select
          items={professionalLabels}
          value={professionalId}
          disabled={!editable}
          onValueChange={(v) => v && pickProfessional(v)}
        >
          <SelectTrigger className={`w-full ${missing.has('professional.name') ? MISSING_HIGHLIGHT : ''}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(professionalLabels).map(([k, l]) => (
              <SelectItem key={k} value={k}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!professionalChanged && p.professional.name && (
          <p className="text-xs text-gray-500">
            {p.professional.crm ? `CRM ${p.professional.crm}${p.professional.crm_uf ? `/${p.professional.crm_uf}` : ''}` : 'Sem CRM'}
            {p.professional.cbo_code ? ` · CBO ${p.professional.cbo_code}` : ''}
          </p>
        )}
        {opme && (
          <>
            {professionalChanged && editable && (
              <p className="text-xs text-amber-700">
                O profissional mudou: telefone e e-mail foram limpos. Digite os do novo solicitante antes de salvar.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="auth_phone" className="text-xs">
                  Telefone (DDD + número)
                </Label>
                <Input
                  id="auth_phone"
                  type="tel"
                  maxLength={20}
                  disabled={!editable}
                  placeholder="(11) 98765-4321"
                  className={missing.has('professional.phone') ? MISSING_HIGHLIGHT : ''}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="auth_email" className="text-xs">
                  E-mail (opcional)
                </Label>
                <Input
                  id="auth_email"
                  type="email"
                  maxLength={60}
                  disabled={!editable}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
          </>
        )}
      </Section>

      <Section title={opme ? 'Anexo OPME' : 'Solicitação'}>{renderRequest()}</Section>

      {editable && (
        <div className="flex items-center justify-end gap-3">
          {info && <span className="text-xs text-gray-500">{info}</span>}
          <Button
            onClick={save}
            disabled={disabled}
            className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      )}
    </div>
  )
}
