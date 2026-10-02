'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PlanBadge, StatusBadge } from '@/components/admin/account/AccountBadges'
import { COST_HIGHLIGHT_BRL, type AccountListRow } from '@/lib/admin/accounts'
import { formatDateBR } from '@/lib/admin/format'
import { formatBRL } from '@/lib/finance/summary'
import { cn } from '@/lib/utils'
import type { AccountPlan } from '@/types/database'

const PAGE_SIZE = 50

const PLAN_FILTER_ITEMS = {
  all: 'Todos os planos',
  essencial: 'Essencial',
  avancado: 'Avançado',
  premium: 'Premium',
}

type StatusChip = 'all' | 'active' | 'inactive' | 'overdue'

type SortField = 'name' | 'plan' | 'is_active' | 'modules' | 'members' | 'cost' | 'tasks' | 'created_at'

function compareRows(a: AccountListRow, b: AccountListRow, field: SortField): number {
  switch (field) {
    case 'name':
      return a.name.localeCompare(b.name, 'pt-BR')
    case 'plan':
      return a.plan.localeCompare(b.plan)
    case 'is_active':
      return Number(a.is_active) - Number(b.is_active)
    case 'modules':
      return a.modulesOn - b.modulesOn
    case 'members':
      return a.members - b.members
    case 'cost':
      return a.cost30d - b.cost30d
    case 'tasks':
      return a.overdueTasks - b.overdueTasks || a.openTasks - b.openTasks
    default:
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  }
}

function SortHeader({
  field,
  label,
  sortField,
  sortDir,
  onToggle,
  align = 'left',
}: {
  field: SortField
  label: string
  sortField: SortField
  sortDir: 'asc' | 'desc'
  onToggle: (field: SortField) => void
  align?: 'left' | 'right'
}) {
  const active = sortField === field
  return (
    <th
      scope="col"
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn('px-5 py-3 font-normal', align === 'right' && 'text-right')}
    >
      <button
        type="button"
        onClick={() => onToggle(field)}
        className={cn(
          'inline-flex items-center gap-1 rounded whitespace-nowrap outline-none hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-[var(--cyan)]',
          align === 'right' && 'flex-row-reverse',
          active && 'text-gray-700'
        )}
      >
        {label}
        {active && (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </th>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-9 rounded-full border px-3.5 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)] active:translate-y-px',
        active
          ? 'border-[var(--navy-dark)] bg-[var(--navy-dark)] text-white'
          : 'border-[var(--navy-10)] bg-white text-gray-600 hover:border-[var(--cyan)] hover:text-gray-900'
      )}
    >
      {children}
    </button>
  )
}

function TasksCell({ row }: { row: AccountListRow }) {
  if (row.overdueTasks > 0) {
    return (
      <span className="whitespace-nowrap text-red-500">
        {row.overdueTasks} {row.overdueTasks === 1 ? 'vencida' : 'vencidas'}
      </span>
    )
  }
  if (row.openTasks > 0) {
    return (
      <span className="whitespace-nowrap text-gray-600">
        {row.openTasks} {row.openTasks === 1 ? 'aberta' : 'abertas'}
      </span>
    )
  }
  return <span className="text-gray-400">—</span>
}

export function AccountsTable({ accounts }: { accounts: AccountListRow[] }) {
  const [search, setSearch] = useState('')
  const [planFilter, setPlanFilter] = useState<AccountPlan | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<StatusChip>('all')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [visible, setVisible] = useState(PAGE_SIZE)

  const toggleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  // Busca e plano valem para as contagens dos chips; o chip só escolhe o recorte.
  const searched = useMemo(() => {
    const term = search.trim().toLowerCase()
    return accounts.filter((a) => {
      if (term && !a.name.toLowerCase().includes(term) && !a.slug.toLowerCase().includes(term)) return false
      if (planFilter !== 'all' && a.plan !== planFilter) return false
      return true
    })
  }, [accounts, search, planFilter])

  const chipCounts = useMemo(
    () => ({
      active: searched.filter((a) => a.is_active).length,
      inactive: searched.filter((a) => !a.is_active).length,
      overdue: searched.filter((a) => a.overdueTasks > 0).length,
    }),
    [searched]
  )

  const filtered = useMemo(() => {
    const rows = searched.filter((a) => {
      if (statusFilter === 'active') return a.is_active
      if (statusFilter === 'inactive') return !a.is_active
      if (statusFilter === 'overdue') return a.overdueTasks > 0
      return true
    })
    return [...rows].sort((a, b) => {
      const cmp = compareRows(a, b, sortField)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [searched, statusFilter, sortField, sortDir])

  const shown = filtered.slice(0, visible)

  const selectStatus = (value: StatusChip) => {
    setStatusFilter(value)
    setVisible(PAGE_SIZE)
  }

  const headerProps = { sortField, sortDir, onToggle: toggleSort }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setVisible(PAGE_SIZE)
            }}
            placeholder="Buscar por nome ou slug..."
            aria-label="Buscar por nome ou slug"
            className="h-9 bg-white pl-9"
          />
        </div>
        <Select
          items={PLAN_FILTER_ITEMS}
          value={planFilter}
          onValueChange={(v) => {
            if (!v) return
            setPlanFilter(v as AccountPlan | 'all')
            setVisible(PAGE_SIZE)
          }}
        >
          <SelectTrigger className="h-9 w-36 bg-white text-xs" aria-label="Filtrar por plano">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os planos</SelectItem>
            <SelectItem value="essencial">Essencial</SelectItem>
            <SelectItem value="avancado">Avançado</SelectItem>
            <SelectItem value="premium">Premium</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por status">
          <FilterChip active={statusFilter === 'all'} onClick={() => selectStatus('all')}>
            Todos
          </FilterChip>
          <FilterChip active={statusFilter === 'active'} onClick={() => selectStatus('active')}>
            Ativas {chipCounts.active}
          </FilterChip>
          <FilterChip active={statusFilter === 'inactive'} onClick={() => selectStatus('inactive')}>
            Inativas {chipCounts.inactive}
          </FilterChip>
          <FilterChip active={statusFilter === 'overdue'} onClick={() => selectStatus('overdue')}>
            Com tarefa vencida {chipCounts.overdue}
          </FilterChip>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">
            {accounts.length === 0 ? 'Nenhuma account cadastrada ainda.' : 'Nenhuma account encontrada com esses filtros.'}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--navy-06)] text-left text-xs text-gray-400">
                    <SortHeader field="name" label="Nome" {...headerProps} />
                    <SortHeader field="plan" label="Plano" {...headerProps} />
                    <SortHeader field="is_active" label="Status" {...headerProps} />
                    <SortHeader field="modules" label="Módulos" {...headerProps} />
                    <SortHeader field="members" label="Membros" {...headerProps} />
                    <SortHeader field="cost" label="Custo 30d" align="right" {...headerProps} />
                    <SortHeader field="tasks" label="Tarefas" {...headerProps} />
                    <SortHeader field="created_at" label="Criada em" align="right" {...headerProps} />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => (
                    <tr key={a.id} className="border-b border-[var(--navy-06)] last:border-0 hover:bg-[var(--navy-06)]/40">
                      <td className="px-5 py-3">
                        <Link
                          href={`/admin/accounts/${a.id}`}
                          className="rounded text-gray-900 outline-none hover:text-[var(--cyan-dark)] focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
                        >
                          {a.name}
                        </Link>
                        <p className="text-xs text-gray-400">{a.slug}</p>
                      </td>
                      <td className="px-5 py-3">
                        <PlanBadge plan={a.plan} />
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge active={a.is_active} />
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-gray-600 tabular-nums">
                        {a.modulesOn}/{a.modulesTotal}
                      </td>
                      <td className="px-5 py-3 text-gray-600 tabular-nums">{a.members}</td>
                      <td
                        className={cn(
                          'px-5 py-3 text-right whitespace-nowrap tabular-nums',
                          a.cost30d > COST_HIGHLIGHT_BRL ? 'text-red-600' : 'text-gray-600'
                        )}
                      >
                        {formatBRL(a.cost30d)}
                      </td>
                      <td className="px-5 py-3 text-xs">
                        <TasksCell row={a} />
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap text-gray-600 tabular-nums">
                        {formatDateBR(a.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--navy-06)] bg-[var(--navy-06)]/40 px-5 py-3 text-xs text-gray-500">
              <span className="whitespace-nowrap">
                Mostrando {shown.length} de {filtered.length}
              </span>
              {shown.length < filtered.length && (
                <button
                  type="button"
                  onClick={() => setVisible((v) => v + PAGE_SIZE)}
                  className="h-8 rounded-[10px] border border-[var(--navy-10)] bg-white px-3 text-xs text-gray-700 outline-none hover:border-[var(--cyan)] focus-visible:ring-2 focus-visible:ring-[var(--cyan)] active:translate-y-px"
                >
                  Carregar mais {Math.min(PAGE_SIZE, filtered.length - shown.length)}
                </button>
              )}
              <span className="whitespace-nowrap">Custo 30d em vermelho = acima de {formatBRL(COST_HIGHLIGHT_BRL)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
