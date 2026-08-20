'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { GoogleConnectButton } from './GoogleConnectButton'

interface SettingsClientProps {
  initialProfile: {
    full_name: string
    specialty: string | null
    crm: string | null
    phone: string | null
  }
  workspace: {
    hasMetaToken: boolean
    whatsappNumber: string | null
  }
  google: { connected: boolean; email: string | null }
}

export function SettingsClient({ initialProfile, workspace, google }: SettingsClientProps) {
  const [form, setForm] = useState({
    full_name: initialProfile.full_name ?? '',
    specialty: initialProfile.specialty ?? '',
    crm: initialProfile.crm ?? '',
    phone: initialProfile.phone ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="text-sm font-medium text-gray-900">Perfil</h2>
        <p className="mt-0.5 text-xs text-gray-400">Seus dados pessoais — não são compartilhados com outras contas.</p>
        <Separator className="my-4" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="full_name">Nome completo</Label>
            <Input
              id="full_name"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="specialty">Especialidade</Label>
            <Input
              id="specialty"
              value={form.specialty}
              onChange={(e) => setForm((f) => ({ ...f, specialty: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="crm">CRM</Label>
            <Input id="crm" value={form.crm} onChange={(e) => setForm((f) => ({ ...f, crm: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="phone">Telefone de contato</Label>
            <Input id="phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button
            onClick={save}
            disabled={saving}
            className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            {saving ? 'Salvando...' : 'Salvar perfil'}
          </Button>
          {saved && <span className="text-xs text-green-600">Salvo com sucesso.</span>}
        </div>
      </div>

      <Link
        href="/configuracoes/bot"
        className="flex items-center justify-between rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--cyan)]"
      >
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-gray-900">Bot WhatsApp</h2>
            {workspace.hasMetaToken ? (
              <Badge className="border-none bg-green-50 text-green-700">
                Conectado{workspace.whatsappNumber ? ` — ${workspace.whatsappNumber}` : ''}
              </Badge>
            ) : (
              <Badge className="border-none bg-[var(--navy-06)] text-[var(--navy)]">Não configurado</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-400">
            Conectar número na Meta, personalidade do bot, procedimentos, convênios e transferência para humano.
          </p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-gray-400" />
      </Link>

      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="text-sm font-medium text-gray-900">Google Agenda</h2>
        <p className="mt-0.5 text-xs text-gray-400">
          Fonte de verdade da disponibilidade real — o bot só oferece horários livres de fato na sua agenda.
        </p>
        <Separator className="my-4" />
        <GoogleConnectButton isConnected={google.connected} googleEmail={google.email} />
      </div>

      <Link
        href="/expediente"
        className="flex items-center justify-between rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--cyan)]"
      >
        <div>
          <h2 className="text-sm font-medium text-gray-900">Meu expediente</h2>
          <p className="mt-0.5 text-xs text-gray-400">Horários de atendimento e dias bloqueados usados pelo bot.</p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-gray-400" />
      </Link>
    </div>
  )
}
