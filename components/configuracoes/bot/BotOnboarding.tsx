'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { NumberSource } from '@/types/database'

interface BotOnboardingProps {
  initialNumberSource: NumberSource | null
  webhookVerifyToken: string | null
  onVerified: () => void
}

export function BotOnboarding({ initialNumberSource, webhookVerifyToken, onVerified }: BotOnboardingProps) {
  const [flow, setFlow] = useState<NumberSource | null>(initialNumberSource)

  if (!flow) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button
          onClick={() => setFlow('own')}
          className="rounded-xl border border-[var(--navy-06)] p-5 text-left transition-colors hover:border-[var(--cyan)] hover:bg-[var(--cyan-10)]"
        >
          <p className="text-sm font-medium text-gray-900">Já tenho um número</p>
          <p className="mt-1 text-xs text-gray-400">
            Você cria seu próprio App na Meta for Developers e traz o Phone Number ID e o token.
          </p>
        </button>
        <button
          onClick={() => setFlow('medscale')}
          className="rounded-xl border border-[var(--navy-06)] p-5 text-left transition-colors hover:border-[var(--cyan)] hover:bg-[var(--cyan-10)]"
        >
          <p className="text-sm font-medium text-gray-900">Quero um número novo</p>
          <p className="mt-1 text-xs text-gray-400">
            A equipe MedScale provisiona um número para você (leva 1-2 dias úteis).
          </p>
        </button>
      </div>
    )
  }

  if (flow === 'own') {
    return <OwnNumberWizard webhookVerifyToken={webhookVerifyToken} onBack={() => setFlow(null)} onVerified={onVerified} />
  }

  return <MedScaleNumberRequest onBack={() => setFlow(null)} onRequested={onVerified} />
}

function OwnNumberWizard({
  webhookVerifyToken,
  onBack,
  onVerified,
}: {
  webhookVerifyToken: string | null
  onBack: () => void
  onVerified: () => void
}) {
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [metaToken, setMetaToken] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/whatsapp/webhook` : '/api/whatsapp/webhook'

  const handleVerify = async () => {
    setVerifying(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/bot/onboarding/verify-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number_id: phoneNumberId, meta_token: metaToken }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível verificar.')
        return
      }
      setSuccess(`Conectado: ${data.displayPhoneNumber ?? phoneNumberId}`)
      onVerified()
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-xs text-gray-400 hover:text-gray-600">
        ← Voltar
      </button>

      <ol className="space-y-4 text-sm text-gray-700">
        <li>
          <p className="font-medium text-gray-900">1. Crie um App na Meta for Developers</p>
          <p className="mt-0.5 text-xs text-gray-400">
            Tipo <strong>Business</strong>, depois adicione o produto WhatsApp.{' '}
            <a
              href="https://developers.facebook.com/apps/creation/"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--cyan-dark)] hover:underline"
            >
              Criar App →
            </a>
          </p>
        </li>
        <li>
          <p className="font-medium text-gray-900">2. Configure o Webhook</p>
          <div className="mt-1 space-y-1 rounded-lg bg-[var(--navy-06)] p-3 text-xs">
            <p>
              URL: <code className="font-mono">{webhookUrl}</code>
            </p>
            <p>
              Verify Token: <code className="font-mono">{webhookVerifyToken ?? '(salve a configuração primeiro)'}</code>
            </p>
            <p>Campos para assinar: messages</p>
          </div>
        </li>
        <li>
          <p className="font-medium text-gray-900">3. Cole o Phone Number ID e o token permanente</p>
          <p className="mt-0.5 text-xs text-gray-400">
            Gere um System User Token sem expiração no Meta Business Manager — nunca o token temporário de 24h.
          </p>
          <div className="mt-2 space-y-2">
            <div>
              <Label htmlFor="onb_phone_number_id">Phone Number ID</Label>
              <Input id="onb_phone_number_id" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="onb_meta_token">Token permanente</Label>
              <Input id="onb_meta_token" type="password" value={metaToken} onChange={(e) => setMetaToken(e.target.value)} />
            </div>
          </div>
        </li>
      </ol>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}

      <Button
        onClick={handleVerify}
        disabled={verifying || !phoneNumberId || !metaToken}
        className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
      >
        {verifying ? 'Verificando...' : 'Verificar conexão'}
      </Button>
    </div>
  )
}

function MedScaleNumberRequest({ onBack, onRequested }: { onBack: () => void; onRequested: () => void }) {
  const [form, setForm] = useState({ display_name: '', desired_number: '', document: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requested, setRequested] = useState(false)

  const handleSubmit = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/bot/onboarding/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Não foi possível enviar o pedido.')
        return
      }
      setRequested(true)
      onRequested()
    } finally {
      setSaving(false)
    }
  }

  if (requested) {
    return (
      <p className="text-sm text-gray-600">
        Pedido enviado! A equipe MedScale vai provisionar seu número (1-2 dias úteis) e avisar por e-mail. A Meta liga para
        o número informado com um código de verificação de 6 dígitos.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-xs text-gray-400 hover:text-gray-600">
        ← Voltar
      </button>

      <div>
        <Label htmlFor="display_name">Nome para exibição no WhatsApp</Label>
        <Input
          id="display_name"
          value={form.display_name}
          onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
        />
      </div>
      <div>
        <Label htmlFor="desired_number">Número desejado (opcional)</Label>
        <Input
          id="desired_number"
          placeholder="Deixe em branco para a MedScale escolher"
          value={form.desired_number}
          onChange={(e) => setForm((f) => ({ ...f, desired_number: e.target.value }))}
        />
      </div>
      <div>
        <Label htmlFor="document">CNPJ ou CPF para registro na Meta</Label>
        <Input id="document" value={form.document} onChange={(e) => setForm((f) => ({ ...f, document: e.target.value }))} />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <Button
        onClick={handleSubmit}
        disabled={saving || !form.display_name || !form.document}
        className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
      >
        {saving ? 'Enviando...' : 'Solicitar número'}
      </Button>
    </div>
  )
}
