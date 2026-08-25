'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Menu } from 'lucide-react'
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { AccountSwitcher } from './AccountSwitcher'
import { NavLinks } from './NavLinks'
import type { ActiveSession, AccountSummary } from '@/lib/session/context'

interface MobileNavProps {
  session: ActiveSession
  accounts: AccountSummary[]
}

export function MobileNav({ session, accounts }: MobileNavProps) {
  const [open, setOpen] = useState(false)
  const { userModules, allWorkspaces, workspaceId, accountId, accountName, role } = session

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-[var(--navy-06)] md:hidden">
        <Menu className="h-5 w-5" />
        <span className="sr-only">Abrir menu</span>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="flex w-3/4 flex-col border-[var(--w10)] bg-[var(--navy-dark)] p-0 text-white"
      >
        <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
        <SheetDescription className="sr-only">Acesse as funcionalidades do sistema</SheetDescription>

        <div className="flex h-16 items-center gap-2 px-6">
          <div className="flex h-8 items-center justify-center rounded-lg bg-white px-1.5">
            <Image src="/logo-icon.png" alt="MedScale" width={138} height={96} className="h-[18px] w-auto" priority />
          </div>
          <span className="text-base font-semibold">MedScale</span>
        </div>

        {accounts.length > 1 && <AccountSwitcher accounts={accounts} activeId={accountId} />}
        {allWorkspaces.length > 1 && <WorkspaceSwitcher workspaces={allWorkspaces} activeId={workspaceId} />}

        <NavLinks
          userModules={userModules}
          className="flex-1 space-y-1 px-3 py-4"
          onNavigate={() => setOpen(false)}
        />

        <div className="border-t border-[var(--w10)] px-6 py-4">
          <p className="truncate text-xs font-medium text-white/80">{accountName}</p>
          <p className="text-xs capitalize text-[var(--w60)]">{role}</p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
