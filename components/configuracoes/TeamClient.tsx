'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Mail, X, ChevronDown, ChevronUp, Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MODULE_NAV } from '@/components/layout/NavLinks'
import type { MembershipRole, MembershipStatus, ModuleSlug } from '@/types/database'

type Member = {
  id: string
  role: MembershipRole
  status: MembershipStatus
  moduleOverrides: ModuleSlug[] | null
  handoffPushEnabled: boolean
  userName: string
  userEmail: string
  isSelf: boolean
}

type Invite = { id: string; email: string; role: MembershipRole; expired: boolean }

const ROLE_LABEL: Record<MembershipRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }
const STATUS_STYLE: Record<MembershipStatus, string> = {
  active: 'bg-green-50 text-green-700',
  pending: 'bg-amber-50 text-amber-700',
  suspended: 'bg-red-50 text-red-600',
}

export function TeamClient({
  initialMembers,
  initialInvites,
  availableModules,
}: {
  initialMembers: Member[]
  initialInvites: Invite[]
  availableModules: ModuleSlug[]
}) {
  const [members, setMembers] = useState(initialMembers)
  const [invites, setInvites] = useState(initialInvites)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MembershipRole>('member')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const sendInvite = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setInviting(true)
    try {
      const res = await fetch('/api/memberships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível enviar o convite.')
        return
      }
      setInvites((prev) => [
        { id: data.invite.id, email: data.invite.email, role: data.invite.role, expired: false },
        ...prev,
      ])
      if (!data.emailSent) {
        setError(
          `Convite criado, mas o e-mail não foi enviado (SMTP não configurado) — copie o link e envie manualmente: ${location.origin}/invite/${data.invite.token}`
        )
      }
      setEmail('')
      setRole('member')
    } finally {
      setInviting(false)
    }
  }

  const cancelInvite = async (id: string) => {
    setInvites((prev) => prev.filter((i) => i.id !== id))
    await fetch(`/api/memberships/invites/${id}`, { method: 'DELETE' })
  }

  const updateRole = async (id: string, nextRole: MembershipRole) => {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, role: nextRole } : m)))
    await fetch(`/api/memberships/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: nextRole }),
    })
  }

  const updateModuleOverrides = async (id: string, moduleOverrides: ModuleSlug[] | null) => {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, moduleOverrides } : m)))
    await fetch(`/api/memberships/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module_overrides: moduleOverrides }),
    })
  }

  const removeMember = async (id: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== id))
    await fetch(`/api/memberships/${id}`, { method: 'DELETE' })
  }

  const toggleModule = (member: Member, slug: ModuleSlug) => {
    const current = member.moduleOverrides ?? availableModules
    const next = current.includes(slug) ? current.filter((m) => m !== slug) : [...current, slug]
    // Se voltou a marcar tudo, guarda null (herda os módulos da account) em
    // vez de uma lista que só coincidentemente cobre tudo hoje.
    const allSelected = availableModules.every((m) => next.includes(m))
    updateModuleOverrides(member.id, allSelected ? null : next)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="text-sm font-medium text-gray-900">Convidar</h2>
        <p className="mt-0.5 text-xs text-gray-400">
          A pessoa recebe um link por e-mail para criar a conta (ou entrar, se já tiver uma).
        </p>
        <form onSubmit={sendInvite} className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="invite-email">E-mail</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="invite-email"
                type="email"
                required
                className="pl-9"
                placeholder="pessoa@clinica.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <Select value={role} onValueChange={(v) => v && setRole(v as MembershipRole)}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="member">Member</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="submit"
            disabled={inviting}
            className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            {inviting ? 'Enviando...' : 'Convidar'}
          </Button>
        </form>
        {error && <p className="mt-2 text-xs break-all text-red-500">{error}</p>}

        {invites.length > 0 && (
          <ul className="mt-4 divide-y divide-[var(--navy-06)] border-t border-[var(--navy-06)]">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{i.email}</p>
                  <p className="text-xs text-gray-400">
                    {ROLE_LABEL[i.role]} · convite {i.expired ? 'expirado' : 'aguardando cadastro'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={`border-none ${i.expired ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
                    {i.expired ? 'expirado' : 'pendente'}
                  </Badge>
                  <button onClick={() => cancelInvite(i.id)} className="text-gray-300 hover:text-red-500">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="text-sm font-medium text-gray-900">Membros</h2>
        {availableModules.length === 0 && (
          <p className="mt-1 text-xs text-gray-400">
            Nenhum módulo opcional ativo nesta account ainda — não há o que restringir por pessoa além do padrão
            (Agenda, Pacientes, Configurações).
          </p>
        )}
        <ul className="mt-4 divide-y divide-[var(--navy-06)] border-t border-[var(--navy-06)]">
          {members.map((m) => {
            const isExpanded = expandedId === m.id
            const selected = m.moduleOverrides ?? availableModules
            const canManage = !m.isSelf && m.role !== 'owner'

            return (
              <li key={m.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {m.userName} {m.isSelf && <span className="text-gray-400">(você)</span>}
                    </p>
                    <p className="text-xs text-gray-400">{m.userEmail}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.handoffPushEnabled && (
                      <Badge
                        className="flex items-center gap-1 border-none bg-[var(--cyan-10)] text-[var(--cyan-dark)]"
                        title="Recebe notificações push quando chega um handoff"
                      >
                        <Bell className="h-3 w-3" />
                        handoff
                      </Badge>
                    )}
                    <Badge className={cn('border-none', STATUS_STYLE[m.status])}>{m.status}</Badge>
                    {canManage ? (
                      <Select value={m.role} onValueChange={(v) => v && updateRole(m.id, v as MembershipRole)}>
                        <SelectTrigger className="h-8 w-28 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="member">Member</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge className="border-none bg-[var(--navy-06)] text-[var(--navy)]">{ROLE_LABEL[m.role]}</Badge>
                    )}
                    {canManage && availableModules.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : m.id)}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-[var(--cyan-dark)]"
                      >
                        Módulos
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    )}
                    {canManage && (
                      <button onClick={() => removeMember(m.id)} className="text-gray-300 hover:text-red-500">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && canManage && (
                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-[var(--navy-06)] bg-[var(--navy-06)]/20 p-3 sm:grid-cols-3">
                    {availableModules.map((slug) => (
                      <label key={slug} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={selected.includes(slug)}
                          onChange={() => toggleModule(m, slug)}
                          className="h-4 w-4 rounded border-gray-300 accent-[var(--cyan)]"
                        />
                        {MODULE_NAV[slug].label}
                      </label>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
