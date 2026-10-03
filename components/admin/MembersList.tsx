'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Mail, Plus, UserPlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { initialsFrom } from '@/lib/admin/format'
import type { MembershipRole, MembershipStatus } from '@/types/database'
import { friendlyErrorMessage } from '@/lib/friendly-errors'

export interface MemberRow {
  id: string
  role: MembershipRole
  status: MembershipStatus
  userName: string
  userEmail: string
}

export interface PendingInvite {
  id: string
  email: string
  role: MembershipRole
  expired: boolean
}

const STATUS_STYLE: Record<MembershipStatus, string> = {
  active: 'bg-green-50 text-green-700',
  pending: 'bg-amber-50 text-amber-700',
  suspended: 'bg-red-50 text-red-600',
}

const STATUS_LABEL: Record<MembershipStatus, string> = { active: 'Ativo', pending: 'Pendente', suspended: 'Suspenso' }

const ROLE_LABEL: Record<MembershipRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }

const AVATAR =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--navy-06)] text-[11px] font-medium text-gray-600'

const ICON_BUTTON =
  'rounded text-gray-300 outline-none hover:text-red-500 focus-visible:ring-2 focus-visible:ring-[var(--cyan)]'

export function MembersList({
  accountId,
  initialMembers,
  initialInvites,
}: {
  accountId: string
  initialMembers: MemberRow[]
  initialInvites: PendingInvite[]
}) {
  const [members, setMembers] = useState(initialMembers)
  const [invites, setInvites] = useState(initialInvites)
  const [mode, setMode] = useState<'invite' | 'assign'>('invite')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MembershipRole>('member')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  // Só apresentação: o formulário de convite abre pelo botão "Convidar"
  // (já aberto quando a account não tem ninguém).
  const [showForm, setShowForm] = useState(initialMembers.length === 0 && initialInvites.length === 0)

  const updateRole = async (membershipId: string, role: MembershipRole) => {
    setMembers((prev) => prev.map((m) => (m.id === membershipId ? { ...m, role } : m)))
    await fetch(`/api/admin/accounts/${accountId}/memberships/${membershipId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
  }

  const removeMember = async (membershipId: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== membershipId))
    await fetch(`/api/admin/accounts/${accountId}/memberships/${membershipId}`, { method: 'DELETE' })
  }

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessMessage(null)
    setInviting(true)
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/memberships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role, assignDirectly: mode === 'assign' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? (mode === 'assign' ? 'Não foi possível atribuir o usuário.' : 'Não foi possível enviar o convite.'))
        return
      }
      if (mode === 'assign') {
        setMembers((prev) => {
          const updatedMember = { id: data.membership.id, role: data.membership.role, status: data.membership.status, userName: data.membership.userName, userEmail: data.membership.userEmail }
          const existingIndex = prev.findIndex((m) => m.id === updatedMember.id)
          if (existingIndex >= 0) {
            const next = [...prev]
            next[existingIndex] = updatedMember
            return next
          }
          return [...prev, updatedMember]
        })
        setSuccessMessage(data.updated ? 'Permissão atualizada.' : 'Usuário atribuído à account.')
        setTimeout(() => setSuccessMessage(null), 4000)
      } else {
        setInvites((prev) => [{ id: data.invite.id, email: data.invite.email, role: data.invite.role, expired: false }, ...prev])
        if (!data.emailSent) {
        setError('Convite criado, mas o e-mail não foi enviado. Copie o link do convite e compartilhe com a pessoa convidada.')
        }
      }
      setEmail('')
      setRole('member')
    } finally {
      setInviting(false)
    }
  }

  const cancelInvite = async (inviteId: string) => {
    setInvites((prev) => prev.filter((i) => i.id !== inviteId))
    await fetch(`/api/admin/accounts/${accountId}/invites/${inviteId}`, { method: 'DELETE' })
  }

  const modeButton = (active: boolean) =>
    cn(
      'flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)]',
      active ? 'bg-[var(--navy-dark)] text-white' : 'text-gray-500 hover:text-gray-900'
    )

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4">
        <h2 className="text-sm font-medium text-gray-900">Membros</h2>
        <button
          type="button"
          aria-expanded={showForm}
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex h-8 items-center gap-1 rounded-[10px] border border-[var(--navy-10)] bg-white px-3 text-xs text-gray-700 outline-none hover:border-[var(--cyan)] focus-visible:ring-2 focus-visible:ring-[var(--cyan)] active:translate-y-px"
        >
          <Plus className="h-3.5 w-3.5" />
          Convidar
        </button>
      </div>

      {showForm && (
        <div className="border-t border-[var(--navy-06)] bg-[var(--navy-06)]/40 px-5 py-4">
          <div className="inline-flex rounded-[10px] border border-[var(--navy-10)] bg-white p-0.5 text-xs">
            <button
              type="button"
              aria-pressed={mode === 'invite'}
              onClick={() => {
                setMode('invite')
                setError(null)
              }}
              className={modeButton(mode === 'invite')}
            >
              <Mail className="h-3.5 w-3.5" />
              Convidar por e-mail
            </button>
            <button
              type="button"
              aria-pressed={mode === 'assign'}
              onClick={() => {
                setMode('assign')
                setError(null)
              }}
              className={modeButton(mode === 'assign')}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Atribuir usuário existente
            </button>
          </div>

          <form onSubmit={sendInvite} className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <label htmlFor="invite-email" className="text-xs text-gray-500">
                {mode === 'assign' ? 'E-mail do usuário já cadastrado' : 'E-mail para convidar'}
              </label>
              <div className="relative mt-1">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  id="invite-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="pessoa@clinica.com"
                  className="h-9 w-full rounded-[10px] border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none transition-shadow focus:border-[var(--cyan)] focus:ring-2 focus:ring-[var(--cyan-20)]"
                />
              </div>
            </div>
            <Select value={role} onValueChange={(v) => v && setRole(v as MembershipRole)}>
              <SelectTrigger className="h-9 w-28 bg-white text-xs" aria-label="Papel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Owner</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
              </SelectContent>
            </Select>
            <button
              type="submit"
              disabled={inviting}
              className="h-9 rounded-[10px] bg-[var(--cyan)] px-4 text-xs font-medium text-[var(--navy-dark)] transition-colors outline-none hover:bg-[var(--cyan-dark)] focus-visible:ring-2 focus-visible:ring-[var(--cyan)] active:translate-y-px disabled:opacity-60"
            >
              {inviting ? (mode === 'assign' ? 'Atribuindo...' : 'Enviando...') : mode === 'assign' ? 'Atribuir' : 'Convidar'}
            </button>
          </form>
          {mode === 'assign' && (
            <p className="mt-1.5 text-xs text-gray-500">
              Entra direto como membro ativo, sem e-mail nem etapa de aceite — só funciona se a pessoa já tiver conta na
              MedScale. Se ela já for membro desta account, isso atualiza a permissão em vez de duplicar.
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="border-t border-[var(--navy-06)] px-5 py-2 text-xs text-red-500">
          {friendlyErrorMessage(error, "Não foi possível salvar esta alteração. Tente novamente.")}
        </p>
      )}
      {successMessage && (
        <p className="border-t border-[var(--navy-06)] px-5 py-2 text-xs text-green-700">{successMessage}</p>
      )}

      {members.length === 0 && invites.length === 0 ? (
        <p className="border-t border-[var(--navy-06)] px-5 py-4 text-sm text-gray-400">Nenhum membro ainda.</p>
      ) : (
        <ul className="divide-y divide-[var(--navy-06)] border-t border-[var(--navy-06)]">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span aria-hidden="true" className={AVATAR}>
                  {initialsFrom(m.userName === 'Sem nome' ? null : m.userName, m.userEmail)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm text-gray-900">{m.userName}</p>
                  <p className="truncate text-xs text-gray-400">{m.userEmail}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Select value={m.role} onValueChange={(v) => v && updateRole(m.id, v as MembershipRole)}>
                  <SelectTrigger className="h-8 w-28 text-xs" aria-label={`Papel de ${m.userName}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                  </SelectContent>
                </Select>
                <Badge className={`border-none ${STATUS_STYLE[m.status]}`}>{STATUS_LABEL[m.status]}</Badge>
                <button type="button" onClick={() => removeMember(m.id)} aria-label={`Remover ${m.userName}`} className={ICON_BUTTON}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
          {invites.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span aria-hidden="true" className={AVATAR}>
                  {initialsFrom(null, i.email)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm text-gray-900">{i.email}</p>
                  <p className="text-xs text-gray-400">
                    {ROLE_LABEL[i.role]} · convite {i.expired ? 'expirado' : 'aguardando cadastro'}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge className={`border-none ${i.expired ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
                  {i.expired ? 'Expirado' : 'Pendente'}
                </Badge>
                <button
                  type="button"
                  onClick={() => cancelInvite(i.id)}
                  aria-label={`Cancelar convite de ${i.email}`}
                  className={ICON_BUTTON}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
