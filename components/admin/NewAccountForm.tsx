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
import { cn } from '@/lib/utils'
import { Mail, UserPlus, UserX } from 'lucide-react'
import type { AccountPlan } from '@/types/database'

const PLAN_OPTIONS: { value: AccountPlan; label: string }[] = [
  { value: 'essencial', label: 'Essencial' },
  { value: 'avancado', label: 'Avançado' },
  { value: 'premium', label: 'Premium' },
]

type Mode = 'invite' | 'assign' | 'none'

export function NewAccountForm() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('invite')
  const [form, setForm] = useState({ name: '', owner_email: '', plan: 'essencial' as AccountPlan, billing_email: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    assignedDirectly?: boolean
    noOwner?: boolean
    inviteUrl?: string
    emailSent?: boolean
  } | null>(null)

  const handleSubmit = async () => {
    if (!form.name) return
    if (mode !== 'none' && !form.owner_email) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          owner_email: mode === 'none' ? '' : form.owner_email,
          assignDirectly: mode === 'assign',
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao criar account.')
        return
      }
      if (data.noOwner) {
        setResult({ noOwner: true })
      } else if (data.assignedDirectly) {
        setResult({ assignedDirectly: true })
      } else {
        setResult({
          inviteUrl: `${location.origin}/invite/${data.invite.token}`,
          emailSent: data.emailSent,
        })
      }
    } finally {
      setSaving(false)
    }
  }

  if (result) {
    return (
      <div className="space-y-4 rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <p className="text-sm text-green-700">Account criada com sucesso!</p>
        {result.noOwner ? (
          <p className="text-sm text-gray-600">
            Criada sem ninguém vinculado. Convide ou atribua o owner depois, na página da própria account.
          </p>
        ) : result.assignedDirectly ? (
          <p className="text-sm text-gray-600">
            {form.owner_email} já tem acesso como owner — entrou direto, sem convite nem e-mail nenhum.
          </p>
        ) : result.emailSent ? (
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
      <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => {
            setMode('invite')
            setError(null)
          }}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors',
            mode === 'invite' ? 'bg-[var(--navy-dark)] text-white' : 'text-gray-500 hover:text-gray-900'
          )}
        >
          <Mail className="h-3.5 w-3.5" />
          Convidar por e-mail
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('assign')
            setError(null)
          }}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors',
            mode === 'assign' ? 'bg-[var(--navy-dark)] text-white' : 'text-gray-500 hover:text-gray-900'
          )}
        >
          <UserPlus className="h-3.5 w-3.5" />
          Atribuir usuário existente
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('none')
            setError(null)
          }}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors',
            mode === 'none' ? 'bg-[var(--navy-dark)] text-white' : 'text-gray-500 hover:text-gray-900'
          )}
        >
          <UserX className="h-3.5 w-3.5" />
          Sem ninguém por enquanto
        </button>
      </div>

      <div>
        <Label htmlFor="name">Nome do cliente</Label>
        <Input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </div>
      {mode !== 'none' && (
        <div>
          <Label htmlFor="owner_email">
            {mode === 'assign' ? 'E-mail do owner (já cadastrado na MedScale)' : 'E-mail do owner (recebe o convite)'}
          </Label>
          <Input
            id="owner_email"
            type="email"
            value={form.owner_email}
            onChange={(e) => setForm((f) => ({ ...f, owner_email: e.target.value }))}
          />
          {mode === 'assign' && (
            <p className="mt-1 text-xs text-gray-400">
              Entra direto como owner ativo, sem e-mail nem etapa de aceite — só funciona se a pessoa já tiver
              logado na MedScale alguma vez.
            </p>
          )}
        </div>
      )}
      {mode === 'none' && (
        <p className="text-xs text-gray-400">
          Cria só a account e a workspace padrão, sem ninguém vinculado — convide ou atribua o owner depois, na
          página da própria account.
        </p>
      )}
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
        {saving
          ? 'Criando...'
          : mode === 'assign'
            ? 'Criar account e atribuir'
            : mode === 'none'
              ? 'Criar account'
              : 'Criar account e enviar convite'}
      </Button>
    </div>
  )
}
