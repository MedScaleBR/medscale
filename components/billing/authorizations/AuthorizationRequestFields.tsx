'use client'

import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  AUSENCIA_COD_VALIDACAO, CARATER_ATENDIMENTO, COBERTURA_ESPECIAL, ETAPA_AUTORIZACAO, INDICADOR_ACIDENTE,
  REGIME_INTERNACAO, TIPO_INTERNACAO,
} from '@/lib/billing/authorizations/domains'
import type {
  AuthorizationType, HospitalizationRequestData, OpmeRequestData, RequestDataByType, SpSadtRequestData,
  ValidationData,
} from '@/lib/billing/authorizations/types'

export const MISSING_HIGHLIGHT = 'border-amber-400 bg-amber-50 focus-visible:ring-amber-300'
const NONE = '__none__'

// Select de um domínio do XSD: rótulo visível, código enviado. `nullable`
// acrescenta "Não informado" (null).
export function CodeSelect<D extends Readonly<Record<string, string>>>({
  label,
  domain,
  value,
  onChange,
  disabled,
  nullable = false,
  showCode = false,
  className,
}: {
  label: string
  domain: D
  value: (keyof D & string) | null
  onChange: (v: (keyof D & string) | null) => void
  disabled?: boolean
  nullable?: boolean
  showCode?: boolean
  className?: string
}) {
  const items: Record<string, string> = {
    ...(nullable ? { [NONE]: 'Não informado' } : {}),
    ...Object.fromEntries(Object.entries(domain).map(([k, l]) => [k, showCode ? `${k} — ${l}` : l])),
  }
  const keys = Object.keys(domain) as Array<keyof D & string>
  return (
    <div className={className}>
      <Label className="text-xs">{label}</Label>
      <Select
        items={items}
        value={value ?? (nullable ? NONE : '')}
        disabled={disabled}
        onValueChange={(v) => {
          if (v === NONE) onChange(null)
          else if (typeof v === 'string') {
            const key = keys.find((k) => k === v)
            if (key !== undefined) onChange(key)
          }
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Selecione" />
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
}

export function CountedTextarea({
  id,
  label,
  value,
  max,
  onChange,
  disabled,
  highlight,
}: {
  id: string
  label: string
  value: string | null
  max: number
  onChange: (v: string) => void
  disabled: boolean
  highlight?: boolean
}) {
  const text = value ?? ''
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <span className="text-[11px] text-gray-400">
          {text.length}/{max}
        </span>
      </div>
      <Textarea
        id={id}
        maxLength={max}
        disabled={disabled}
        className={highlight ? MISSING_HIGHLIGHT : ''}
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function TextField({
  id,
  label,
  value,
  max,
  onChange,
  disabled,
  highlight,
  type = 'text',
  className,
}: {
  id: string
  label: string
  value: string | null
  max?: number
  onChange: (v: string) => void
  disabled: boolean
  highlight?: boolean
  type?: 'text' | 'date'
  className?: string
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        maxLength={max}
        disabled={disabled}
        className={highlight ? MISSING_HIGHLIGHT : ''}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function Advanced({ children }: { children: ReactNode }) {
  return (
    <details className="rounded-lg border border-[var(--navy-06)] px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-gray-600">Avançado</summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  )
}

function ValidationBlock<V extends ValidationData>({
  value,
  editable,
  onChange,
}: {
  value: V
  editable: boolean
  onChange: (next: V) => void
}) {
  return (
    <Advanced>
      <CodeSelect
        label="Etapa da autorização"
        domain={ETAPA_AUTORIZACAO}
        value={value.stage}
        disabled={!editable}
        onChange={(v) => v && onChange({ ...value, stage: v })}
      />
      <div className="grid grid-cols-2 gap-3">
        <CodeSelect
          label="Ausência do código de validação"
          domain={AUSENCIA_COD_VALIDACAO}
          nullable
          value={value.absence_code}
          disabled={!editable}
          onChange={(v) => onChange({ ...value, absence_code: v })}
        />
        <TextField
          id="auth_validation_code"
          label="Código de validação"
          max={10}
          value={value.code}
          disabled={!editable}
          onChange={(v) => onChange({ ...value, code: v })}
        />
      </div>
    </Advanced>
  )
}

interface FieldsProps<T extends AuthorizationType> {
  type: T
  value: RequestDataByType[T]
  editable: boolean
  missing: Set<string>
  // Sintaxe de método: deixa Props<'opme_request'> caber em Props<AuthorizationType>.
  onChange(next: RequestDataByType[T]): void
}

function isType<K extends AuthorizationType>(p: FieldsProps<AuthorizationType>, type: K): p is FieldsProps<K> {
  return p.type === type
}

// Pedido clínico por tipo, com maxLength igual ao XSD.
export function AuthorizationRequestFields<T extends AuthorizationType>(props: FieldsProps<T>) {
  const p: FieldsProps<AuthorizationType> = props
  if (isType(p, 'sp_sadt_request')) return <SpSadtFields {...p} />
  if (isType(p, 'hospitalization_request')) return <HospitalizationFields {...p} />
  if (isType(p, 'opme_request')) return <OpmeFields {...p} />
  return null
}

function SpSadtFields({ value: r, editable, missing, onChange }: FieldsProps<'sp_sadt_request'>) {
  const set = (patch: Partial<SpSadtRequestData>) => onChange({ ...r, ...patch })
  const executor = r.executor ?? { operator_code: '', cnes: '' }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <CodeSelect
          label="Caráter do atendimento"
          domain={CARATER_ATENDIMENTO}
          value={r.character}
          disabled={!editable}
          onChange={(v) => v && set({ character: v })}
        />
        <CodeSelect
          label="Cobertura especial"
          domain={COBERTURA_ESPECIAL}
          nullable
          value={r.special_coverage}
          disabled={!editable}
          onChange={(v) => set({ special_coverage: v })}
        />
      </div>
      <CountedTextarea
        id="auth_sp_indication"
        label="Indicação clínica"
        max={500}
        value={r.clinical_indication}
        disabled={!editable}
        highlight={missing.has('request.clinical_indication')}
        onChange={(v) => set({ clinical_indication: v })}
      />
      <TextField
        id="auth_sp_main_guide"
        label="Número da guia principal (opcional)"
        max={20}
        value={r.main_guide_number}
        disabled={!editable}
        onChange={(v) => set({ main_guide_number: v })}
      />
      <div>
        <p className="text-xs text-gray-500">Contratado executante (opcional)</p>
        <div className="mt-1 grid grid-cols-2 gap-3">
          <TextField
            id="auth_sp_exec_code"
            label="Código na operadora"
            max={14}
            value={executor.operator_code}
            disabled={!editable}
            onChange={(v) => set({ executor: { ...executor, operator_code: v } })}
          />
          <TextField
            id="auth_sp_exec_cnes"
            label="CNES"
            max={7}
            value={executor.cnes}
            disabled={!editable}
            onChange={(v) => set({ executor: { ...executor, cnes: v } })}
          />
        </div>
      </div>
      <CountedTextarea
        id="auth_sp_observation"
        label="Observação"
        max={500}
        value={r.observation}
        disabled={!editable}
        onChange={(v) => set({ observation: v })}
      />
      <ValidationBlock value={r} editable={editable} onChange={onChange} />
    </div>
  )
}

function HospitalizationFields({ value: r, editable, missing, onChange }: FieldsProps<'hospitalization_request'>) {
  const set = (patch: Partial<HospitalizationRequestData>) => onChange({ ...r, ...patch })
  const setHospital = (patch: Partial<HospitalizationRequestData['hospital']>) =>
    set({ hospital: { ...r.hospital, ...patch } })
  const cids = [0, 1, 2, 3].map((i) => r.cid10[i] ?? '')
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <TextField
          id="auth_h_code"
          label="Código do hospital na operadora"
          max={14}
          value={r.hospital.operator_code}
          disabled={!editable}
          highlight={missing.has('request.hospital.operator_code')}
          onChange={(v) => setHospital({ operator_code: v })}
        />
        <TextField
          id="auth_h_date"
          type="date"
          label="Data sugerida da internação"
          value={r.hospital.suggested_date}
          disabled={!editable}
          highlight={missing.has('request.hospital.suggested_date')}
          onChange={(v) => setHospital({ suggested_date: v })}
        />
      </div>
      <TextField
        id="auth_h_name"
        label="Nome do hospital"
        max={70}
        value={r.hospital.name}
        disabled={!editable}
        highlight={missing.has('request.hospital.name')}
        onChange={(v) => setHospital({ name: v })}
      />
      <div className="grid grid-cols-2 gap-3">
        <CodeSelect
          label="Caráter do atendimento"
          domain={CARATER_ATENDIMENTO}
          value={r.character}
          disabled={!editable}
          onChange={(v) => v && set({ character: v })}
        />
        <CodeSelect
          label="Tipo de internação"
          domain={TIPO_INTERNACAO}
          value={r.hospitalization_type}
          disabled={!editable}
          onChange={(v) => v && set({ hospitalization_type: v })}
        />
        <CodeSelect
          label="Regime de internação"
          domain={REGIME_INTERNACAO}
          value={r.regime}
          disabled={!editable}
          onChange={(v) => v && set({ regime: v })}
        />
        <div>
          <Label htmlFor="auth_h_days" className="text-xs">
            Diárias solicitadas
          </Label>
          <Input
            id="auth_h_days"
            type="number"
            min={1}
            max={99}
            step={1}
            disabled={!editable}
            className={missing.has('request.daily_count') ? MISSING_HIGHLIGHT : ''}
            value={r.daily_count ?? ''}
            onChange={(e) => set({ daily_count: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <Switch checked={r.opme_expected} disabled={!editable} onCheckedChange={(v) => set({ opme_expected: v })} />
          Previsão de OPME
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <Switch checked={r.chemo_expected} disabled={!editable} onCheckedChange={(v) => set({ chemo_expected: v })} />
          Previsão de quimioterápico
        </label>
      </div>
      <CountedTextarea
        id="auth_h_indication"
        label="Indicação clínica"
        max={500}
        value={r.clinical_indication}
        disabled={!editable}
        highlight={missing.has('request.clinical_indication')}
        onChange={(v) => set({ clinical_indication: v })}
      />
      <div>
        <Label className="text-xs">CID-10 (até 4, ex.: K35.9)</Label>
        <div className="mt-1 grid grid-cols-4 gap-2">
          {cids.map((cid, i) => (
            <Input
              key={i}
              aria-label={`CID-10 ${i + 1}`}
              maxLength={6}
              disabled={!editable}
              value={cid}
              onChange={(e) => {
                const next = [...cids]
                next[i] = e.target.value.toUpperCase()
                set({ cid10: next })
              }}
            />
          ))}
        </div>
      </div>
      <CodeSelect
        label="Indicação de acidente"
        domain={INDICADOR_ACIDENTE}
        value={r.accident}
        disabled={!editable}
        onChange={(v) => v && set({ accident: v })}
      />
      <CountedTextarea
        id="auth_h_observation"
        label="Observação"
        max={1000}
        value={r.observation}
        disabled={!editable}
        onChange={(v) => set({ observation: v })}
      />
      <ValidationBlock value={r} editable={editable} onChange={onChange} />
    </div>
  )
}

function OpmeFields({ value: r, editable, missing, onChange }: FieldsProps<'opme_request'>) {
  const set = (patch: Partial<OpmeRequestData>) => onChange({ ...r, ...patch })
  return (
    <div className="space-y-3">
      <CountedTextarea
        id="auth_o_justification"
        label="Justificativa técnica"
        max={1000}
        value={r.technical_justification}
        disabled={!editable}
        highlight={missing.has('request.technical_justification')}
        onChange={(v) => set({ technical_justification: v })}
      />
      <CountedTextarea
        id="auth_o_specification"
        label="Especificação do material"
        max={500}
        value={r.material_specification}
        disabled={!editable}
        onChange={(v) => set({ material_specification: v })}
      />
      <CountedTextarea
        id="auth_o_observation"
        label="Observação"
        max={500}
        value={r.observation}
        disabled={!editable}
        onChange={(v) => set({ observation: v })}
      />
    </div>
  )
}
