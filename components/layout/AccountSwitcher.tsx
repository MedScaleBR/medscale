'use client'

import { switchAccount } from '@/lib/session/actions'
import type { AccountSummary } from '@/lib/session/context'

interface AccountSwitcherProps {
  accounts: AccountSummary[]
  activeId: string
}

export function AccountSwitcher({ accounts, activeId }: AccountSwitcherProps) {
  return (
    <div className="border-b border-[var(--w10)] px-4 py-2">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--w60)]">Conta</p>
      <select
        defaultValue={activeId}
        onChange={(e) => switchAccount(e.target.value)}
        className="w-full cursor-pointer rounded-md border-none bg-[var(--w10)] px-2 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-[var(--cyan)]"
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id} className="bg-[var(--navy-dark)]">
            {a.name}
          </option>
        ))}
      </select>
    </div>
  )
}
