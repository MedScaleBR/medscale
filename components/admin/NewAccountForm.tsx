'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, buttonVariants } from '@/components/ui/button'
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
import { Mail, UserPlus, UserX, type LucideIcon } from 'lucide-react'
import type { AccountPlan } from '@/types/database'
import { friendlyErrorMessage } from '@/lib/friendly-errors'

const PLAN_OPTIONS: { value: AccountPlan; label: string }[] = [
  { value: 'essencial', label: 'Essencial' },
  { value: 'avancado', label: 'Avançado' },
  { value: 'premium', label: 'Premium' },
]

type Mode = 'invite' | 'assign' | 'none'

const MODE_OPTIONS: { value: Mode; icon: LucideIcon; title: string; description: string }[] = [
  {
    value: 'invite',
    icon: Mail,
    title: 'Convidar por e-mail',
    description: 'Owner recebe um link e aceita o convite.',
  },
  {
    value: 'assign',
    icon: UserPlus,
    title: 'Atribuir usuário existente',
    description: 'Entra direto como owner, sem convite. Exige login prévio.',
  },
  {
    value: 'none',
    icon: UserX,
    title: 'Sem ninguém por enquanto',
    description: 'Cria só a account. Vincule o owner depois.',
  },
]

// Painel "O que vai acontecer": descreve o que o POST /api/admin/accounts faz
// em cada modo — se a rota mudar, este texto muda junto.
const FIRST_STEP = 'A account é criada no plano escolhido, com os módulos padrão. Ajuste os módulos depois, na página dela.'
const LAST_STEP =
  'A account nasce sem unidades: o owner cadastra a primeira no primeiro acesso, ou você cria em "Gerenciar unidades".'

const STEPS: Record<Mode, string[]> = {
  invite: [
    FIRST_STEP,
    'Um convite é enviado por e-mail para o owner. Se o envio falhar, você recebe o link para copiar.',
    LAST_STEP,
  ],
  assign: [
    FIRST_STEP,
    'O usuário entra direto como owner ativo, sem convite nem e-mail. Só funciona se ele já tiver feito login na MedScale.',
    LAST_STEP,
  ],
  none: [
    FIRST_STEP,
    'Ninguém é vinculado agora. Convide ou atribua o owner depois, na página da account.',
    'A account nasce sem unidades: cadastre em "Gerenciar unidades" ou deixe para o owner no primeiro acesso.',
  ],
}

const CARD = 'rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]'

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
      <div className={cn(CARD, 'max-w-2xl space-y-4 p-6')}>
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
        <Button onClick={() => router.push('/admin/accounts')} variant="outline" className="h-9 rounded-[10px] px-3.5">
          Ver todas as accounts
        </Button>
      </div>
    )
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className={cn(CARD, 'space-y-6 p-6')}>
        <fieldset>
          <legend className="text-sm text-gray-900">1. Como o owner entra?</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {MODE_OPTIONS.map((opt) => {
              const selected = mode === opt.value
              const Icon = opt.icon
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setMode(opt.value)
                    setError(null)
                  }}
                  className={cn(
                    'rounded-[10px] border p-3.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)] active:translate-y-px',
                    selected
                      ? 'border-[var(--cyan)] bg-[var(--cyan-10)]'
                      : 'border-[var(--navy-10)] bg-white hover:border-[var(--cyan)]'
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn('h-4 w-4', selected ? 'text-[var(--cyan-dark)]' : 'text-gray-500')}
                  />
                  <span className="mt-3 block text-sm text-gray-900">{opt.title}</span>
                  <span className="mt-0.5 block text-xs text-gray-500">{opt.description}</span>
                </button>
              )
            })}
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-sm text-gray-900">2. Dados do cliente</legend>
          <div className="mt-3">
            <Label htmlFor="name">Nome do cliente</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1.5 h-9"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
            {mode !== 'none' && (
              <div>
                <Label htmlFor="owner_email">
                  {mode === 'assign' ? 'E-mail do owner (já cadastrado na MedScale)' : 'E-mail do owner (recebe o convite)'}
                </Label>
                <Input
                  id="owner_email"
                  type="email"
                  placeholder="owner@clinica.com.br"
                  value={form.owner_email}
                  onChange={(e) => setForm((f) => ({ ...f, owner_email: e.target.value }))}
                  className="mt-1.5 h-9"
                />
              </div>
            )}
            <div className={mode === 'none' ? 'sm:col-span-2 sm:max-w-[120px]' : undefined}>
              <Label>Plano</Label>
              <Select value={form.plan} onValueChange={(v) => v && setForm((f) => ({ ...f, plan: v as AccountPlan }))}>
                <SelectTrigger className="mt-1.5 h-9 w-full" aria-label="Plano">
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
          </div>
          <div>
            <Label htmlFor="billing_email">E-mail de cobrança (opcional)</Label>
            <Input
              id="billing_email"
              type="email"
              value={form.billing_email}
              onChange={(e) => setForm((f) => ({ ...f, billing_email: e.target.value }))}
              className="mt-1.5 h-9"
            />
          </div>
        </fieldset>

        {error && <p className="text-sm text-red-500">{friendlyErrorMessage(error, "Não foi possível salvar esta alteração. Tente novamente.")}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="h-9 rounded-[10px] bg-[var(--cyan)] px-4 text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            {saving
              ? 'Criando...'
              : mode === 'assign'
                ? 'Criar account e atribuir'
                : mode === 'none'
                  ? 'Criar account'
                  : 'Criar account e enviar convite'}
          </Button>
          <Link
            href="/admin/accounts"
            className={cn(buttonVariants({ variant: 'ghost' }), 'h-9 rounded-[10px] px-3.5 font-normal text-gray-700 focus-visible:ring-2 focus-visible:ring-[var(--cyan)]')}
          >
            Cancelar
          </Link>
        </div>
      </div>

      <aside className={cn(CARD, 'p-5 lg:sticky lg:top-6')} aria-live="polite">
        <h2 className="text-sm font-medium text-gray-900">O que vai acontecer</h2>
        <ol className="mt-4 space-y-4">
          {STEPS[mode].map((step, i) => (
            <li key={i} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--cyan-10)] text-xs text-[var(--cyan-dark)]"
              >
                {i + 1}
              </span>
              <p className="text-sm text-gray-600">{step}</p>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  )
}
