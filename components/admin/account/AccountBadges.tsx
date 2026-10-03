import { cn } from '@/lib/utils'
import type { AccountPlan } from '@/types/database'

export const PLAN_LABEL: Record<AccountPlan, string> = {
  essencial: 'Essencial',
  avancado: 'Avançado',
  premium: 'Premium',
}

// Essencial neutro, Avançado cyan, Premium navy.
const PLAN_STYLE: Record<AccountPlan, string> = {
  essencial: 'bg-gray-100 text-gray-600',
  avancado: 'bg-[var(--cyan-10)] text-[var(--cyan-dark)]',
  premium: 'bg-[var(--navy-10)] text-[var(--navy)]',
}

const PILL = 'inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap'

export function PlanBadge({ plan, className }: { plan: AccountPlan; className?: string }) {
  return <span className={cn(PILL, PLAN_STYLE[plan] ?? PLAN_STYLE.essencial, className)}>{PLAN_LABEL[plan] ?? plan}</span>
}

export function StatusBadge({ active, className }: { active: boolean; className?: string }) {
  return (
    <span className={cn(PILL, active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600', className)}>
      {active ? 'Ativa' : 'Inativa'}
    </span>
  )
}
