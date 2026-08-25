import Link from 'next/link'
import type { AdminTaskItem } from '@/lib/admin/dashboard'

export function TasksWidget({ overdue, upcoming }: { overdue: AdminTaskItem[]; upcoming: AdminTaskItem[] }) {
  const items = [...overdue, ...upcoming].slice(0, 8)

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-900">Tarefas pendentes</h2>
        <Link href="/admin/tasks" className="text-xs text-[var(--cyan-dark)] hover:underline">
          Ver todas
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-gray-400">Nenhuma tarefa pendente.</p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--navy-06)]">
          {items.map((t) => {
            const isOverdue = overdue.some((o) => o.id === t.id)
            return (
              <li key={t.id} className="py-2.5">
                {t.accountId ? (
                  <Link href={`/admin/accounts/${t.accountId}`} className="text-sm text-gray-900 hover:text-[var(--cyan-dark)]">
                    {t.title}
                  </Link>
                ) : (
                  <span className="text-sm text-gray-900">{t.title}</span>
                )}
                <p className="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
                  <span>{t.accountName ?? 'Sem cliente'}</span>
                  {t.dueDate && (
                    <span className={isOverdue ? 'font-medium text-red-500' : ''}>
                      · {new Date(t.dueDate + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </span>
                  )}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
