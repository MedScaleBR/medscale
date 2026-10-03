'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { GUIDE_TYPE_LABELS, MISSING_FIELD_LABELS, SETTINGS_FIELDS } from '@/lib/billing/constants'
import type { GuidePayload, GuideStatus, MissingField } from '@/lib/billing/types'
import type { TissGuideType } from '@/types/database'
import { formatCents } from './money'
import { friendlyErrorMessage } from '@/lib/friendly-errors'

export interface GuideRow {
  id: string
  appointment_id: string
  insurer_id: string
  batch_id: string | null
  guide_type: TissGuideType
  provider_guide_number: string
  status: GuideStatus
  payload: GuidePayload
  missing_fields: string[]
  total_cents: number
  service_date: string
  health_insurers: { name: string } | null
}

export const GUIDE_STATUS_LABELS: Record<GuideStatus, string> = {
  draft: 'Rascunho',
  ready: 'Pronta',
  batched: 'Em lote',
  sent: 'Enviada',
  cancelled: 'Cancelada',
}

interface ProcedureOption {
  id: string
  tuss_code: string
  description: string
  price_cents: number
  guide_type: TissGuideType
}

const KEEP = '__keep__'

export const formatDate = (d: string) => d.split('-').reverse().join('/')

// Detalhe/edição de uma guia. Rascunho mostra os campos faltantes em
// destaque; 'draft'/'ready' editam carteirinha, autorização, CID e TUSS;
// 'batched'/'sent'/'cancelled' são somente leitura.
export function GuideEditSheet({
  guide,
  onOpenChange,
  onSaved,
}: {
  guide: GuideRow | null
  onOpenChange: (open: boolean) => void
  onSaved: (guide: GuideRow) => void
}) {
  return (
    <Sheet open={guide !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="ph-no-capture ph-mask w-full overflow-y-auto sm:max-w-md">
        {guide && <GuideEditor key={guide.id} guide={guide} onSaved={onSaved} onClose={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function GuideEditor({ guide, onSaved, onClose }: { guide: GuideRow; onSaved: (g: GuideRow) => void; onClose: () => void }) {
  const editable = guide.status === 'draft' || guide.status === 'ready'
  const p = guide.payload
  const [form, setForm] = useState({
    card_number: p.beneficiary.card_number ?? '',
    authorization_number: p.service.authorization_number ?? '',
    authorization_date: p.service.authorization_date ?? '',
    cid10: p.service.cid10 ?? '',
    insurer_procedure_id: KEEP,
  })
  const [procedures, setProcedures] = useState<ProcedureOption[]>([])
  const [busy, setBusy] = useState<null | 'save' | 'refresh' | 'cancel'>(null)
  const [error, setError] = useState<string | null>(null)
  const missing = new Set(guide.missing_fields as MissingField[])

  useEffect(() => {
    if (!editable) return
    let cancelled = false
    fetch(`/api/billing/insurers/${guide.insurer_id}/procedures`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: ProcedureOption[]) => !cancelled && setProcedures(rows))
    return () => {
      cancelled = true
    }
  }, [editable, guide.insurer_id])

  const send = async (kind: 'save' | 'refresh' | 'cancel', body: Record<string, unknown>) => {
    setBusy(kind)
    setError(null)
    try {
      const res = await fetch(`/api/billing/guides/${guide.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao salvar a guia.')
        return
      }
      onSaved(data as GuideRow)
      if (kind === 'cancel') onClose()
    } finally {
      setBusy(null)
    }
  }

  const save = () =>
    send('save', {
      card_number: form.card_number,
      authorization_number: form.authorization_number,
      authorization_date: form.authorization_date || null,
      cid10: form.cid10,
      ...(form.insurer_procedure_id !== KEEP ? { insurer_procedure_id: form.insurer_procedure_id } : {}),
    })

  const highlight = (field: MissingField) =>
    missing.has(field) ? 'border-amber-400 bg-amber-50 focus-visible:ring-amber-300' : ''

  const procedureLabels = Object.fromEntries([
    [KEEP, p.service.tuss_code ? `${p.service.tuss_code} — ${p.service.description ?? ''}` : 'Selecione'],
    ...procedures.map((x) => [x.id, `${x.tuss_code} — ${x.description}`]),
  ])
  const settingsMissing = SETTINGS_FIELDS.filter((f) => missing.has(f))

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          Guia {guide.provider_guide_number} · {GUIDE_TYPE_LABELS[guide.guide_type]}
        </SheetTitle>
        <SheetDescription>
          {guide.health_insurers?.name ?? 'Operadora'} · {formatDate(guide.service_date)} ·{' '}
          {GUIDE_STATUS_LABELS[guide.status]}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-4 px-4">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <dt className="text-gray-400">Paciente</dt>
          <dd className="text-gray-900">{p.beneficiary.name}</dd>
          <dt className="text-gray-400">Médico</dt>
          <dd className="text-gray-900">
            {p.professional.name || '—'}
            {p.professional.crm ? ` · CRM ${p.professional.crm}${p.professional.crm_uf ? `/${p.professional.crm_uf}` : ''}` : ''}
          </dd>
          <dt className="text-gray-400">Valor</dt>
          <dd className="text-gray-900">{formatCents(guide.total_cents)}</dd>
        </dl>

        {missing.size > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              Faltam dados para a guia ficar pronta
            </p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
              {[...missing].map((f) => (
                <li key={f}>{MISSING_FIELD_LABELS[f] ?? f}</li>
              ))}
            </ul>
            {settingsMissing.length > 0 && (
              <p className="mt-2">
                Dados da clínica e do médico se corrigem em{' '}
                <Link href="/configuracoes/convenios" className="underline">
                  Convênios
                </Link>{' '}
                ou no{' '}
                <Link href="/configuracoes" className="underline">
                  perfil
                </Link>
                ; depois use “Recarregar dados”.
              </p>
            )}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <Label htmlFor="g_card">Carteirinha</Label>
            <Input
              id="g_card"
              maxLength={20}
              disabled={!editable}
              className={highlight('beneficiary.card_number')}
              value={form.card_number}
              onChange={(e) => setForm((f) => ({ ...f, card_number: e.target.value }))}
            />
          </div>
          <div>
            <Label>Procedimento TUSS</Label>
            <Select
              items={procedureLabels}
              value={form.insurer_procedure_id}
              disabled={!editable}
              onValueChange={(v) => v && setForm((f) => ({ ...f, insurer_procedure_id: v }))}
            >
              <SelectTrigger className={highlight('service.tuss_code')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP}>{procedureLabels[KEEP]}</SelectItem>
                {procedures.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.tuss_code} — {x.description} · {formatCents(x.price_cents)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="g_auth">Código de autorização</Label>
              <Input
                id="g_auth"
                maxLength={20}
                disabled={!editable}
                value={form.authorization_number}
                onChange={(e) => setForm((f) => ({ ...f, authorization_number: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="g_auth_date">Data da autorização</Label>
              <Input
                id="g_auth_date"
                type="date"
                disabled={!editable}
                className={highlight('service.authorization_date')}
                value={form.authorization_date}
                onChange={(e) => setForm((f) => ({ ...f, authorization_date: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="g_cid">CID-10</Label>
            <Input
              id="g_cid"
              maxLength={10}
              disabled={!editable}
              placeholder="Opcional — não vai no XML 4.03.00"
              value={form.cid10}
              onChange={(e) => setForm((f) => ({ ...f, cid10: e.target.value.toUpperCase() }))}
            />
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{friendlyErrorMessage(error, "Não foi possível concluir esta ação de faturamento. Confira os dados e tente novamente.")}</p>}
      </div>

      {editable && (
        <SheetFooter className="flex-row flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="text-red-600 hover:text-red-700"
              disabled={busy !== null}
              onClick={() => {
                if (confirm('Cancelar esta guia? Ela não entrará em nenhum lote.')) send('cancel', { action: 'cancel' })
              }}
            >
              Cancelar guia
            </Button>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => send('refresh', { action: 'refresh' })}
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {busy === 'refresh' ? 'Recarregando…' : 'Recarregar dados'}
            </Button>
          </div>
          <Button
            onClick={save}
            disabled={busy !== null}
            className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            {busy === 'save' ? 'Salvando...' : 'Salvar'}
          </Button>
        </SheetFooter>
      )}
    </>
  )
}
