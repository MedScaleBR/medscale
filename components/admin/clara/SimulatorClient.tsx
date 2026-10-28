'use client'

import { Fragment, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Copy, RotateCcw, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { parseRichText } from '@/lib/bot/rich-text'
import { WorkspaceBotSettingsForm, type BotSettingsValue } from '@/components/admin/WorkspaceBotSettingsForm'
import { createPreset, saveWorkspaceBotSettings } from '@/components/admin/clara-api'
import { formatSimulationTranscript } from '@/lib/bot/simulator-format'
import type { BotPreset } from '@/lib/bot/presets'
import type { SimulatedPatient, SimulationResult } from '@/lib/llm/simulate'

export interface SimUnit {
  id: string
  name: string
  settings: BotSettingsValue
  presetId: string | null
}

export interface SimAccount {
  id: string
  name: string
  units: SimUnit[]
  insurers: { id: string; name: string }[]
}

interface Turn {
  id: number
  role: 'patient' | 'clara'
  text: string
  sent_at: string
  /** Resposta da Clara: o que aconteceu por dentro. */
  result?: SimulationResult
  /** Mensagens extras que o paciente receberia (transição do handoff). */
  extra?: boolean
  /** O que a produção guardaria no histórico (pode diferir do balão). */
  historyText?: string
}

const MARKER_LINE =
  /^\s*(AGENDAMENTO_CONFIRMADO|CANCELAMENTO_CONFIRMADO|NOME_PACIENTE|NASCIMENTO_PACIENTE|DATA_NASCIMENTO|PROCEDIMENTO_ID|UNIDADE_ID|CONVENIO_ID|LISTA_ESPERA|CARTEIRINHA|CPF|EMAIL|MOTIVO_CONSULTA|PREFERENCIA_HORARIO|SOLICITACAO_AGENDAMENTO)\b|\[HANDOFF\]/

const sameSettings = (a: BotSettingsValue, b: BotSettingsValue) =>
  a.scheduling_mode === b.scheduling_mode &&
  (a.bot_instructions ?? null) === (b.bot_instructions ?? null) &&
  a.intake_fields.join(',') === b.intake_fields.join(',')

/** 'YYYY-MM-DDTHH:mm' (horário de São Paulo, sem horário de verão) → ISO com -03:00. */
function toSaoPauloIso(local: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? `${local}:00-03:00` : null
}

function formatUsd(v: number): string {
  return `US$ ${v.toFixed(4)}`
}

function Bubble({ turn }: { turn: Turn }) {
  const incoming = turn.role === 'patient'
  return (
    <div className={cn('flex', incoming ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words sm:max-w-[46ch]',
          incoming
            ? 'rounded-tl-sm bg-white text-[var(--navy-dark)] shadow-[var(--shadow-sm)]'
            : 'rounded-tr-sm border border-[var(--cyan-20)] bg-[var(--cyan-10)] text-[var(--navy-dark)]',
          turn.extra && 'opacity-80'
        )}
      >
        {parseRichText(turn.text).map((seg, s) =>
          seg.bold ? (
            <strong key={s} className="font-semibold">
              {seg.text}
            </strong>
          ) : (
            <Fragment key={s}>{seg.text}</Fragment>
          )
        )}
      </div>
    </div>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => undefined)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      <Copy className="mr-1 h-3.5 w-3.5" />
      {copied ? 'Copiado' : label}
    </Button>
  )
}

function InsidePanel({ result }: { result: SimulationResult | null }) {
  if (!result) {
    return <p className="text-sm text-gray-400">Mande uma mensagem para ver o que acontece por dentro.</p>
  }
  const f = result.patient.fields
  const state: [string, string | null | undefined][] = [
    ['Nome', result.patient.full_name],
    ['Nascimento', f.birth_date],
    ['Convênio', f.insurance?.convenio_id === 'PARTICULAR' ? 'Particular' : f.insurance?.convenio_id ? 'escolhido' : null],
    ['Carteirinha', f.insurance?.card_number],
    ['CPF', f.cpf],
    ['E-mail', f.email],
  ]
  return (
    <div className="space-y-5 text-sm">
      {result.notes.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <section>
        <h4 className="mb-2 font-medium text-gray-900">Plano de efeitos</h4>
        {result.plan_text.length === 0 ? (
          <p className="text-gray-500">Só responderia o paciente. Nada mais aconteceria.</p>
        ) : (
          <ul className="space-y-1.5">
            {result.plan_text.map((t, i) => (
              <li key={i} className="whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-2 text-gray-700">
                {t}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4 className="mb-2 font-medium text-gray-900">Resposta crua do Claude</h4>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-700">
          {result.raw.split('\n').map((line, i) => (
            <span key={i} className={cn('block', MARKER_LINE.test(line) && 'bg-[var(--cyan-10)] font-semibold text-[var(--navy-dark)]')}>
              {line || ' '}
            </span>
          ))}
        </pre>
      </section>

      <section>
        <h4 className="mb-2 font-medium text-gray-900">Paciente simulado</h4>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          {state.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-gray-400">{k}</dt>
              <dd className="text-gray-700">{v || '—'}</dd>
            </Fragment>
          ))}
        </dl>
      </section>

      <section>
        <h4 className="mb-1 font-medium text-gray-900">Custo desta resposta</h4>
        <p className="text-xs text-gray-500">
          {result.usage.input_tokens.toLocaleString('pt-BR')} tokens de entrada · {result.usage.output_tokens.toLocaleString('pt-BR')} de
          saída · {formatUsd(result.usage.cost_usd)}
        </p>
      </section>

      <details className="rounded-md border border-[var(--navy-06)]">
        <summary className="cursor-pointer px-3 py-2 font-medium text-gray-900">Prompt completo enviado ao Claude</summary>
        <div className="space-y-2 border-t border-[var(--navy-06)] p-3">
          <CopyButton
            label="Copiar prompt"
            text={`${result.prompt}\n\n--- Mensagens ---\n${result.messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n')}`}
          />
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-700">{result.prompt}</pre>
          <h5 className="text-xs font-medium text-gray-500">Mensagens</h5>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-600">
            {result.messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n')}
          </pre>
        </div>
      </details>
    </div>
  )
}

// Simulador da Clara: o staff escreve como paciente e vê a resposta e o que
// aconteceria por dentro. Conversa e paciente ficam só neste navegador.
export function SimulatorClient({ accounts, presets: initialPresets }: { accounts: SimAccount[]; presets: BotPreset[] }) {
  const [accountId, setAccountId] = useState('')
  const [simulatedLocal, setSimulatedLocal] = useState('')
  const [patientKind, setPatientKind] = useState<'new' | 'known'>('new')
  const [knownName, setKnownName] = useState('')
  const [knownInsurer, setKnownInsurer] = useState('')
  const [knownCard, setKnownCard] = useState('')
  const [knownBirth, setKnownBirth] = useState('')
  const [presets, setPresets] = useState(initialPresets)
  // Configuração salva (muda ao "Salvar rascunho na unidade") e rascunho por unidade.
  const [savedSettings, setSavedSettings] = useState<Record<string, SimUnit>>({})
  const [drafts, setDrafts] = useState<Record<string, BotSettingsValue>>({})

  const [turns, setTurns] = useState<Turn[]>([])
  const [patient, setPatient] = useState<SimulatedPatient | null>(null)
  const [conversationUnitId, setConversationUnitId] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextId = useRef(1)

  const account = accounts.find((a) => a.id === accountId) ?? null
  const units = useMemo(() => (account ? account.units.map((u) => savedSettings[u.id] ?? u) : []), [account, savedSettings])

  const initialPatient = (): SimulatedPatient =>
    patientKind === 'known'
      ? {
          full_name: knownName.trim() || null,
          fields: {
            birth_date: knownBirth || null,
            insurance: knownInsurer ? { convenio_id: knownInsurer, card_number: knownCard.trim() || null } : null,
          },
        }
      : { full_name: null, fields: {} }

  const restart = () => {
    setTurns([])
    setPatient(null)
    setConversationUnitId(null)
    setSelected(null)
    setError(null)
  }

  const chooseAccount = (id: string) => {
    setAccountId(id)
    setDrafts({})
    setKnownInsurer('')
    restart()
  }

  const clara = turns.filter((t) => t.role === 'clara' && t.result)
  const lastResult = clara.at(-1)?.result ?? null
  const selectedResult = (selected !== null ? turns.find((t) => t.id === selected)?.result : null) ?? lastResult
  const handedOff = lastResult?.plan.some((e) => e.kind === 'handoff' || e.kind === 'loop_breaker') ?? false

  const send = async () => {
    const text = input.trim()
    if (!text || !account || sending) return
    const simulatedNow = simulatedLocal ? toSaoPauloIso(simulatedLocal) : null
    const sentAt = simulatedNow ? new Date(simulatedNow).toISOString() : new Date().toISOString()
    const patientTurn: Turn = { id: nextId.current++, role: 'patient', text, sent_at: sentAt }
    const history = turns
      .filter((t) => !t.extra && (t.historyText ?? t.text))
      .map((t) => ({ role: t.role, text: t.historyText ?? t.text, sent_at: t.sent_at }))

    setTurns((prev) => [...prev, patientTurn])
    setInput('')
    setSending(true)
    setError(null)

    const draftSettings = Object.fromEntries(
      Object.entries(drafts).filter(([id, d]) => {
        const saved = units.find((u) => u.id === id)
        return saved && !sameSettings(saved.settings, d)
      })
    )

    try {
      const res = await fetch('/api/admin/clara/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: account.id,
          draft_settings: draftSettings,
          simulated_now: simulatedNow,
          patient: patient ?? initialPatient(),
          conversation_unit_id: conversationUnitId,
          history,
          message: text,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível simular agora.')
        return
      }
      const result = data as SimulationResult
      const replyTurns: Turn[] = []
      const [first, ...rest] = result.outgoing.length ? result.outgoing : [result.reply]
      replyTurns.push({ id: nextId.current++, role: 'clara', text: result.reply || first || '', historyText: result.reply, sent_at: result.now, result })
      for (const extra of rest) replyTurns.push({ id: nextId.current++, role: 'clara', text: extra, sent_at: result.now, extra: true })
      setTurns((prev) => [...prev, ...replyTurns])
      setPatient(result.patient)
      setConversationUnitId(result.conversation_unit_id)
      setSelected(null)
    } catch {
      setError('Não foi possível falar com o servidor. Verifique a conexão e tente de novo.')
    } finally {
      setSending(false)
    }
  }

  const transcript = () =>
    formatSimulationTranscript({
      accountName: account?.name ?? '',
      simulatedNow: simulatedLocal ? toSaoPauloIso(simulatedLocal) : null,
      turns: turns.map((t) => ({ role: t.role, text: t.text, effects: t.result?.plan_text })),
    })

  return (
    <div className="space-y-6">
      <div role="note" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Use apenas dados fictícios. Nada aqui é salvo.
      </div>

      <section className="grid gap-4 rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)] md:grid-cols-3">
        <div>
          <Label htmlFor="sim-account">Account</Label>
          <select
            id="sim-account"
            value={accountId}
            onChange={(e) => chooseAccount(e.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-[var(--navy-06)] bg-white px-2 text-sm"
          >
            <option value="">Escolher…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="sim-now">Data e hora simulada (São Paulo)</Label>
          <Input
            id="sim-now"
            type="datetime-local"
            value={simulatedLocal}
            onChange={(e) => setSimulatedLocal(e.target.value)}
            className="mt-1"
          />
          <p className="mt-1 text-xs text-gray-400">Vazio = agora. Muda a data do prompt, os horários livres e o horário de atendimento humano.</p>
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-gray-900">Paciente</legend>
          <div className="mt-1 flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="sim-patient" checked={patientKind === 'new'} onChange={() => setPatientKind('new')} />
              Novo
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="sim-patient" checked={patientKind === 'known'} onChange={() => setPatientKind('known')} />
              Já identificado
            </label>
          </div>
          {patientKind === 'known' && (
            <div className="mt-2 space-y-2">
              <Input aria-label="Nome fictício" placeholder="Nome fictício" value={knownName} onChange={(e) => setKnownName(e.target.value)} />
              <select
                aria-label="Convênio"
                value={knownInsurer}
                onChange={(e) => setKnownInsurer(e.target.value)}
                className="h-9 w-full rounded-md border border-[var(--navy-06)] bg-white px-2 text-sm"
              >
                <option value="">Convênio: não informado</option>
                <option value="PARTICULAR">Particular</option>
                {(account?.insurers ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <Input aria-label="Carteirinha fictícia" placeholder="Carteirinha" value={knownCard} onChange={(e) => setKnownCard(e.target.value)} />
                <Input aria-label="Nascimento" type="date" value={knownBirth} onChange={(e) => setKnownBirth(e.target.value)} />
              </div>
              {turns.length > 0 && <p className="text-xs text-gray-400">Vale ao reiniciar a conversa.</p>}
            </div>
          )}
        </fieldset>
      </section>

      {account && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-medium text-gray-900">Rascunho por unidade</h2>
            <p className="text-sm text-gray-400">
              Mude aqui sem salvar: o simulador usa o rascunho na próxima mensagem. “Salvar rascunho na unidade” passa a valer em produção.
            </p>
          </div>
          {units.map((u) => {
            const draft = drafts[u.id]
            const changed = draft && !sameSettings(draft, u.settings)
            return (
              <details key={`${account.id}-${u.id}`} className="rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
                <summary className="flex cursor-pointer items-center gap-2 px-5 py-3 text-sm font-medium text-gray-900">
                  {u.name}
                  {changed && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-normal text-amber-800">rascunho</span>}
                </summary>
                <div className="border-t border-[var(--navy-06)] p-5">
                  <WorkspaceBotSettingsForm
                    idPrefix={`sim-${u.id}`}
                    value={u.settings}
                    presets={presets}
                    presetId={u.presetId}
                    submitLabel="Salvar rascunho na unidade"
                    onChange={(next) => setDrafts((prev) => ({ ...prev, [u.id]: next }))}
                    onSubmit={async (next, presetId) => {
                      const res = await saveWorkspaceBotSettings(u.id, next, presetId)
                      if (res.data === null) return res.error
                      setSavedSettings((prev) => ({
                        ...prev,
                        [u.id]: { ...u, settings: next, presetId: res.data.bot_preset_id ?? u.presetId },
                      }))
                      return null
                    }}
                    onSaveAsPreset={async (name, value) => {
                      const res = await createPreset({ ...value, name })
                      if (res.data === null) return res.error
                      const created = res.data.preset
                      setPresets((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))
                      return null
                    }}
                  />
                </div>
              </details>
            )
          })}
        </section>
      )}

      {account && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="flex min-h-[480px] flex-col rounded-xl border border-[var(--navy-06)] bg-[var(--navy-06)]/40 shadow-[var(--shadow-sm)]">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--navy-06)] bg-white px-4 py-2.5">
              <h2 className="text-sm font-medium text-gray-900">Conversa simulada</h2>
              <div className="flex gap-2">
                <CopyButton label="Copiar conversa" text={transcript()} />
                <Button type="button" variant="outline" size="sm" onClick={restart}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  Reiniciar conversa
                </Button>
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {turns.length === 0 && <p className="text-center text-sm text-gray-400">Escreva como se fosse o paciente.</p>}
              {turns.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={!t.result}
                  onClick={() => setSelected(t.id)}
                  className={cn('block w-full text-left', t.result && 'cursor-pointer', selected === t.id && 'rounded-2xl ring-2 ring-[var(--cyan)]')}
                  aria-label={t.result ? 'Ver por dentro desta resposta' : undefined}
                >
                  <Bubble turn={t} />
                </button>
              ))}
              {sending && <p className="text-right text-xs text-gray-400">Clara está pensando…</p>}
            </div>
            {handedOff && (
              <p className="border-t border-[var(--navy-06)] bg-white px-4 py-2 text-xs text-gray-500">
                A conversa foi para a equipe: em produção a Clara pausaria aqui. Reinicie para testar de novo.
              </p>
            )}
            {error && <p className="border-t border-[var(--navy-06)] bg-white px-4 py-2 text-xs text-red-500">{error}</p>}
            <div className="flex items-end gap-2 border-t border-[var(--navy-06)] bg-white p-3">
              <Textarea
                aria-label="Mensagem do paciente"
                value={input}
                rows={1}
                disabled={handedOff}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                placeholder="Mensagem do paciente"
                className="min-h-[44px] flex-1 resize-none rounded-2xl"
              />
              <Button
                type="button"
                onClick={send}
                disabled={!input.trim() || sending || handedOff}
                aria-label="Enviar"
                className="size-11 shrink-0 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
            <h2 className="mb-4 text-sm font-medium text-gray-900">
              Por dentro{selected !== null && lastResult !== selectedResult ? ' (resposta selecionada)' : ''}
            </h2>
            <InsidePanel result={selectedResult} />
          </section>
        </div>
      )}
    </div>
  )
}
