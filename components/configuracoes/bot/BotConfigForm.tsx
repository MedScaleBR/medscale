'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { TagInput } from './TagInput'
import { FaqInput, type FaqItem } from './FaqInput'
import { BotPreview } from './BotPreview'
import { BotStatusBadge } from './BotStatusBadge'
import { BotOnboarding } from './BotOnboarding'
import { HandoffHoursSettings } from './HandoffHoursSettings'
import { PushToggle } from '@/components/push/PushToggle'
import { BOT_NAME } from '@/lib/bot/constants'
import type { Database } from '@/types/database'

type BotConfigRow = Database['public']['Tables']['bot_config']['Row']
type HandoffHour = Database['public']['Tables']['handoff_hours']['Row']

interface FormState {
  specialty: string
  procedures: string[]
  insurance_plans: string[]
  accepts_private: boolean
  consultation_price_from: number | null
  business_hours: string
  address: string
  directions_parking: string
  contact_info: string
  payment_methods: string[]
  pricing_info: string
  exam_preparation: string
  policies: string
  tone_of_voice: string
  handoff_instructions: string
  forbidden_actions: string
  faq: FaqItem[]
  handoff_number: string
  handoff_message: string
  welcome_message: string
  out_of_hours_message: string
}

interface BotConfigFormProps {
  initialConfig: BotConfigRow | null
  initialHandoffHours: HandoffHour[]
  doctorPhone: string
  hasMetaAppSecret: boolean
  initialHandoffPushEnabled: boolean
}

function toFormState(config: BotConfigRow | null): FormState {
  return {
    specialty: config?.specialty ?? '',
    procedures: config?.procedures ?? [],
    insurance_plans: config?.insurance_plans ?? [],
    accepts_private: config?.accepts_private ?? true,
    consultation_price_from: config?.consultation_price_from ?? null,
    business_hours: config?.business_hours ?? 'Segunda a sexta, 08h às 17h. Sábados, 08h às 12h.',
    address: config?.address ?? '',
    directions_parking: config?.directions_parking ?? '',
    contact_info: config?.contact_info ?? '',
    payment_methods: config?.payment_methods ?? [],
    pricing_info: config?.pricing_info ?? '',
    exam_preparation: config?.exam_preparation ?? '',
    policies: config?.policies ?? '',
    tone_of_voice: config?.tone_of_voice ?? '',
    handoff_instructions: config?.handoff_instructions ?? '',
    forbidden_actions: config?.forbidden_actions ?? '',
    faq: config?.faq ?? [],
    handoff_number: config?.handoff_number ?? '',
    handoff_message: config?.handoff_message ?? 'Vou te conectar com nossa equipe agora. Um momento!',
    welcome_message: config?.welcome_message ?? 'Olá! Posso ajudar com agendamentos e informações. Como posso ajudar?',
    out_of_hours_message:
      config?.out_of_hours_message ??
      'No momento nossa equipe não está disponível para atendimento humano. Já registrei sua mensagem e vamos retornar assim que possível. Enquanto isso, posso continuar te ajudando por aqui!',
  }
}

export function BotConfigForm({
  initialConfig,
  initialHandoffHours,
  doctorPhone,
  hasMetaAppSecret,
  initialHandoffPushEnabled,
}: BotConfigFormProps) {
  const [config, setConfig] = useState(initialConfig)
  const [form, setForm] = useState<FormState>(toFormState(initialConfig))
  const [testNumber, setTestNumber] = useState(doctorPhone)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Workspaces que conectaram antes do App Secret existir ficam com is_active
  // = true mas sem esse campo — reabrimos o wizard pra elas até serem
  // reverificadas, senão não haveria como preencher o campo que falta.
  const [metaAppSecretMissing, setMetaAppSecretMissing] = useState(!hasMetaAppSecret)
  const [showConnectionEditor, setShowConnectionEditor] = useState(false)

  const refreshConfig = async () => {
    const res = await fetch('/api/bot/config')
    if (res.ok) {
      const data = await res.json()
      setConfig(data)
      setForm(toFormState(data))
    }
    setMetaAppSecretMissing(false)
    setShowConnectionEditor(false)
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

  const handleDisconnect = async () => {
    if (
      !confirm(
        'Desconectar o número do WhatsApp? O bot para de responder os pacientes na hora e as credenciais da Meta são apagadas. ' +
          'A personalidade, FAQ e horários ficam salvos, mas você terá que refazer a conexão para reativar.'
      )
    )
      return
    setDisconnecting(true)
    setError(null)
    try {
      const res = await fetch('/api/bot/onboarding/disconnect', { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? 'Não foi possível desconectar.')
        return
      }
      await refreshConfig()
    } finally {
      setDisconnecting(false)
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

  const needsOnboarding = !config?.is_active || (config?.number_source === 'own' && metaAppSecretMissing) || showConnectionEditor

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
            {!needsOnboarding && config?.number_source === 'own' && (
              <button
                onClick={() => setShowConnectionEditor(true)}
                className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
              >
                Editar conexão
              </button>
            )}
            {!needsOnboarding && config?.is_active && (
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="text-xs text-red-400 hover:text-red-600 hover:underline disabled:opacity-50"
              >
                {disconnecting ? 'Desconectando...' : 'Desconectar'}
              </button>
            )}
          </div>
        </div>
        {needsOnboarding && (
          <>
            <Separator className="my-4" />
            {config?.is_active && metaAppSecretMissing && (
              <p className="mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
                Sua conexão foi feita antes de exigirmos o App Secret, necessário para validar as mensagens
                recebidas — sem ele o bot não responde. Preencha os campos abaixo (o Phone Number ID e token
                podem ser os mesmos de antes) para reconectar.
              </p>
            )}
            <BotOnboarding
              initialNumberSource={config?.number_source ?? null}
              webhookVerifyToken={config?.webhook_verify_token ?? null}
              onVerified={refreshConfig}
            />
            {showConnectionEditor && !metaAppSecretMissing && (
              <button
                onClick={() => setShowConnectionEditor(false)}
                className="mt-3 text-xs text-gray-400 hover:text-gray-600"
              >
                Cancelar edição
              </button>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[2fr_1fr]">
        <div className="columns-1 gap-6 md:columns-2">
          <section className="mb-6 break-inside-avoid rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
            <h3 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">Identidade do bot</h3>
            <div className="space-y-4">
              <div>
                <Label>Nome do assistente</Label>
                <p className="mt-1 text-sm text-gray-700">{BOT_NAME}</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  Nome padrão da MedScale em todas as clínicas — não é configurável por aqui.
                </p>
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

          <section className="mb-6 break-inside-avoid rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
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
              <div>
                <Label>Formas de pagamento</Label>
                <p className="mb-2 text-xs text-gray-400">Digite e pressione Enter para adicionar</p>
                <TagInput
                  value={form.payment_methods}
                  onChange={(v) => setForm((f) => ({ ...f, payment_methods: v }))}
                  placeholder="Ex: Pix, Cartão, Dinheiro"
                />
              </div>
              <div>
                <Label htmlFor="pricing_info">Preços — detalhes por procedimento</Label>
                <p className="mb-1 text-xs text-gray-400">
                  Use para valores de exames e procedimentos além da consulta acima
                </p>
                <Textarea
                  id="pricing_info"
                  value={form.pricing_info}
                  onChange={(e) => setForm((f) => ({ ...f, pricing_info: e.target.value }))}
                  rows={3}
                  className="mt-1"
                  placeholder="Ex: Retorno: R$150. Exame X: R$300."
                />
              </div>
              <div>
                <Label htmlFor="exam_preparation">Preparo para exames/procedimentos</Label>
                <Textarea
                  id="exam_preparation"
                  value={form.exam_preparation}
                  onChange={(e) => setForm((f) => ({ ...f, exam_preparation: e.target.value }))}
                  rows={3}
                  className="mt-1"
                  placeholder="Ex: Jejum de 8h para exame X. Trazer exames anteriores."
                />
              </div>
            </div>
          </section>

          <section className="mb-6 break-inside-avoid rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
            <h3 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">Local e contato</h3>
            <div className="space-y-4">
              <div>
                <Label htmlFor="address">Endereço</Label>
                <Input
                  id="address"
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="Ex: Rua Exemplo, 123 - Sala 45, Bairro, Cidade/UF"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="directions_parking">Como chegar / estacionamento</Label>
                <Textarea
                  id="directions_parking"
                  value={form.directions_parking}
                  onChange={(e) => setForm((f) => ({ ...f, directions_parking: e.target.value }))}
                  rows={2}
                  className="mt-1"
                  placeholder="Ex: Estacionamento próprio no local. Em frente ao metrô X."
                />
              </div>
              <div>
                <Label htmlFor="contact_info">Contatos</Label>
                <Textarea
                  id="contact_info"
                  value={form.contact_info}
                  onChange={(e) => setForm((f) => ({ ...f, contact_info: e.target.value }))}
                  rows={2}
                  className="mt-1"
                  placeholder="Ex: Telefone fixo, e-mail, Instagram"
                />
              </div>
            </div>
          </section>

          <section className="mb-6 break-inside-avoid rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
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

          <section className="mb-6 break-inside-avoid rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
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

          <section className="mb-6 break-inside-avoid rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
            <h3 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">Tom de voz e políticas</h3>
            <div className="space-y-4">
              <div>
                <Label htmlFor="tone_of_voice">Tom de voz da Maria</Label>
                <p className="mb-1 text-xs text-gray-400">Como ela deve soar ao conversar com o paciente</p>
                <Textarea
                  id="tone_of_voice"
                  value={form.tone_of_voice}
                  onChange={(e) => setForm((f) => ({ ...f, tone_of_voice: e.target.value }))}
                  rows={2}
                  className="mt-1"
                  placeholder="Ex: Acolhedora e calma, trata o paciente por 'você', evita gírias."
                />
              </div>
              <div>
                <Label htmlFor="policies">Políticas do consultório</Label>
                <p className="mb-1 text-xs text-gray-400">Cancelamento, atraso, remarcação, etc.</p>
                <Textarea
                  id="policies"
                  value={form.policies}
                  onChange={(e) => setForm((f) => ({ ...f, policies: e.target.value }))}
                  rows={3}
                  className="mt-1"
                  placeholder="Ex: Cancelamentos com menos de 24h estão sujeitos a cobrança."
                />
              </div>
              <div>
                <Label htmlFor="forbidden_actions">Limites adicionais — o que a Maria NUNCA deve fazer</Label>
                <Textarea
                  id="forbidden_actions"
                  value={form.forbidden_actions}
                  onChange={(e) => setForm((f) => ({ ...f, forbidden_actions: e.target.value }))}
                  rows={3}
                  className="mt-1"
                  placeholder="Ex: Nunca confirmar encaixe sem checar a agenda. Nunca falar de outros pacientes."
                />
              </div>
            </div>
          </section>

          <section className="mb-6 break-inside-avoid rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
            <h3 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">Perguntas frequentes</h3>
            <p className="mb-3 text-xs text-gray-400">A Maria responde direto com base nessas perguntas e respostas</p>
            <FaqInput value={form.faq} onChange={(v) => setForm((f) => ({ ...f, faq: v }))} />
          </section>

          <section className="mb-6 break-inside-avoid rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
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
                <Label htmlFor="handoff_instructions">Quando transferir para humano — casos adicionais</Label>
                <p className="mb-1 text-xs text-gray-400">
                  Além dos casos padrão (pedido explícito, urgência, etc.), liste situações específicas do
                  seu consultório que devem ser transferidas imediatamente
                </p>
                <Textarea
                  id="handoff_instructions"
                  value={form.handoff_instructions}
                  onChange={(e) => setForm((f) => ({ ...f, handoff_instructions: e.target.value }))}
                  rows={3}
                  className="mt-1"
                  placeholder="Ex: Se o paciente mencionar reação alérgica, transferir imediatamente."
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

          <section className="mb-6 break-inside-avoid rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
            <h3 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">Notificações de handoff</h3>
            <PushToggle initialHandoffEnabled={initialHandoffPushEnabled} />
          </section>
        </div>

        <div className="hidden xl:block">
          <BotPreview
            config={{
              specialty: form.specialty,
              procedures: form.procedures,
              insurance_plans: form.insurance_plans,
              handoff_number: form.handoff_number,
              welcome_message: form.welcome_message,
            }}
          />
        </div>
      </div>

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
  )
}
