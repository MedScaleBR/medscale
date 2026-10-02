import Link from 'next/link'
import { CalendarClock } from 'lucide-react'
import type { PendingConfirmationItem } from '@/lib/types'

interface PendingConfirmationsProps {
  items: PendingConfirmationItem[] | null
  workspaces: { id: string; name: string }[]
}

export function PendingConfirmations({ items, workspaces }: PendingConfirmationsProps) {
  return (
    <section className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-gray-900">Pendentes de confirmação</h2>
          <p className="mt-1 text-xs text-gray-500">Consultas nas próximas 24 horas</p>
        </div>
        <CalendarClock className="h-5 w-5 shrink-0 text-[var(--cyan-dark)]" aria-hidden="true" />
      </div>
      {items === null ? (
        <p className="mt-4 text-sm text-amber-700" role="status">Não foi possível carregar as pendências. Atualize a página para tentar novamente.</p>
      ) : (
        <>
          <p className="mt-4 text-3xl font-medium text-gray-900">{items.length}</p>
          {items.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">Nenhuma consulta aguardando confirmação nesse período.</p>
          ) : (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-[var(--cyan-dark)] hover:underline">Ver consultas pendentes</summary>
              <ul className="mt-3 max-h-72 divide-y divide-[var(--navy-06)] overflow-y-auto">
                {items.map((item) => (
                  <li key={item.id} className="py-3">
                    <p className="text-sm font-medium text-gray-900">{item.patient_name}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {new Date(item.scheduled_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}
                      {workspaces.length > 1 && ` · ${workspaces.find((workspace) => workspace.id === item.workspace_id)?.name ?? 'Unidade'}`}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <Link href="/agenda" className="mt-4 inline-block text-xs font-medium text-[var(--cyan-dark)] hover:underline">Abrir agenda →</Link>
    </section>
  )
}
