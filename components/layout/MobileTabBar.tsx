'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { pickPrimaryTabs } from '@/lib/nav/tabs'
import { MODULE_NAV } from '@/components/layout/NavLinks'
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { MobileDrawerContent } from './MobileDrawerContent'
import type { ActiveSession, AccountSummary } from '@/lib/session/context'

interface MobileTabBarProps {
  session: ActiveSession
  accounts: AccountSummary[]
}

export function MobileTabBar({ session, accounts }: MobileTabBarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pathname = usePathname()
  const tabs = pickPrimaryTabs(session.userModules, session.role)

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-[var(--navy-06)] bg-white/90 backdrop-blur md:hidden">
      <ul className="flex items-stretch">
        {tabs.map((slug) => {
          const item = MODULE_NAV[slug]
          const Icon = item.icon
          const active = isActive(item.href)
          return (
            <li key={slug} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors',
                  active ? 'text-[var(--cyan-dark)]' : 'text-gray-400',
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="max-w-full truncate px-1">{item.label}</span>
              </Link>
            </li>
          )
        })}

        <li className="flex-1">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger
              className={cn(
                'flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-gray-400 transition-colors',
                drawerOpen && 'text-[var(--cyan-dark)]',
              )}
            >
              <Menu className="h-5 w-5" />
              <span>Mais</span>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="flex w-3/4 flex-col border-[var(--w10)] bg-[var(--navy-dark)] p-0 text-white"
            >
              <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
              <SheetDescription className="sr-only">Acesse as funcionalidades do sistema</SheetDescription>
              <MobileDrawerContent
                session={session}
                accounts={accounts}
                onNavigate={() => setDrawerOpen(false)}
              />
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  )
}
