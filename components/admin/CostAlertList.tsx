import Link from 'next/link'
import { ConvertToTaskButton } from '@/components/admin/ConvertToTaskButton'
import type { CostAlertWithRef } from '@/lib/admin/cost-alerts'
import { formatBRL } from '@/lib/finance/summary'

// Card âmbar de /admin/costs: sinais de bot mal configurado, cada um com o
// atalho para virar tarefa (source_ref = ref estável do alerta no mês).
export function CostAlertList({ alerts, taskedRefs }: { alerts: CostAlertWithRef[]; taskedRefs: Set<string> }) {
  if (alerts.length === 0) return null

  return (
    <section className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50">
      <div className="border-b border-amber-200 px-5 py-3">
        <h2 className="text-sm font-medium text-amber-900">Possível bot mal configurado</h2>
        <p className="text-xs text-amber-900/80">
          Conversas que giram sem fechar, ou conversa média cara demais — custo que não vira agendamento
        </p>
      </div>
      <ul className="divide-y divide-amber-200">
        {alerts.map((alert) => (
          <li key={alert.ref} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
            <p className="min-w-0 text-sm text-amber-900">
              <Link
                href={`/admin/accounts/${alert.accountId}`}
                className="underline underline-offset-2 hover:text-amber-900/80"
              >
                {alert.accountName}
              </Link>
              {' — '}
              {alert.detail}
            </p>
            <div className="flex shrink-0 items-center gap-4">
              {alert.cost > 0 && (
                <span className="text-sm whitespace-nowrap text-amber-900">{formatBRL(alert.cost)}</span>
              )}
              <ConvertToTaskButton
                sourceType="cost_alert"
                sourceRef={alert.ref}
                title={alert.title}
                accountId={alert.accountId}
                initialTasked={taskedRefs.has(alert.ref)}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
