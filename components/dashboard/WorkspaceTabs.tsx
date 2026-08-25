'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { WorkspaceSummary } from '@/lib/session/context'

interface WorkspaceTabsProps {
  workspaces: WorkspaceSummary[]
  activeView: string
}

export function WorkspaceTabs({ workspaces, activeView }: WorkspaceTabsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const navigate = (view: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', view)
    router.push(`${pathname}?${params.toString()}`)
  }

  const tabs = [{ id: 'consolidated', label: 'Todas as unidades' }, ...workspaces.map((w) => ({ id: w.id, label: w.name }))]

  return (
    <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg bg-[var(--navy-06)] p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => navigate(tab.id)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
            activeView === tab.id ? 'bg-white text-[var(--navy-dark)] shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
