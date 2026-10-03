import { formatDateBR } from '@/lib/admin/format'
import { COST_HIGHLIGHT_BRL } from '@/lib/admin/accounts'
import { formatBRL } from '@/lib/finance/summary'
import { cn } from '@/lib/utils'

const CARD = 'rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]'

export interface SidebarTask {
  id: string
  title: string
  dueDate: string | null
  overdue: boolean
  assigneeName: string | null
}

export interface SidebarActivity {
  typeLabel: string
  body: string
  authorName: string
  createdAt: string
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-[var(--navy-06)] py-2.5 text-sm first:border-t-0">
      <dt className="text-gray-500">{label}</dt>
      <dd className="min-w-0 truncate text-right text-gray-900">{children}</dd>
    </div>
  )
}

export function AccountSidebar({
  ownerName,
  workspacesCount,
  cost30d,
  costTruncated,
  openTasks,
  lastActivity,
}: {
  ownerName: string | null
  workspacesCount: number | null
  cost30d: number | null
  costTruncated: boolean
  openTasks: SidebarTask[]
  lastActivity: SidebarActivity | null
}) {
  return (
    <aside className="space-y-4 lg:sticky lg:top-6">
      <section className={CARD}>
        <h2 className="text-sm font-medium text-gray-900">Resumo</h2>
        <dl className="mt-3">
          <SummaryRow label="Owner">
            {ownerName ?? <span className="text-gray-400">Sem owner</span>}
          </SummaryRow>
          {workspacesCount !== null && <SummaryRow label="Unidades">{workspacesCount}</SummaryRow>}
          {cost30d !== null && (
            <SummaryRow label="Custo 30 dias">
              <span
                className={cn('whitespace-nowrap tabular-nums', cost30d > COST_HIGHLIGHT_BRL && 'text-red-600')}
                title={costTruncated ? 'Valor subestimado: muitos eventos no período' : undefined}
              >
                {formatBRL(cost30d)}
                {costTruncated && '+'}
              </span>
            </SummaryRow>
          )}
        </dl>
      </section>

      <section className={CARD}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-gray-900">Tarefas abertas</h2>
          {openTasks.length > 0 && (
            <a
              href="#tarefas"
              className="rounded text-xs text-[var(--cyan-dark)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
            >
              Ver
            </a>
          )}
        </div>
        {openTasks.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">Nenhuma tarefa aberta.</p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--navy-06)]">
            {openTasks.map((t) => (
              <li key={t.id} className="py-2.5">
                <a
                  href="#tarefas"
                  className="block rounded text-sm text-gray-900 outline-none hover:text-[var(--cyan-dark)] focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
                >
                  {t.title}
                </a>
                <p className={cn('mt-0.5 truncate text-xs', t.overdue ? 'text-red-500' : 'text-gray-400')}>
                  {[t.overdue ? 'Vencida' : null, t.dueDate ? formatDateBR(t.dueDate) : 'Sem prazo', t.assigneeName]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={CARD}>
        <h2 className="text-sm font-medium text-gray-900">Última atividade</h2>
        {lastActivity ? (
          <div className="mt-3">
            <p className="line-clamp-2 text-sm text-gray-900">{lastActivity.body}</p>
            <p className="mt-0.5 text-xs text-gray-400">
              {lastActivity.typeLabel} · {lastActivity.authorName} · {formatDateBR(lastActivity.createdAt)}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-gray-400">Nenhuma atividade registrada ainda.</p>
        )}
      </section>
    </aside>
  )
}
