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
import { Mail, UserPlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MembershipRole, MembershipStatus } from '@/types/database'

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

const ROLE_LABEL: Record<MembershipRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }

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
          setError('Convite criado, mas o e-mail não foi enviado (SMTP não configurado) — copie o link manualmente se precisar.')
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

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
      <h2 className="text-sm font-medium text-gray-900">Membros</h2>

      <div className="mt-4 inline-flex rounded-lg border border-gray-200 p-0.5 text-xs">
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
      </div>

      <form onSubmit={sendInvite} className="mt-3 flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="invite-email" className="text-xs text-gray-400">
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
              className="h-9 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-sm outline-none transition-shadow focus:border-[var(--cyan)] focus:ring-2 focus:ring-[var(--cyan-20)]"
            />
          </div>
        </div>
        <Select value={role} onValueChange={(v) => v && setRole(v as MembershipRole)}>
          <SelectTrigger className="h-9 w-28 text-xs">
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
          className="h-9 rounded-lg bg-[var(--navy-dark)] px-4 text-xs font-medium text-white transition-colors hover:bg-[var(--navy)] disabled:opacity-60"
        >
          {inviting ? (mode === 'assign' ? 'Atribuindo...' : 'Enviando...') : mode === 'assign' ? 'Atribuir' : 'Convidar'}
        </button>
      </form>
      {mode === 'assign' && (
        <p className="mt-1.5 text-xs text-gray-400">
          Entra direto como membro ativo, sem e-mail nem etapa de aceite — só funciona se a pessoa já tiver conta na
          MedScale. Se ela já for membro desta account, isso atualiza a permissão em vez de duplicar.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      {successMessage && <p className="mt-2 text-xs text-green-600">{successMessage}</p>}

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

      {members.length === 0 ? (
        <p className="mt-4 text-sm text-gray-400">Nenhum membro ainda.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--navy-06)] border-t border-[var(--navy-06)]">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{m.userName}</p>
                <p className="text-xs text-gray-400">{m.userEmail}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={`border-none ${STATUS_STYLE[m.status]}`}>{m.status}</Badge>
                <Select value={m.role} onValueChange={(v) => v && updateRole(m.id, v as MembershipRole)}>
                  <SelectTrigger className="h-8 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                  </SelectContent>
                </Select>
                <button onClick={() => removeMember(m.id)} className="text-gray-300 hover:text-red-500">
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
