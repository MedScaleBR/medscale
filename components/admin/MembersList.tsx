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
import { X } from 'lucide-react'
import type { MembershipRole, MembershipStatus } from '@/types/database'

export interface MemberRow {
  id: string
  role: MembershipRole
  status: MembershipStatus
  userName: string
  userEmail: string
}

const STATUS_STYLE: Record<MembershipStatus, string> = {
  active: 'bg-green-50 text-green-700',
  pending: 'bg-amber-50 text-amber-700',
  suspended: 'bg-red-50 text-red-600',
}

export function MembersList({ accountId, initialMembers }: { accountId: string; initialMembers: MemberRow[] }) {
  const [members, setMembers] = useState(initialMembers)

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

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
      <h2 className="text-sm font-medium text-gray-900">Membros</h2>
      {members.length === 0 ? (
        <p className="mt-4 text-sm text-gray-400">Nenhum membro ainda — o convite do owner está pendente.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--navy-06)]">
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
