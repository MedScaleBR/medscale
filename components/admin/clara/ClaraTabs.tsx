'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const TABS = [
  { label: 'Simulador', href: '/admin/clara/simulador' },
  { label: 'Modelos', href: '/admin/clara/modelos' },
]

export function ClaraTabs() {
  const pathname = usePathname()
  return (
    <nav aria-label="Ferramentas da Clara" className="flex gap-1 border-b border-[var(--navy-06)]">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              active ? 'border-[var(--cyan-dark)] font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
