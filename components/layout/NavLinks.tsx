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
} from 'lucide-react'

// Slug do módulo → rota real do app. Rotas que já existiam antes do modelo
// multi-tenant mantêm o nome de sempre (/bot, /receita, /trafego) — só as
// três novas (locations, schedule, waitlist) seguem os nomes sugeridos pelo
// módulo de multi-tenant, já que não havia rota anterior para preservar.
export const MODULE_NAV: Record<ModuleSlug, { label: string; href: string; icon: typeof LayoutDashboard }> = {
  dashboard: { label: 'Meu painel', href: '/dashboard', icon: LayoutDashboard },
  agenda: { label: 'Minha agenda', href: '/agenda', icon: CalendarDays },
  conversations: { label: 'Conversas', href: '/bot', icon: MessageCircle },
  locations: { label: 'Meus locais', href: '/locais', icon: MapPin },
  schedule: { label: 'Meu expediente', href: '/expediente', icon: Clock },
  waitlist: { label: 'Lista de espera', href: '/lista-espera', icon: Hourglass },
  financial: { label: 'Receita', href: '/receita', icon: Wallet },
  campaigns: { label: 'Atribuição', href: '/trafego', icon: TrendingUp },
  patients: { label: 'Meus pacientes', href: '/pacientes', icon: Users },
  settings: { label: 'Configuração', href: '/configuracoes', icon: Settings },
  transcriptions: { label: 'Transcrições', href: '/transcricoes', icon: FileAudio },
  finance: { label: 'Financeiro', href: '/finance', icon: Wallet },
}

// Ordem fixa de exibição, independente da ordem em accountModules/userModules
export const NAV_ORDER: ModuleSlug[] = [
  'dashboard',
  'agenda',
  'conversations',
  'locations',
  'schedule',
  'waitlist',
  'financial',
  'finance',
  'campaigns',
  'patients',
  'transcriptions',
  'settings',
]

// Módulos visíveis só para owner, mesmo quando ativos no account — dado
// pessoal (finance_entries) que não deve aparecer a admin/member convidados.
const OWNER_ONLY_MODULES: ModuleSlug[] = ['finance']

interface NavLinksProps {
  userModules: ModuleSlug[]
  role: MembershipRole
  className?: string
  onNavigate?: () => void
}

export function NavLinks({ userModules, role, className, onNavigate }: NavLinksProps) {
  const pathname = usePathname()
  const visibleModules = NAV_ORDER.filter(
    (slug) => userModules.includes(slug) && (role === 'owner' || !OWNER_ONLY_MODULES.includes(slug))
  )

  return (
    <nav className={className}>
      {visibleModules.map((slug) => {
        const item = MODULE_NAV[slug]
        const Icon = item.icon
        const active = pathname === item.href || pathname.startsWith(item.href + '/')
        return (
          <Link
            key={slug}
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
