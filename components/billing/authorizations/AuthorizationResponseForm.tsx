'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { STATUS_SOLICITACAO, type StatusSolicitacao } from '@/lib/billing/authorizations/domains'
import { canRecordResponse } from '@/lib/billing/authorizations/status'
import type { AuthorizationDetail, AuthorizationStatus } from '@/lib/billing/authorizations/types'
import type { ResponseInput } from '@/lib/billing/authorizations/validation'
import { formatDate } from '../GuideEditSheet'
import { centsToInput, formatCents } from '../money'
import { CodeSelect } from './AuthorizationRequestFields'
import { buildResponseItems, type ResponseItemDraft } from './sheet-helpers'

const AWAITING: readonly AuthorizationStatus[] = ['sent', 'under_review', 'pending_info']

// Resposta da operadora digitada (D6). Aguardando resposta: formulário aberto.
// Resposta final (R1): leitura + "Corrigir resposta". Cancelada com resposta:
// só leitura.
export function AuthorizationResponseForm({
  detail,
  onSubmit,
}: {
  detail: AuthorizationDetail
  onSubmit: (body: Omit<ResponseInput, 'expected_updated_at'>) => Promise<void>
}) {
  const a = detail.authorization
  const awaiting = AWAITING.includes(a.status)
  const [editing, setEditing] = useState(awaiting)
  const recordable = canRecordResponse(a.status)

  if (!recordable && !(a.status === 'cancelled' && a.responded_at)) return null
  if (editing && recordable) {
    return <ResponseEditor detail={detail} onSubmit={onSubmit} onCancel={awaiting ? undefined : () => setEditing(false)} />
  }
  return (
    <div className="space-y-2">
      <ResponseSummary detail={detail} />
      {recordable && (
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Corrigir resposta
        </Button>
      )}
    </div>
  )
}

function ResponseSummary({ detail }: { detail: AuthorizationDetail }) {
  const a = detail.authorization
  const code = a.response_status_code
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
      <dt className="text-gray-400">Status da operadora</dt>
      <dd className="text-gray-900">{code ? `${code} — ${STATUS_SOLICITACAO[code]}` : '—'}</dd>
      <dt className="text-gray-400">Nº da guia na operadora</dt>
      <dd className="text-gray-900">{a.operator_guide_number || '—'}</dd>
      <dt className="text-gray-400">Senha</dt>
      <dd className="text-gray-900">{a.password || '—'}</dd>
      <dt className="text-gray-400">Data da autorização</dt>
      <dd className="text-gray-900">{a.authorization_date ? formatDate(a.authorization_date) : '—'}</dd>
      <dt className="text-gray-400">Validade da senha</dt>
      <dd className="text-gray-900">{a.password_valid_until ? formatDate(a.password_valid_until) : '—'}</dd>
    </dl>
  )
}

function ResponseEditor({
  detail,
  onSubmit,
  onCancel,
}: {
  detail: AuthorizationDetail
  onSubmit: (body: Omit<ResponseInput, 'expected_updated_at'>) => Promise<void>
  onCancel?: () => void
}) {
  const a = detail.authorization
  const [statusCode, setStatusCode] = useState<StatusSolicitacao | null>(a.response_status_code)
  const [operatorNumber, setOperatorNumber] = useState(a.operator_guide_number ?? '')
  const [password, setPassword] = useState(a.password ?? '')
  const [authorizationDate, setAuthorizationDate] = useState(a.authorization_date ?? '')
  const [validUntil, setValidUntil] = useState(a.password_valid_until ?? '')
  const [drafts, setDrafts] = useState<Record<string, ResponseItemDraft>>(() =>
    Object.fromEntries(
      detail.items.map((i) => [
        i.id,
        {
          quantity: i.quantity_authorized === null ? '' : String(i.quantity_authorized),
          value: i.authorized_value_cents === null ? '' : centsToInput(i.authorized_value_cents),
        },
      ]),
    ),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setDraft = (id: string, patch: Partial<ResponseItemDraft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? { quantity: '', value: '' }), ...patch } }))

  const submit = async () => {
    if (!statusCode) {
      setError('Selecione o status informado pela operadora.')
      return
    }
    const items = buildResponseItems(detail.items, drafts)
    if (!items.ok) {
      setError(items.error)
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSubmit({
        status_code: statusCode,
        operator_guide_number: operatorNumber.trim() || null,
        password: password.trim() || null,
        authorization_date: authorizationDate || null,
        password_valid_until: validUntil || null,
        items: items.value,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <CodeSelect
        label="Status informado pela operadora"
        domain={STATUS_SOLICITACAO}
        showCode
        value={statusCode}
        onChange={setStatusCode}
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="auth_r_number" className="text-xs">
            Nº da guia na operadora
          </Label>
          <Input
            id="auth_r_number"
            maxLength={20}
            value={operatorNumber}
            onChange={(e) => setOperatorNumber(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="auth_r_password" className="text-xs">
            Senha
          </Label>
          <Input id="auth_r_password" maxLength={20} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="auth_r_date" className="text-xs">
            Data da autorização
          </Label>
          <Input
            id="auth_r_date"
            type="date"
            value={authorizationDate}
            onChange={(e) => setAuthorizationDate(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="auth_r_valid" className="text-xs">
            Validade da senha
          </Label>
          <Input id="auth_r_valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>
      </div>

      {detail.items.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">Autorizado por item (deixe em branco se a operadora não informou)</p>
          {detail.items.map((i) => {
            const d = drafts[i.id] ?? { quantity: '', value: '' }
            const opme = i.kind === 'opme'
            return (
              <div key={i.id} className="grid grid-cols-6 items-end gap-2">
                <p className="col-span-3 text-xs text-gray-700">
                  {i.code} — {i.description}
                  <span className="block text-gray-400">
                    Solicitado: {i.quantity_requested}
                    {opme && i.requested_value_cents !== null ? ` · ${formatCents(i.requested_value_cents)}` : ''}
                  </span>
                </p>
                <div className={opme ? '' : 'col-span-3'}>
                  <Label className="text-xs">Qtd. autor.</Label>
                  <Input
                    inputMode="numeric"
                    maxLength={3}
                    value={d.quantity}
                    onChange={(e) => setDraft(i.id, { quantity: e.target.value })}
                  />
                </div>
                {opme && (
                  <div className="col-span-2">
                    <Label className="text-xs">Valor autor. (R$)</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="0,00"
                      value={d.value}
                      onChange={(e) => setDraft(i.id, { value: e.target.value })}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="outline" size="sm" disabled={saving} onClick={onCancel}>
            Descartar
          </Button>
        )}
        <Button size="sm" disabled={saving} onClick={submit}>
          {saving ? 'Registrando…' : 'Registrar resposta'}
        </Button>
      </div>
    </div>
  )
}
