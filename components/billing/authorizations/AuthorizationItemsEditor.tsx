'use client'

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MAX_AUTHORIZATION_ITEMS } from '@/lib/billing/authorizations/constants'
import { OPCAO_FABRICANTE, TABELA, type OpcaoFabricante, type Tabela } from '@/lib/billing/authorizations/domains'
import type { AuthorizationItem, AuthorizationItemInput, AuthorizationType } from '@/lib/billing/authorizations/types'
import { centsToInput, formatCents, parseCents } from '../money'
import { CodeSelect } from './AuthorizationRequestFields'

interface ProcedureOption {
  id: string
  tuss_code: string
  description: string
}

interface Row {
  key: string
  table_code: Tabela
  code: string
  description: string
  quantity: string
  manufacturer_option: OpcaoFabricante | null
  value: string
  anvisa_registration: string
  manufacturer_reference: string
  operating_authorization: string
}

const PICK = '__pick__'
let rowSeq = 0
const nextKey = () => `row-${++rowSeq}`

function toRow(i: AuthorizationItem): Row {
  return {
    key: i.id,
    table_code: i.table_code,
    code: i.code,
    description: i.description,
    quantity: String(i.quantity_requested),
    manufacturer_option: i.manufacturer_option,
    value: i.requested_value_cents === null ? '' : centsToInput(i.requested_value_cents),
    anvisa_registration: i.anvisa_registration ?? '',
    manufacturer_reference: i.manufacturer_reference ?? '',
    operating_authorization: i.operating_authorization ?? '',
  }
}

const blankRow = (opme: boolean): Row => ({
  key: nextKey(),
  table_code: opme ? '19' : '22',
  code: '',
  description: '',
  quantity: '1',
  manufacturer_option: opme ? '1' : null,
  value: '',
  anvisa_registration: '',
  manufacturer_reference: '',
  operating_authorization: '',
})

function toInput(rows: Row[], opme: boolean): { ok: true; value: AuthorizationItemInput[] } | { ok: false; error: string } {
  const out: AuthorizationItemInput[] = []
  for (const [i, r] of rows.entries()) {
    const quantity = Number(r.quantity)
    if (!/^\d+$/.test(r.quantity.trim()) || quantity < 1 || quantity > 999) {
      return { ok: false, error: `Item ${i + 1}: quantidade entre 1 e 999.` }
    }
    let cents: number | null = null
    if (opme && r.value.trim()) {
      cents = parseCents(r.value)
      if (cents === null) return { ok: false, error: `Item ${i + 1}: valor unitário inválido.` }
    }
    out.push({
      table_code: r.table_code,
      code: r.code.trim(),
      description: r.description.trim(),
      quantity_requested: quantity,
      manufacturer_option: opme ? r.manufacturer_option : null,
      requested_value_cents: cents,
      anvisa_registration: opme ? r.anvisa_registration.trim() || null : null,
      manufacturer_reference: opme ? r.manufacturer_reference.trim() || null : null,
      operating_authorization: opme ? r.operating_authorization.trim() || null : null,
    })
  }
  return { ok: true, value: out }
}

// Procedimentos (SP/SADT, Internação) ou materiais (OPME). Edição local;
// "Salvar itens" troca a lista inteira (PUT …/items).
export function AuthorizationItemsEditor({
  type,
  insurerId,
  items,
  editable,
  onSave,
}: {
  type: AuthorizationType
  insurerId: string
  items: AuthorizationItem[]
  editable: boolean
  onSave: (items: AuthorizationItemInput[]) => Promise<void>
}) {
  const opme = type === 'opme_request'
  if (!editable) return <ItemsReadOnly items={items} opme={opme} />
  return <ItemsForm opme={opme} insurerId={insurerId} items={items} onSave={onSave} />
}

function ItemsReadOnly({ items, opme }: { items: AuthorizationItem[]; opme: boolean }) {
  if (items.length === 0) return <p className="text-xs text-gray-400">Nenhum item.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--navy-06)] text-left text-gray-400">
            <th className="py-1.5 pr-2 font-normal">Tabela</th>
            <th className="py-1.5 pr-2 font-normal">Código</th>
            <th className="py-1.5 pr-2 font-normal">Descrição</th>
            <th className="py-1.5 pr-2 text-right font-normal">Qtd. solic.</th>
            <th className="py-1.5 pr-2 text-right font-normal">Qtd. autor.</th>
            {opme && <th className="py-1.5 pr-2 text-right font-normal">Valor unit.</th>}
            {opme && <th className="py-1.5 text-right font-normal">Valor autor.</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-b border-[var(--navy-06)] last:border-0">
              <td className="py-1.5 pr-2 text-gray-600">{i.table_code}</td>
              <td className="py-1.5 pr-2 text-gray-900">{i.code}</td>
              <td className="py-1.5 pr-2 text-gray-900">
                {i.description}
                {opme && i.manufacturer_option && (
                  <span className="block text-gray-400">
                    {OPCAO_FABRICANTE[i.manufacturer_option]}
                    {i.anvisa_registration ? ` · ANVISA ${i.anvisa_registration}` : ''}
                    {i.manufacturer_reference ? ` · Ref. ${i.manufacturer_reference}` : ''}
                    {i.operating_authorization ? ` · AFE ${i.operating_authorization}` : ''}
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-2 text-right text-gray-900">{i.quantity_requested}</td>
              <td className="py-1.5 pr-2 text-right text-gray-900">{i.quantity_authorized ?? '—'}</td>
              {opme && (
                <td className="py-1.5 pr-2 text-right text-gray-600">
                  {i.requested_value_cents === null ? '—' : formatCents(i.requested_value_cents)}
                </td>
              )}
              {opme && (
                <td className="py-1.5 text-right text-gray-900">
                  {i.authorized_value_cents === null ? '—' : formatCents(i.authorized_value_cents)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ItemsForm({
  opme,
  insurerId,
  items,
  onSave,
}: {
  opme: boolean
  insurerId: string
  items: AuthorizationItem[]
  onSave: (items: AuthorizationItemInput[]) => Promise<void>
}) {
  const [rows, setRows] = useState<Row[]>(() => items.map(toRow))
  const [procedures, setProcedures] = useState<ProcedureOption[] | null>(null)
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (opme) return
    let cancelled = false
    fetch(`/api/billing/insurers/${insurerId}/procedures`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ProcedureOption[] | null) => {
        if (cancelled) return
        setCatalogFailed(d === null)
        setProcedures(d ?? [])
      })
      .catch(() => !cancelled && setCatalogFailed(true))
    return () => {
      cancelled = true
    }
  }, [opme, insurerId])

  const full = rows.length >= MAX_AUTHORIZATION_ITEMS
  const update = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const move = (index: number, delta: -1 | 1) =>
    setRows((rs) => {
      const next = [...rs]
      const [row] = next.splice(index, 1)
      next.splice(index + delta, 0, row)
      return next
    })

  const addFromCatalog = (id: string) => {
    const p = procedures?.find((x) => x.id === id)
    if (!p || full) return
    setRows((rs) => [...rs, { ...blankRow(false), table_code: '22', code: p.tuss_code, description: p.description }])
  }

  const save = async () => {
    const parsed = toInput(rows, opme)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave(parsed.value)
    } finally {
      setSaving(false)
    }
  }

  const catalogLabels: Record<string, string> = {
    [PICK]: 'Adicionar do catálogo',
    ...Object.fromEntries((procedures ?? []).map((p) => [p.id, `${p.tuss_code} — ${p.description}`])),
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="text-xs text-gray-400">Nenhum item. Adicione ao menos um.</p>}
      {rows.map((r, index) => (
        <div key={r.key} className="space-y-2 rounded-lg border border-[var(--navy-06)] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">Item {index + 1}</span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Subir item"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Descer item"
                disabled={index === rows.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remover item"
                className="text-red-600 hover:text-red-700"
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-6 gap-2">
            <CodeSelect
              className="col-span-3"
              label="Tabela"
              domain={TABELA}
              showCode
              value={r.table_code}
              onChange={(v) => v && update(r.key, { table_code: v })}
            />
            <div className="col-span-2">
              <Label className="text-xs">Código</Label>
              <Input maxLength={10} value={r.code} onChange={(e) => update(r.key, { code: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Qtd.</Label>
              <Input
                inputMode="numeric"
                maxLength={3}
                value={r.quantity}
                onChange={(e) => update(r.key, { quantity: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Descrição</Label>
            <Input
              maxLength={150}
              value={r.description}
              onChange={(e) => update(r.key, { description: e.target.value })}
            />
          </div>
          {opme && (
            <div className="grid grid-cols-2 gap-2">
              <CodeSelect
                label="Opção do fabricante"
                domain={OPCAO_FABRICANTE}
                value={r.manufacturer_option}
                onChange={(v) => v && update(r.key, { manufacturer_option: v })}
              />
              <div>
                <Label className="text-xs">Valor unitário (R$)</Label>
                <Input
                  inputMode="decimal"
                  placeholder="0,00"
                  value={r.value}
                  onChange={(e) => update(r.key, { value: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Registro ANVISA</Label>
                <Input
                  maxLength={15}
                  value={r.anvisa_registration}
                  onChange={(e) => update(r.key, { anvisa_registration: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Referência do fabricante</Label>
                <Input
                  maxLength={60}
                  value={r.manufacturer_reference}
                  onChange={(e) => update(r.key, { manufacturer_reference: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Autorização de funcionamento (AFE)</Label>
                <Input
                  maxLength={30}
                  value={r.operating_authorization}
                  onChange={(e) => update(r.key, { operating_authorization: e.target.value })}
                />
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={full} onClick={() => setRows((rs) => [...rs, blankRow(opme)])}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Adicionar linha
        </Button>
        {!opme && procedures !== null && procedures.length > 0 && (
          <Select items={catalogLabels} value={PICK} disabled={full} onValueChange={(v) => v && v !== PICK && addFromCatalog(v)}>
            <SelectTrigger size="sm" className="min-w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(catalogLabels).map(([k, l]) => (
                <SelectItem key={k} value={k} disabled={k === PICK}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {!opme && catalogFailed && (
          <span className="text-xs text-red-600">Não foi possível carregar o catálogo de procedimentos.</span>
        )}
        <Button size="sm" className="ml-auto" disabled={saving} onClick={save}>
          {saving ? 'Salvando…' : 'Salvar itens'}
        </Button>
      </div>
      {full && <p className="text-xs text-gray-400">Limite de {MAX_AUTHORIZATION_ITEMS} itens.</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
