'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AccountPlan } from '@/types/database'

const PLAN_OPTIONS: { value: AccountPlan; label: string }[] = [
  { value: 'essencial', label: 'Essencial' },
  { value: 'avancado', label: 'Avançado' },
  { value: 'premium', label: 'Premium' },
]

export function NewAccountForm() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', owner_email: '', plan: 'essencial' as AccountPlan, billing_email: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ inviteUrl: string; emailSent: boolean } | null>(null)

  const handleSubmit = async () => {
    if (!form.name || !form.owner_email) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao criar account.')
        return
      }
      setResult({ inviteUrl: `${location.origin}/invite/${data.invite.token}`, emailSent: data.emailSent })
    } finally {
      setSaving(false)
    }
  }

  if (result) {
    return (
      <div className="space-y-4 rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <p className="text-sm text-green-700">Account criada com sucesso!</p>
        {result.emailSent ? (
          <p className="text-sm text-gray-600">O convite foi enviado por e-mail para {form.owner_email}.</p>
        ) : (
          <div>
            <p className="text-sm text-gray-600">
              O envio automático de e-mail não está configurado — copie o link abaixo e envie manualmente para{' '}
              {form.owner_email}:
            </p>
            <code className="mt-2 block break-all rounded-lg bg-[var(--navy-06)] p-3 text-xs">{result.inviteUrl}</code>
          </div>
        )}
        <Button onClick={() => router.push('/admin/accounts')} variant="outline">
          Ver todas as accounts
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
      <div>
        <Label htmlFor="name">Nome do cliente</Label>
        <Input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </div>
      <div>
        <Label htmlFor="owner_email">E-mail do owner (recebe o convite)</Label>
        <Input
          id="owner_email"
          type="email"
          value={form.owner_email}
          onChange={(e) => setForm((f) => ({ ...f, owner_email: e.target.value }))}
        />
      </div>
      <div>
        <Label>Plano</Label>
        <Select value={form.plan} onValueChange={(v) => v && setForm((f) => ({ ...f, plan: v as AccountPlan }))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLAN_OPTIONS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="billing_email">E-mail de cobrança (opcional)</Label>
        <Input
          id="billing_email"
          type="email"
          value={form.billing_email}
          onChange={(e) => setForm((f) => ({ ...f, billing_email: e.target.value }))}
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <Button
        onClick={handleSubmit}
        disabled={saving}
        className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
      >
        {saving ? 'Criando...' : 'Criar account e enviar convite'}
      </Button>
    </div>
  )
}
