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
// multi-tenant mantêm o nome de sempre (/bot, /trafego) — só as três novas
// (locations, schedule, waitlist) seguem os nomes sugeridos pelo módulo de
// multi-tenant, já que não havia rota anterior para preservar.
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
  // Ciclo de receita + histórico de entradas numa tela só (/ciclo-receita).
  revenue_cycle: { label: 'Ciclo de receita', href: '/ciclo-receita', icon: Receipt },
}

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
  const isVisible = (slug: ModuleSlug) =>
    userModules.includes(slug) &&
    (role === 'owner' || !OWNER_ONLY_MODULES.includes(slug)) &&
    (role !== 'member' || !ADMIN_MIN_MODULES.includes(slug))

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
