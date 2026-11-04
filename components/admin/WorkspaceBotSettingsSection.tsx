'use client'

import { useState } from 'react'
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { WorkspaceBotSettingsForm, type BotSettingsValue } from './WorkspaceBotSettingsForm'
import { NotificationEmailsForm } from './NotificationEmailsForm'
import { ClaraAccountOptions } from './ClaraAccountOptions'
import { applyPresetToAccount, createPreset, saveAccountNotificationEmails, saveWorkspaceBotSettings } from './clara-api'
import { NOTIFICATION_EMAILS_MAX, parseNotificationEmails, splitEmails } from '@/lib/bot/notification-emails'
import { matchesPreset, presetSettings, type BotPreset } from '@/lib/bot/presets'
import { getWorkspaceBotSettings } from '@/lib/bot/unit-settings'

export interface WorkspaceBotSettingsRow {
  id: string
  name: string
  settings: BotSettingsValue
  presetId: string | null
  updatedByName: string | null
  updatedAt: string | null
  /** null = coluna ainda não migrada (campo escondido). */
  notificationEmails: string[] | null
}

function formatUpdatedAt(iso: string): string {
  return format(new TZDate(new Date(iso), 'America/Sao_Paulo'), "dd/MM/yyyy 'às' HH:mm")
}

function WorkspaceBotSettingsCard({
  row,
  presets,
  onPresetCreated,
  onSaved,
}: {
  row: WorkspaceBotSettingsRow
  presets: BotPreset[]
  onPresetCreated: (preset: BotPreset) => void
  onSaved: (row: WorkspaceBotSettingsRow) => void
}) {
  const handleSubmit = async (next: BotSettingsValue, presetId: string | null | undefined): Promise<string | null> => {
    const res = await saveWorkspaceBotSettings(row.id, next, presetId)
    if (res.data === null) return res.error
    const data = res.data
    onSaved({
      ...row,
      settings: next,
      presetId: data.bot_preset_id ?? row.presetId,
      updatedByName: data.updated_by_name ?? null,
      updatedAt: data.bot_settings_updated_at ?? null,
    })
    return null
  }

  const handleSaveAsPreset = async (name: string, value: BotSettingsValue): Promise<string | null> => {
    const res = await createPreset({ ...value, name })
    if (res.data === null) return res.error
    onPresetCreated(res.data.preset)
    return null
  }

  return (
    <section className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
      <h3 className="mb-4 font-medium text-gray-900">{row.name}</h3>
      <WorkspaceBotSettingsForm
        idPrefix={`ws-${row.id}`}
        value={row.settings}
        presets={presets}
        presetId={row.presetId}
        onSubmit={handleSubmit}
        onSaveAsPreset={handleSaveAsPreset}
        footer={
          row.updatedAt ? (
            <p className="text-xs text-gray-400">
              Última alteração por {row.updatedByName ?? 'alguém da equipe'} em {formatUpdatedAt(row.updatedAt)}
            </p>
          ) : null
        }
      />
      {row.notificationEmails !== null && (
        <NotificationEmailsForm
          workspaceId={row.id}
          initial={row.notificationEmails}
          onSaved={(emails) => onSaved({ ...row, notificationEmails: emails })}
        />
      )}
    </section>
  )
}

function ApplyToAllUnits({
  accountId,
  rows,
  presets,
  onApplied,
}: {
  accountId: string
  rows: WorkspaceBotSettingsRow[]
  presets: BotPreset[]
  onApplied: (rows: WorkspaceBotSettingsRow[]) => void
}) {
  const [presetId, setPresetId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [applying, setApplying] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const preset = presets.find((p) => p.id === presetId)
  const changing = preset
    ? rows.filter((r) => !matchesPreset(getWorkspaceBotSettings(r.settings), preset) || r.presetId !== preset.id)
    : []

  const apply = async () => {
    if (!preset) return
    setApplying(true)
    setMessage(null)
    const res = await applyPresetToAccount(preset.id, accountId)
    setApplying(false)
    if (res.data === null) {
      setMessage({ ok: false, text: res.error })
      return
    }
    const data = res.data
    const s = presetSettings(preset)
    const byId = new Map(data.workspaces.map((w) => [w.id, w]))
    onApplied(
      rows.map((r) =>
        byId.has(r.id)
          ? {
              ...r,
              settings: { scheduling_mode: s.schedulingMode, intake_fields: s.intakeFields, bot_instructions: s.botInstructions },
              presetId: preset.id,
              updatedByName: data.updated_by_name,
              updatedAt: byId.get(r.id)!.bot_settings_updated_at,
            }
          : r
      )
    )
    setConfirming(false)
    setMessage({ ok: true, text: `Modelo aplicado em ${data.workspaces.length} ${data.workspaces.length === 1 ? 'unidade' : 'unidades'}.` })
  }

  if (presets.length === 0) return null

  return (
    <div className="rounded-xl border border-dashed border-[var(--navy-06)] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <span>Aplicar modelo a todas as unidades</span>
          <select
            aria-label="Modelo para todas as unidades"
            value={presetId}
            onChange={(e) => {
              setPresetId(e.target.value)
              setConfirming(false)
              setMessage(null)
            }}
            className="h-8 rounded-md border border-[var(--navy-06)] bg-white px-2 text-sm"
          >
            <option value="">Escolher…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {preset && !confirming && (
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
            Revisar
          </Button>
        )}
      </div>

      {preset && confirming && (
        <div className="mt-3 space-y-2 text-sm">
          {changing.length === 0 ? (
            <p className="text-gray-500">Todas as unidades já estão com este modelo.</p>
          ) : (
            <>
              <p className="text-gray-700">
                Estas unidades vão passar a usar “{preset.name}”. O que estiver configurado nelas hoje será substituído:
              </p>
              <ul className="list-disc pl-5 text-gray-600">
                {changing.map((r) => (
                  <li key={r.id}>{r.name}</li>
                ))}
              </ul>
            </>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={applying || changing.length === 0}
              onClick={apply}
              className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
            >
              {applying ? 'Aplicando...' : 'Confirmar e gravar'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {message && <p className={`mt-2 text-xs ${message.ok ? 'text-gray-500' : 'text-red-500'}`}>{message.text}</p>}
    </div>
  )
}

// Mesma lista de e-mails em todas as unidades ativas, de uma vez. Depois cada
// unidade ainda pode ser ajustada no próprio card.
function ApplyEmailsToAllUnits({
  accountId,
  rows,
  onApplied,
}: {
  accountId: string
  rows: WorkspaceBotSettingsRow[]
  onApplied: (rows: WorkspaceBotSettingsRow[]) => void
}) {
  // Se todas as unidades já têm a mesma lista, ela vem preenchida.
  const lists = rows.map((r) => (r.notificationEmails ?? []).join('\n'))
  const [text, setText] = useState(lists.length > 0 && lists.every((l) => l === lists[0]) ? lists[0] : '')
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const parsed = parseNotificationEmails(splitEmails(text))

  const apply = async () => {
    if (!parsed.ok) return
    setSaving(true)
    setMessage(null)
    const res = await saveAccountNotificationEmails(accountId, parsed.value)
    setSaving(false)
    setConfirming(false)
    if (res.data === null) {
      setMessage({ ok: false, text: res.error })
      return
    }
    const byId = new Map(res.data.workspaces.map((w) => [w.id, w.notification_emails]))
    onApplied(rows.map((r) => (byId.has(r.id) ? { ...r, notificationEmails: byId.get(r.id)! } : r)))
    const n = res.data.workspaces.length
    setMessage({ ok: true, text: `E-mails salvos em ${n} ${n === 1 ? 'unidade' : 'unidades'}.` })
  }

  return (
    <div className="rounded-xl border border-dashed border-[var(--navy-06)] p-4">
      <Label htmlFor={`account-${accountId}-emails`}>E-mails que recebem as solicitações (todas as unidades)</Label>
      <p className="mb-1 text-xs text-gray-400">
        Um por linha, até {NOTIFICATION_EMAILS_MAX}. Substitui a lista de todas as unidades ativas; depois dá para ajustar
        uma unidade no card dela.
      </p>
      <Textarea
        id={`account-${accountId}-emails`}
        value={text}
        rows={3}
        onChange={(e) => {
          setText(e.target.value)
          setConfirming(false)
          setMessage(null)
        }}
        placeholder="secretaria@clinica.com.br"
      />
      {!parsed.ok && <p className="mt-1 text-xs text-red-500">{parsed.error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!confirming ? (
          <Button type="button" variant="outline" size="sm" disabled={!parsed.ok} onClick={() => setConfirming(true)}>
            Aplicar a todas as unidades
          </Button>
        ) : (
          <>
            <span className="text-sm text-gray-700">
              {parsed.ok && parsed.value.length === 0
                ? 'Isso apaga os e-mails de todas as unidades. Confirmar?'
                : 'Isso substitui os e-mails de todas as unidades. Confirmar?'}
            </span>
            <Button
              type="button"
              size="sm"
              disabled={saving || !parsed.ok}
              onClick={apply}
              className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
            >
              {saving ? 'Salvando...' : 'Confirmar e gravar'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </>
        )}
        {message && <span className={`text-xs ${message.ok ? 'text-gray-500' : 'text-red-500'}`}>{message.text}</span>}
      </div>
    </div>
  )
}

// "Clara nesta unidade" em /admin — uma configuração por workspace.
export function WorkspaceBotSettingsSection({
  accountId,
  rows: initialRows,
  presets: initialPresets,
  askInsuranceFirst,
}: {
  accountId: string
  rows: WorkspaceBotSettingsRow[]
  presets: BotPreset[]
  /** null = account sem bot_config ou coluna não migrada (opção escondida). */
  askInsuranceFirst: boolean | null
}) {
  const [rows, setRows] = useState(initialRows)
  const [presets, setPresets] = useState(initialPresets)
  // Muda quando um modelo é aplicado em todas: remonta os formulários com os valores novos.
  const [version, setVersion] = useState(0)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-medium text-gray-900">Clara nesta unidade</h2>
        <p className="text-sm text-gray-400">
          Como a Clara atende em cada unidade. Só a equipe MedScale altera; o cliente vê um resumo em Meus locais.
        </p>
      </div>
      {askInsuranceFirst !== null && (
        <ClaraAccountOptions accountId={accountId} askInsuranceFirst={askInsuranceFirst} unitsCount={rows.length} />
      )}
      <ApplyToAllUnits
        accountId={accountId}
        rows={rows}
        presets={presets}
        onApplied={(next) => {
          setRows(next)
          setVersion((v) => v + 1)
        }}
      />
      {rows.length > 0 && rows.some((r) => r.notificationEmails !== null) && (
        <ApplyEmailsToAllUnits
          accountId={accountId}
          rows={rows}
          onApplied={(next) => {
            setRows(next)
            setVersion((v) => v + 1)
          }}
        />
      )}
      {rows.map((row) => (
        <WorkspaceBotSettingsCard
          key={`${row.id}-${version}`}
          row={row}
          presets={presets}
          onPresetCreated={(p) => setPresets((prev) => [...prev, p].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))}
          onSaved={(next) => setRows((prev) => prev.map((r) => (r.id === next.id ? next : r)))}
        />
      ))}
    </div>
  )
}
