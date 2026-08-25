'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AccountPlan } from '@/types/database'

const PLAN_LABEL: Record<string, string> = { essencial: 'Essencial', avancado: 'Avançado', premium: 'Premium' }

const PLAN_FILTER_ITEMS = {
  all: 'Todos os planos',
  essencial: 'Essencial',
  avancado: 'Avançado',
  premium: 'Premium',
}

const STATUS_FILTER_ITEMS = {
  all: 'Todos os status',
  active: 'Ativas',
  inactive: 'Inativas',
}

export interface AccountRow {
  id: string
  name: string
  slug: string
  plan: AccountPlan
  is_active: boolean
  created_at: string
}

type SortField = 'name' | 'plan' | 'is_active' | 'created_at'

function SortHeader({
  field,
  label,
  sortField,
  sortDir,
  onToggle,
}: {
  field: SortField
  label: string
  sortField: SortField
  sortDir: 'asc' | 'desc'
  onToggle: (field: SortField) => void
}) {
  return (
    <th className="px-5 py-3 font-normal">
      <button type="button" onClick={() => onToggle(field)} className="flex items-center gap-1 hover:text-gray-700">
        {label}
        {sortField === field &&
          (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </th>
  )
}

export function AccountsTable({ accounts }: { accounts: AccountRow[] }) {
  const [search, setSearch] = useState('')
  const [planFilter, setPlanFilter] = useState<AccountPlan | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const toggleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    let rows = accounts.filter((a) => {
      if (term && !a.name.toLowerCase().includes(term) && !a.slug.toLowerCase().includes(term)) return false
      if (planFilter !== 'all' && a.plan !== planFilter) return false
      if (statusFilter === 'active' && !a.is_active) return false
      if (statusFilter === 'inactive' && a.is_active) return false
      return true
    })

    rows = [...rows].sort((a, b) => {
      let cmp = 0
      if (sortField === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortField === 'plan') cmp = a.plan.localeCompare(b.plan)
      else if (sortField === 'is_active') cmp = Number(a.is_active) - Number(b.is_active)
      else cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      return sortDir === 'asc' ? cmp : -cmp
    })

    return rows
  }, [accounts, search, planFilter, statusFilter, sortField, sortDir])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou slug..."
            className="h-9 pl-9"
          />
        </div>
        <Select items={PLAN_FILTER_ITEMS} value={planFilter} onValueChange={(v) => v && setPlanFilter(v as AccountPlan | 'all')}>
          <SelectTrigger className="h-9 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os planos</SelectItem>
            <SelectItem value="essencial">Essencial</SelectItem>
            <SelectItem value="avancado">Avançado</SelectItem>
            <SelectItem value="premium">Premium</SelectItem>
          </SelectContent>
        </Select>
        <Select
          items={STATUS_FILTER_ITEMS}
          value={statusFilter}
          onValueChange={(v) => v && setStatusFilter(v as 'all' | 'active' | 'inactive')}
        >
          <SelectTrigger className="h-9 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="active">Ativas</SelectItem>
            <SelectItem value="inactive">Inativas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">
            {accounts.length === 0 ? 'Nenhuma account cadastrada ainda.' : 'Nenhuma account encontrada com esses filtros.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 text-left text-xs text-gray-400">
                  <SortHeader field="name" label="Nome" sortField={sortField} sortDir={sortDir} onToggle={toggleSort} />
                  <SortHeader field="plan" label="Plano" sortField={sortField} sortDir={sortDir} onToggle={toggleSort} />
                  <SortHeader
                    field="is_active"
                    label="Status"
                    sortField={sortField}
                    sortDir={sortDir}
                    onToggle={toggleSort}
                  />
                  <SortHeader
                    field="created_at"
                    label="Criada em"
                    sortField={sortField}
                    sortDir={sortDir}
                    onToggle={toggleSort}
                  />
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id} className="border-b border-[var(--navy-06)] last:border-0 hover:bg-[var(--navy-06)]/40">
                    <td className="px-5 py-3">
                      <Link href={`/admin/accounts/${a.id}`} className="font-medium text-gray-900 hover:text-[var(--cyan-dark)]">
                        {a.name}
                      </Link>
                      <p className="text-xs text-gray-400">{a.slug}</p>
                    </td>
                    <td className="px-5 py-3 text-gray-600">{PLAN_LABEL[a.plan] ?? a.plan}</td>
                    <td className="px-5 py-3">
                      <Badge className={a.is_active ? 'border-none bg-green-50 text-green-700' : 'border-none bg-red-50 text-red-600'}>
                        {a.is_active ? 'Ativa' : 'Inativa'}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-gray-600">{new Date(a.created_at).toLocaleDateString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
