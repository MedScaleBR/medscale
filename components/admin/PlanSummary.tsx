import type { AccountPlan } from '@/types/database'

const PLANS: { key: AccountPlan; label: string }[] = [
  { key: 'essencial', label: 'Essencial' },
  { key: 'avancado', label: 'Avançado' },
  { key: 'premium', label: 'Premium' },
]

export function PlanSummary({ byPlan }: { byPlan: Record<AccountPlan, number> }) {
  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <h2 className="text-sm font-medium text-gray-900">Accounts por plano</h2>
      <ul className="mt-4 space-y-3">
        {PLANS.map((p) => (
          <li key={p.key} className="flex items-center justify-between text-sm">
            <span className="text-gray-600">{p.label}</span>
            <span className="inline-flex h-5 min-w-7 items-center justify-center rounded-full bg-[var(--navy-06)] px-2 text-xs font-medium whitespace-nowrap text-gray-700">
              {byPlan[p.key] ?? 0}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
