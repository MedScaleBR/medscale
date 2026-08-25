'use client'

import Image from 'next/image'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { AccountSwitcher } from './AccountSwitcher'
import { NavLinks } from './NavLinks'
import type { ActiveSession } from '@/lib/session/context'
import type { AccountSummary } from '@/lib/session/context'

interface SidebarProps {
  session: ActiveSession
  accounts: AccountSummary[]
}

export function Sidebar({ session, accounts }: SidebarProps) {
  const { userModules, allWorkspaces, workspaceId, accountId, accountName, role } = session

  return (
    <aside className="hidden w-64 shrink-0 flex-col bg-[var(--navy-dark)] text-white md:flex">
      <div className="flex h-16 items-center gap-2 px-6">
        <div className="flex h-8 items-center justify-center rounded-lg bg-white px-1.5">
          <Image src="/logo-icon.png" alt="MedScale" width={138} height={96} className="h-[18px] w-auto" priority />
        </div>
        <span className="text-base font-semibold">MedScale</span>
      </div>

      {accounts.length > 1 && <AccountSwitcher accounts={accounts} activeId={accountId} />}
      {allWorkspaces.length > 1 && <WorkspaceSwitcher workspaces={allWorkspaces} activeId={workspaceId} />}

      <NavLinks userModules={userModules} className="flex-1 space-y-1 px-3 py-4" />

      <div className="border-t border-[var(--w10)] px-6 py-4">
        <p className="truncate text-xs font-medium text-white/80">{accountName}</p>
        <p className="text-xs capitalize text-[var(--w60)]">{role}</p>
      </div>
    </aside>
  )
}
