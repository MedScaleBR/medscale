'use client'

import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const TAB_VALUES = ['plan', 'activity', 'tasks'] as const
type TabValue = (typeof TAB_VALUES)[number]

// Âncoras em português para links de fora das abas (ex.: "Ver" no resumo).
const HASH_TO_TAB: Record<string, TabValue> = {
  '#plano': 'plan',
  '#atividade': 'activity',
  '#tarefas': 'tasks',
}

const TRIGGER =
  'h-auto flex-none rounded-none border-0 px-3.5 pt-1 pb-2.5 text-sm font-normal text-gray-500 hover:text-gray-900 data-active:text-gray-900 after:bg-[var(--cyan)] group-data-horizontal/tabs:after:bottom-[-1px]'

export function AccountTabs({
  activityCount,
  openTasksCount,
  plan,
  activity,
  tasks,
}: {
  activityCount: number
  openTasksCount: number
  plan: React.ReactNode
  activity: React.ReactNode
  tasks: React.ReactNode
}) {
  const [tab, setTab] = useState<TabValue>('plan')

  useEffect(() => {
    const sync = () => {
      const next = HASH_TO_TAB[window.location.hash]
      if (next) setTab(next)
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  return (
    <Tabs value={tab} onValueChange={(v) => TAB_VALUES.includes(v as TabValue) && setTab(v as TabValue)} id="abas">
      <TabsList
        variant="line"
        className="w-full justify-start gap-0 overflow-x-auto rounded-none border-b border-[var(--navy-10)] p-0 group-data-horizontal/tabs:h-auto"
      >
        <TabsTrigger value="plan" className={TRIGGER}>
          Plano e membros
        </TabsTrigger>
        <TabsTrigger value="activity" className={TRIGGER}>
          Atividade <span className="text-gray-400">{activityCount}</span>
        </TabsTrigger>
        <TabsTrigger value="tasks" className={TRIGGER}>
          Tarefas <span className="text-gray-400">{openTasksCount}</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="plan" keepMounted className="mt-4 space-y-4">
        {plan}
      </TabsContent>
      <TabsContent value="activity" keepMounted className="mt-4">
        {activity}
      </TabsContent>
      <TabsContent value="tasks" keepMounted className="mt-4">
        {tasks}
      </TabsContent>
    </Tabs>
  )
}
