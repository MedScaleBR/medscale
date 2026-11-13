import Link from 'next/link'
import { cn } from '@/lib/utils'

/** Abas Geral | Por cliente do painel de custos; trocar de aba mantém o período. */
export function CostsTabs({
  active,
  periodQuery,
}: {
  active: 'geral' | 'cliente'
  periodQuery: Record<string, string>
}) {
  const tabs = [
    { id: 'geral' as const, label: 'Geral', query: periodQuery },
    { id: 'cliente' as const, label: 'Por cliente', query: { tab: 'cliente', ...periodQuery } },
  ]
  return (
    <nav aria-label="Visão" className="flex gap-5 border-b border-[var(--navy-06)]">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={`/admin/costs?${new URLSearchParams(t.query).toString()}`}
          aria-current={t.id === active ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-0.5 pb-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)]',
            t.id === active
              ? 'border-[var(--cyan)] font-medium text-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-900',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
