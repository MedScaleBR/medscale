'use client'

import Image from 'next/image'
import { LogOut } from 'lucide-react'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { AccountSwitcher } from './AccountSwitcher'
import { NavLinks } from './NavLinks'
import { useLogout } from '@/lib/auth/use-logout'
import type { ActiveSession, AccountSummary } from '@/lib/session/context'

interface MobileDrawerContentProps {
  session: ActiveSession
  accounts: AccountSummary[]
  onNavigate: () => void
}

export function MobileDrawerContent({ session, accounts, onNavigate }: MobileDrawerContentProps) {
  const { userModules, allWorkspaces, workspaceId, accountId, accountName, role } = session
  const logout = useLogout()

  return (
    <>
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
        role={role}
        className="flex-1 space-y-1 overflow-y-auto px-3 py-4"
        onNavigate={onNavigate}
      />

      <div className="border-t border-[var(--w10)] px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-[var(--w70)] transition-colors hover:bg-[var(--w10)] hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
        <div className="mt-2 px-3">
          <p className="truncate text-xs font-medium text-white/80">{accountName}</p>
          <p className="text-xs capitalize text-[var(--w60)]">{role}</p>
        </div>
      </div>
    </>
  )
}
