'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Building2,
  Coins,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AdminNavCounts } from '@/lib/admin/nav-counts'

interface AdminNavItem {
  label: string
  href: string
  icon: LucideIcon
  // Dashboard só fica ativo em /admin exato; os demais cobrem as sub-rotas.
  exact?: boolean
}

const ITEMS: AdminNavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard, exact: true },
  { label: 'Accounts', href: '/admin/accounts', icon: Building2 },
  { label: 'Tarefas', href: '/admin/tasks', icon: ListChecks },
  { label: 'Custos', href: '/admin/costs', icon: Coins },
  { label: 'Feedback', href: '/admin/feedback', icon: MessageSquareText },
]

function isActive(pathname: string, item: AdminNavItem): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(item.href + '/')
}

// O número é visual; o nome acessível do link já leva a contagem por extenso.
function CountPill({ count, tone }: { count: number; tone: 'overdue' | 'info' }) {
  if (count <= 0) return null
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-medium leading-none whitespace-nowrap',
        tone === 'overdue' ? 'bg-[#EF4444] text-white' : 'bg-[rgba(0,185,216,.25)] text-[#7FE3F5]',
      )}
    >
      {count}
    </span>
  )
}

function countLabel(item: AdminNavItem, counts: AdminNavCounts): string | null {
  if (item.href === '/admin/tasks' && counts.overdueTasks > 0) {
    return `${counts.overdueTasks} ${counts.overdueTasks === 1 ? 'tarefa vencida' : 'tarefas vencidas'}`
  }
  if (item.href === '/admin/feedback' && counts.unreadFeedback > 0) {
    return `${counts.unreadFeedback} ${counts.unreadFeedback === 1 ? 'feedback não lido' : 'feedbacks não lidos'}`
  }
  return null
}

export function AdminNav({ counts }: { counts: AdminNavCounts }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Navegação do admin" className="flex min-w-0 items-center gap-1">
      {ITEMS.map((item) => {
        const Icon = item.icon
        const active = isActive(pathname, item)
        const extra = countLabel(item, counts)
        // Abaixo de lg o rótulo some e o link fica só com ícone: o nome segue
        // no aria-label e no title.
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            aria-label={extra ? `${item.label}, ${extra}` : item.label}
            title={item.label}
            className={cn(
              'flex h-8 items-center gap-2 rounded-[10px] px-2.5 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)] xl:px-3',
              active ? 'bg-white/10 text-white' : 'text-[var(--w70)] hover:bg-white/10 hover:text-white',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="hidden lg:inline">{item.label}</span>
            {item.href === '/admin/tasks' && <CountPill count={counts.overdueTasks} tone="overdue" />}
            {item.href === '/admin/feedback' && <CountPill count={counts.unreadFeedback} tone="info" />}
          </Link>
        )
      })}
    </nav>
  )
}
