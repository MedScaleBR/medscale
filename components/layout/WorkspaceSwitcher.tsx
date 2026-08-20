'use client'

import { switchWorkspace } from '@/lib/session/actions'
import type { WorkspaceSummary } from '@/lib/session/context'

interface WorkspaceSwitcherProps {
  workspaces: WorkspaceSummary[]
  activeId: string
}

export function WorkspaceSwitcher({ workspaces, activeId }: WorkspaceSwitcherProps) {
  return (
    <div className="border-b border-[var(--w10)] px-4 py-2">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--w60)]">Unidade</p>
      <select
        defaultValue={activeId}
        onChange={(e) => switchWorkspace(e.target.value)}
        className="w-full cursor-pointer rounded-md border-none bg-[var(--w10)] px-2 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-[var(--cyan)]"
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id} className="bg-[var(--navy-dark)]">
            {w.name}
          </option>
        ))}
      </select>
    </div>
  )
}
