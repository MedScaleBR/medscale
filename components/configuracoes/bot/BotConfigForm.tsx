'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { TagInput } from './TagInput'
import { BotPreview } from './BotPreview'
import { BotStatusBadge } from './BotStatusBadge'
import { BotOnboarding } from './BotOnboarding'
import { HandoffHoursSettings } from './HandoffHoursSettings'
import type { Database } from '@/types/database'

type BotConfigRow = Database['public']['Tables']['bot_config']['Row']
type HandoffHour = Database['public']['Tables']['handoff_hours']['Row']

interface FormState {
  bot_name: string
  specialty: string
  procedures: string[]
  insurance_plans: string[]
  accepts_private: boolean
  consultation_price_from: number | null
  business_hours: string
  handoff_number: string
  handoff_message: string
  welcome_message: string
  out_of_hours_message: string
}

interface BotConfigFormProps {
  initialConfig: BotConfigRow | null
  initialHandoffHours: HandoffHour[]
  doctorPhone: string
}

function toFormState(config: BotConfigRow | null): FormState {
  return {
    bot_name: config?.bot_name ?? 'Assistente',
    specialty: config?.specialty ?? '',
    procedures: config?.procedures ?? [],
    insurance_plans: config?.insurance_plans ?? [],
    accepts_private: config?.accepts_private ?? true,
    consultation_price_from: config?.consultation_price_from ?? null,
    business_hours: config?.business_hours ?? 'Segunda a sexta, 08h às 17h. Sábados, 08h às 12h.',
    handoff_number: config?.handoff_number ?? '',
    handoff_message: config?.handoff_message ?? 'Vou te conectar com nossa equipe agora. Um momento!',
    welcome_message: config?.welcome_message ?? 'Olá! Posso ajudar com agendamentos e informações. Como posso ajudar?',
    out_of_hours_message:
      config?.out_of_hours_message ??
      'No momento nossa equipe não está disponível para atendimento humano. Já registrei sua mensagem e vamos retornar assim que possível. Enquanto isso, posso continuar te ajudando por aqui!',
  }
}

export function BotConfigForm({ initialConfig, initialHandoffHours, doctorPhone }: BotConfigFormProps) {
  const [config, setConfig] = useState(initialConfig)
  const [form, setForm] = useState<FormState>(toFormState(initialConfig))
  const [testNumber, setTestNumber] = useState(doctorPhone)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshConfig = async () => {
    const res = await fetch('/api/bot/config')
    if (res.ok) {
      const data = await res.json()
      setConfig(data)
      setForm(toFormState(data))
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/bot/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao salvar.')
      } else {
        setConfig(data)
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleTestMessage = async () => {
    if (!testNumber) return
    setTesting(true)
    try {
      await fetch('/api/bot/test-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testNumber }),
      })
    } finally {
      setTesting(false)
    }
  }

  const needsOnboarding = !config?.is_active

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-gray-900">Conexão WhatsApp</h2>
            <p className="mt-0.5 text-xs text-gray-400">Número usado pelo bot para conversar com os pacientes.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border-none bg-[var(--cyan-10)] px-2.5 py-1 text-[10px] font-semibold tracking-wide text-[var(--cyan-dark)]">
              ATENDIMENTO 24/7
            </span>
            <BotStatusBadge isActive={config?.is_active ?? false} onboardingStep={config?.onboarding_step ?? 'pending'} />
          </div>
        </div>
        {needsOnboarding && (
          <>
            <Separator className="my-4" />
            <BotOnboarding
              initialNumberSource={config?.number_source ?? null}
              webhookVerifyToken={config?.webhook_verify_token ?? null}
              onVerified={refreshConfig}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="space-y-6">
          <section className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
            <h3 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">Identidade do bot</h3>
            <div className="space-y-4">
              <div>
                <Label htmlFor="bot_name">Como o bot se apresenta</Label>
                <Input
                  id="bot_name"
                  value={form.bot_name}
                  onChange={(e) => setForm((f) => ({ ...f, bot_name: e.target.value }))}
                  placeholder="Ex: Assistente da Dra. Ana"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="specialty">Especialidade</Label>
                <Input
                  id="specialty"
                  value={form.specialty}
                  onChange={(e) => setForm((f) => ({ ...f, specialty: e.target.value }))}
                  placeholder="Ex: Cirurgia Plástica"
                  className="mt-1"
                />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
            <h3 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">Serviços e convênios</h3>
            <div className="space-y-4">
              <div>
                <Label>Procedimentos realizados</Label>
                <p className="mb-2 text-xs text-gray-400">Digite e pressione Enter para adicionar</p>
                <TagInput value={form.procedures} onChange={(v) => setForm((f) => ({ ...f, procedures: v }))} placeholder="Ex: Rinoplastia" />
              </div>
              <div>
                <Label>Convênios aceitos</Label>
                <p className="mb-2 text-xs text-gray-400">Deixe vazio se não aceita convênios</p>
                <TagInput
                  value={form.insurance_plans}
                  onChange={(v) => setForm((f) => ({ ...f, insurance_plans: v }))}
                  placeholder="Ex: Unimed"
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="accepts_private"
                  checked={form.accepts_private}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, accepts_private: v }))}
                />
                <Label htmlFor="accepts_private">Aceita consultas particulares</Label>
              </div>
              <div>
                <Label htmlFor="price">Valor da consulta particular a partir de (R$)</Label>
                <Input
                  id="price"
                  type="number"
                  value={form.consultation_price_from ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, consultation_price_from: e.target.value ? Number(e.target.value) : null }))
                  }
                  placeholder="Deixe vazio para não informar preço"
                  className="mt-1"
                />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
            <h3 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">Horários de atendimento</h3>
            <Label htmlFor="business_hours">Descreva os horários em texto livre</Label>
            <Textarea
              id="business_hours"
              value={form.business_hours}
              onChange={(e) => setForm((f) => ({ ...f, business_hours: e.target.value }))}
              rows={2}
              className="mt-1"
              placeholder="Ex: Segunda a sexta das 08h às 17h. Sábados das 08h às 12h."
            />
            <p className="mt-1.5 text-xs text-gray-400">
              Texto exibido ao paciente — o bot em si conversa e agenda 24/7, nunca fica fora do ar.
              Quem controla de fato quais horários existem para agendar é a{' '}
              <a href="/configuracoes" className="text-[var(--cyan-dark)] hover:underline">
                disponibilidade cadastrada
              </a>
              .
            </p>
          </section>

          <section className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
            <h3 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">Mensagens automáticas</h3>
            <div className="space-y-4">
              <div>
                <Label htmlFor="welcome_message">Boas-vindas (primeira mensagem)</Label>
                <Textarea
                  id="welcome_message"
                  value={form.welcome_message}
                  onChange={(e) => setForm((f) => ({ ...f, welcome_message: e.target.value }))}
                  rows={2}
                  className="mt-1"
                />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
            <h3 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">Atendimento humano (handoff)</h3>
            <div className="space-y-4">
              <div>
                <Label htmlFor="handoff_number">Número para transferência</Label>
                <p className="mb-1 text-xs text-gray-400">Formato internacional: +5511999999999</p>
                <Input
                  id="handoff_number"
                  value={form.handoff_number}
                  onChange={(e) => setForm((f) => ({ ...f, handoff_number: e.target.value }))}
                  placeholder="+5511999999999"
                  className="mt-1 font-mono"
                />
              </div>
              <div>
                <Label htmlFor="handoff_message">Mensagem antes de transferir</Label>
                <Textarea
                  id="handoff_message"
                  value={form.handoff_message}
                  onChange={(e) => setForm((f) => ({ ...f, handoff_message: e.target.value }))}
                  rows={2}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="out_of_hours_message">Mensagem quando ninguém está disponível</Label>
                <p className="mb-1 text-xs text-gray-400">
                  Enviada no lugar da transferência quando o paciente pede humano fora do horário
                  abaixo — o bot continua a conversa sozinho normalmente.
                </p>
                <Textarea
                  id="out_of_hours_message"
                  value={form.out_of_hours_message}
                  onChange={(e) => setForm((f) => ({ ...f, out_of_hours_message: e.target.value }))}
                  rows={2}
                  className="mt-1"
                />
              </div>

              <div className="border-t border-[var(--navy-06)] pt-4">
                <Label className="mb-1 block">Horário de atendimento humano</Label>
                <HandoffHoursSettings initialHours={initialHandoffHours} />
              </div>
            </div>
          </section>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-[var(--cyan)] font-medium text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
            >
              {saving ? 'Salvando...' : saved ? '✓ Salvo' : 'Salvar configurações'}
            </Button>

            <div className="flex items-center gap-2">
              <Input
                value={testNumber}
                onChange={(e) => setTestNumber(e.target.value)}
                placeholder="+5511999999999"
                className="w-40 font-mono text-xs"
              />
              <Button variant="outline" onClick={handleTestMessage} disabled={testing || !config?.is_active}>
                {testing ? 'Enviando...' : 'Enviar mensagem de teste'}
              </Button>
            </div>
          </div>
        </div>

        <div className="hidden lg:block">
          <BotPreview
            config={{
              bot_name: form.bot_name,
              specialty: form.specialty,
              procedures: form.procedures,
              insurance_plans: form.insurance_plans,
              handoff_number: form.handoff_number,
              welcome_message: form.welcome_message,
            }}
          />
        </div>
      </div>
    </div>
  )
}
