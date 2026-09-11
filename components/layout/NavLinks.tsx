'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { ModuleSlug } from '@/lib/session/context'
import type { MembershipRole } from '@/types/database'
import { MODULE_ROUTES, isModuleVisible } from '@/lib/nav/tabs'
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

// Slug do módulo → ícone. Rota e rótulo vêm de MODULE_ROUTES (lib/nav/tabs.ts);
// aqui só juntamos o componente de ícone para montar MODULE_NAV.
const MODULE_ICONS: Record<ModuleSlug, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  agenda: CalendarDays,
  conversations: MessageCircle,
  locations: MapPin,
  schedule: Clock,
  waitlist: Hourglass,
  campaigns: TrendingUp,
  patients: Users,
  settings: Settings,
  transcriptions: FileAudio,
  finance: Wallet,
  revenue_cycle: Receipt,
}

export const MODULE_NAV: Record<ModuleSlug, NavItem> = Object.fromEntries(
  (Object.keys(MODULE_ROUTES) as ModuleSlug[]).map((slug) => [
    slug,
    { ...MODULE_ROUTES[slug], icon: MODULE_ICONS[slug] },
  ]),
) as Record<ModuleSlug, NavItem>

// Agrupamento fixo da navegação por categoria. A ordem dos grupos e dos
// módulos dentro deles independe da ordem em accountModules/userModules.
// group.label === null → sem cabeçalho (o painel fica solto no topo).
interface NavGroup {
  label: string | null
  modules: ModuleSlug[]
}

export const NAV_GROUPS: NavGroup[] = [
  { label: null, modules: ['dashboard'] },
  { label: 'Atendimento', modules: ['agenda', 'conversations', 'waitlist'] },
  { label: 'Pacientes', modules: ['patients', 'transcriptions'] },
  { label: 'Operação', modules: ['locations', 'schedule'] },
  { label: 'Financeiro', modules: ['finance', 'revenue_cycle'] },
  { label: 'Crescimento', modules: ['campaigns'] },
  { label: 'Sistema', modules: ['settings'] },
]

// Ordem fixa de exibição, derivada de NAV_GROUPS (achatada).
export const NAV_ORDER: ModuleSlug[] = NAV_GROUPS.flatMap((g) => g.modules)

// OWNER_ONLY_MODULES ('finance'), ADMIN_MIN_MODULES ('revenue_cycle'),
// OVERRIDABLE_MODULES e a regra isModuleVisible vivem em lib/nav/tabs.ts —
// importados no topo.

interface NavLinksProps {
  userModules: ModuleSlug[]
  role: MembershipRole
  className?: string
  onNavigate?: () => void
}

export function NavLinks({ userModules, role, className, onNavigate }: NavLinksProps) {
  const pathname = usePathname()
  const isVisible = (slug: ModuleSlug) => isModuleVisible(slug, userModules, role)

  const groups = NAV_GROUPS.map((group) => ({
    label: group.label,
    modules: group.modules.filter(isVisible),
  })).filter((group) => group.modules.length > 0)

  return (
    <nav className={className}>
      {groups.map((group, groupIndex) => (
        <div key={group.label ?? '__root__'} className={cn('space-y-1', groupIndex > 0 && 'pt-4')}>
          {group.label && (
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--w40)]">
              {group.label}
            </p>
          )}
          {group.modules.map((slug) => {
            const item = MODULE_NAV[slug]
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
        </div>
      ))}
    </nav>
  )
}
