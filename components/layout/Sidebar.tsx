'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { AccountSwitcher } from './AccountSwitcher'
import type { ActiveSession, ModuleSlug } from '@/lib/session/context'
import type { AccountSummary } from '@/lib/session/context'
import {
  LayoutDashboard,
  CalendarDays,
  MessageCircle,
  MapPin,
  Clock,
  Hourglass,
  Wallet,
  TrendingUp,
  Users,
  Settings,
} from 'lucide-react'

// Slug do módulo → rota real do app. Rotas que já existiam antes do modelo
// multi-tenant mantêm o nome de sempre (/bot, /receita, /trafego) — só as
// três novas (locations, schedule, waitlist) seguem os nomes sugeridos pelo
// módulo de multi-tenant, já que não havia rota anterior para preservar.
const MODULE_NAV: Record<ModuleSlug, { label: string; href: string; icon: typeof LayoutDashboard }> = {
  dashboard: { label: 'Meu painel', href: '/dashboard', icon: LayoutDashboard },
  agenda: { label: 'Minha agenda', href: '/agenda', icon: CalendarDays },
  conversations: { label: 'Conversas', href: '/bot', icon: MessageCircle },
  locations: { label: 'Meus locais', href: '/locais', icon: MapPin },
  schedule: { label: 'Meu expediente', href: '/expediente', icon: Clock },
  waitlist: { label: 'Lista de espera', href: '/lista-espera', icon: Hourglass },
  financial: { label: 'Meu financeiro', href: '/receita', icon: Wallet },
  campaigns: { label: 'Atribuição', href: '/trafego', icon: TrendingUp },
  patients: { label: 'Meus pacientes', href: '/pacientes', icon: Users },
  settings: { label: 'Configuração', href: '/configuracoes', icon: Settings },
}

// Ordem fixa de exibição, independente da ordem em accountModules/userModules
const NAV_ORDER: ModuleSlug[] = [
  'dashboard',
  'agenda',
  'conversations',
  'locations',
  'schedule',
  'waitlist',
  'financial',
  'campaigns',
  'patients',
  'settings',
]

interface SidebarProps {
  session: ActiveSession
  accounts: AccountSummary[]
}

export function Sidebar({ session, accounts }: SidebarProps) {
  const pathname = usePathname()
  const { userModules, allWorkspaces, workspaceId, accountId, accountName, role } = session

  const visibleModules = NAV_ORDER.filter((slug) => userModules.includes(slug))

  return (
    <aside className="hidden w-64 shrink-0 flex-col bg-[var(--navy-dark)] text-white md:flex">
      <div className="flex h-16 items-center gap-2 px-6">
        <div className="flex h-8 items-center justify-center rounded-lg bg-white px-1.5">
          <Image src="/logo-icon.png" alt="MedScale" width={138} height={96} className="h-[18px] w-auto" priority />
        </div>
        <span className="text-base font-semibold">MedScale</span>
      </div>

      {accounts.length > 1 && <AccountSwitcher accounts={accounts} activeId={accountId} />}
      {allWorkspaces.length > 1 && <WorkspaceSwitcher workspaces={allWorkspaces} activeId={workspaceId} />}

      <nav className="flex-1 space-y-1 px-3 py-4">
        {visibleModules.map((slug) => {
          const item = MODULE_NAV[slug]
          const Icon = item.icon
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={slug}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-[var(--cyan-10)] text-[var(--cyan)]'
                  : 'text-[var(--w70)] hover:bg-[var(--w10)] hover:text-white'
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-[var(--w10)] px-6 py-4">
        <p className="truncate text-xs font-medium text-white/80">{accountName}</p>
        <p className="text-xs capitalize text-[var(--w60)]">{role}</p>
      </div>
    </aside>
  )
}
