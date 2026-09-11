'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Seções do módulo. Só aparecem para o owner — o guarda está no layout.
const SECTIONS = [
  { href: '/finance', label: 'Lançamentos' },
  { href: '/finance/reservas', label: 'Reservas' },
  { href: '/finance/investimentos', label: 'Investimentos' },
  { href: '/finance/projecoes', label: 'Projeções' },
  { href: '/finance/metas', label: 'Metas' },
  { href: '/finance/sugestoes', label: 'Sugestões' },
] as const

export function FinanceSectionNav() {
  const pathname = usePathname()

  return (
    <nav className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-0.5">
      {SECTIONS.map((s) => {
        // '/finance' é prefixo de todas as outras — só casa exato.
        const active = s.href === '/finance' ? pathname === s.href : pathname.startsWith(s.href)
        return (
          <Link
            key={s.href}
            href={s.href}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors ${
              active
                ? 'bg-[var(--navy)] font-medium text-white'
                : 'text-gray-600 hover:bg-[var(--navy-06)]'
            }`}
          >
            {s.label}
          </Link>
        )
      })}
    </nav>
  )
}
