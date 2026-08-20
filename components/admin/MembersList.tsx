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
import { Mail, X } from 'lucide-react'
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
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MembershipRole>('member')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    setInviting(true)
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/memberships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível enviar o convite.')
        return
      }
      setInvites((prev) => [{ id: data.invite.id, email: data.invite.email, role: data.invite.role, expired: false }, ...prev])
      setEmail('')
      setRole('member')
      if (!data.emailSent) {
        setError('Convite criado, mas o e-mail não foi enviado (SMTP não configurado) — copie o link manualmente se precisar.')
      }
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

      <form onSubmit={sendInvite} className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="invite-email" className="text-xs text-gray-400">
            Convidar por e-mail
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
          {inviting ? 'Enviando...' : 'Convidar'}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

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
