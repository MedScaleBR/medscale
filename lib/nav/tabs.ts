import type { MembershipRole } from '@/types/database'
import type { ModuleSlug } from '@/lib/session/context'

// Rota real + rótulo curto de cada módulo. Extraído de MODULE_NAV
// (components/layout/NavLinks.tsx) para ser importável sem React — a tab bar
// mobile e os testes usam isto direto. NavLinks.tsx remonta MODULE_NAV
// juntando o ícone a cada entrada daqui.
export const MODULE_ROUTES: Record<ModuleSlug, { href: string; label: string }> = {
  dashboard: { href: '/dashboard', label: 'Meu painel' },
  agenda: { href: '/agenda', label: 'Minha agenda' },
  conversations: { href: '/bot', label: 'Conversas' },
  locations: { href: '/locais', label: 'Meus locais' },
  schedule: { href: '/expediente', label: 'Meu expediente' },
  waitlist: { href: '/lista-espera', label: 'Lista de espera' },
  campaigns: { href: '/trafego', label: 'Atribuição' },
  patients: { href: '/pacientes', label: 'Meus pacientes' },
  settings: { href: '/configuracoes', label: 'Configuração' },
  transcriptions: { href: '/transcricoes', label: 'Transcrições' },
  finance: { href: '/finance', label: 'Financeiro' },
  revenue_cycle: { href: '/ciclo-receita', label: 'Ciclo de receita' },
}

// Só o owner vê estes módulos, mesmo ativos no account.
export const OWNER_ONLY_MODULES: ModuleSlug[] = ['finance']

// Exigem no mínimo papel admin.
export const ADMIN_MIN_MODULES: ModuleSlug[] = ['revenue_cycle']

// Módulos que um owner pode restringir por pessoa via module_overrides —
// exclui os sempre-ativos (ALWAYS_ON_MODULES) e os exclusivos de owner
// (OWNER_ONLY_MODULES, que dependem do papel, não de override). Vive aqui
// (não em NavLinks.tsx, que é 'use client') para ser importável em Server
// Components e route handlers sem virar client reference.
export const OVERRIDABLE_MODULES: ModuleSlug[] = [
  'agenda',
  'conversations',
  'locations',
  'schedule',
  'waitlist',
  'campaigns',
  'transcriptions',
]

// Mesma regra do antigo NavLinks.isVisible.
export function isModuleVisible(
  slug: ModuleSlug,
  userModules: ModuleSlug[],
  role: MembershipRole,
): boolean {
  return (
    userModules.includes(slug) &&
    (role === 'owner' || !OWNER_ONLY_MODULES.includes(slug)) &&
    (role !== 'member' || !ADMIN_MIN_MODULES.includes(slug))
  )
}

// Prioridade das abas primárias da tab bar mobile: as N primeiras visíveis
// entram; o resto fica sob "Mais".
export const PRIMARY_TAB_ORDER: ModuleSlug[] = [
  'dashboard',
  'agenda',
  'conversations',
  'patients',
]

export const MAX_PRIMARY_TABS = 4

export function pickPrimaryTabs(
  userModules: ModuleSlug[],
  role: MembershipRole,
): ModuleSlug[] {
  return PRIMARY_TAB_ORDER
    .filter((slug) => isModuleVisible(slug, userModules, role))
    .slice(0, MAX_PRIMARY_TABS)
}

// Título da tela para a Topbar mobile: casa o pathname com o href de módulo
// mais longo que o prefixa. '' quando nada casa.
export function moduleTitleFromPath(pathname: string): string {
  let best: { href: string; label: string } | null = null
  for (const entry of Object.values(MODULE_ROUTES)) {
    const hit = pathname === entry.href || pathname.startsWith(entry.href + '/')
    if (hit && (!best || entry.href.length > best.href.length)) best = entry
  }
  return best?.label ?? ''
}
