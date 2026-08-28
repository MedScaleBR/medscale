'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { ModuleSlug } from '@/lib/session/context'
import type { MembershipRole } from '@/types/database'
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
  FileAudio,
  Receipt,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: typeof LayoutDashboard
}

// Slug do módulo → rota real do app. Rotas que já existiam antes do modelo
// multi-tenant mantêm o nome de sempre (/bot, /receita, /trafego) — só as
// três novas (locations, schedule, waitlist) seguem os nomes sugeridos pelo
// módulo de multi-tenant, já que não havia rota anterior para preservar.
export const MODULE_NAV: Record<ModuleSlug, NavItem> = {
  dashboard: { label: 'Meu painel', href: '/dashboard', icon: LayoutDashboard },
  agenda: { label: 'Minha agenda', href: '/agenda', icon: CalendarDays },
  conversations: { label: 'Conversas', href: '/bot', icon: MessageCircle },
  locations: { label: 'Meus locais', href: '/locais', icon: MapPin },
  schedule: { label: 'Meu expediente', href: '/expediente', icon: Clock },
  waitlist: { label: 'Lista de espera', href: '/lista-espera', icon: Hourglass },
  campaigns: { label: 'Atribuição', href: '/trafego', icon: TrendingUp },
  patients: { label: 'Meus pacientes', href: '/pacientes', icon: Users },
  settings: { label: 'Configuração', href: '/configuracoes', icon: Settings },
  transcriptions: { label: 'Transcrições', href: '/transcricoes', icon: FileAudio },
  finance: { label: 'Financeiro', href: '/finance', icon: Wallet },
  revenue_cycle: { label: 'Ciclo de receita', href: '/ciclo-receita', icon: Receipt },
}

// Links extras que compartilham o gate de visibilidade de um módulo. O ledger
// histórico (/receita) vive sob o mesmo módulo do ciclo de receita — antes era
// o módulo "financial", aposentado.
const SECONDARY_NAV: Partial<Record<ModuleSlug, NavItem[]>> = {
  revenue_cycle: [{ label: 'Receita', href: '/receita', icon: Wallet }],
}

// Ordem fixa de exibição, independente da ordem em accountModules/userModules
export const NAV_ORDER: ModuleSlug[] = [
  'dashboard',
  'agenda',
  'conversations',
  'locations',
  'schedule',
  'waitlist',
  'finance',
  'revenue_cycle',
  'campaigns',
  'patients',
  'transcriptions',
  'settings',
]

// Módulos visíveis só para owner, mesmo quando ativos no account — dado
// financeiro (finance_entries pessoal) que não deve aparecer a admin/member
// convidados, mesmo com module_overrides liberando.
const OWNER_ONLY_MODULES: ModuleSlug[] = ['finance']

// Módulos que exigem no mínimo papel admin — a recepção confirma pagamentos
// no ciclo de receita, mas member não acessa (os totais continuam só do owner,
// gate feito na própria página).
const ADMIN_MIN_MODULES: ModuleSlug[] = ['revenue_cycle']

// Módulos que um owner pode restringir por pessoa via module_overrides —
// exclui os sempre-ativos (ALWAYS_ON_MODULES) e os exclusivos de owner
// (OWNER_ONLY_MODULES, que dependem do papel, não de override).
export const OVERRIDABLE_MODULES: ModuleSlug[] = [
  'agenda',
  'conversations',
  'locations',
  'schedule',
  'waitlist',
  'campaigns',
  'transcriptions',
]

interface NavLinksProps {
  userModules: ModuleSlug[]
  role: MembershipRole
  className?: string
  onNavigate?: () => void
}

export function NavLinks({ userModules, role, className, onNavigate }: NavLinksProps) {
  const pathname = usePathname()
  const visibleModules = NAV_ORDER.filter(
    (slug) =>
      userModules.includes(slug) &&
      (role === 'owner' || !OWNER_ONLY_MODULES.includes(slug)) &&
      (role !== 'member' || !ADMIN_MIN_MODULES.includes(slug))
  )

  const items = visibleModules.flatMap((slug) => [MODULE_NAV[slug], ...(SECONDARY_NAV[slug] ?? [])])

  return (
    <nav className={className}>
      {items.map((item) => {
        const Icon = item.icon
        const active = pathname === item.href || pathname.startsWith(item.href + '/')
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
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
  )
}
