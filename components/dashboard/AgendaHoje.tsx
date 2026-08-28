import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type { TodayAgendaItem } from '@/lib/types'

const STATUS_LABEL: Record<string, string> = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  realizado: 'Realizado',
  cancelado: 'Cancelado',
  no_show: 'No-show',
}

export function AgendaHoje({ items }: { items: TodayAgendaItem[] }) {
  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-900">Agenda de hoje</h2>
        <Link href="/agenda" className="text-xs font-medium text-[var(--cyan-dark)] hover:underline">
          Ver agenda completa
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">Nenhuma consulta agendada para hoje.</p>
      ) : (
        <ul className="divide-y divide-[var(--navy-06)]">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-sm font-medium text-gray-900">
                  {new Date(item.scheduled_at).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    // Componente renderiza no servidor (UTC) — sem isto uma
                    // consulta 11:00 BRT (14:00Z) aparecia como "14:00".
                    timeZone: 'America/Sao_Paulo',
                  })}
                </span>
                <div>
                  <p className="text-sm font-medium text-gray-900">{item.patient_name}</p>
                  <p className="text-xs text-gray-400">{item.type}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  className={
                    item.source === 'bot'
                      ? 'border-none bg-[var(--cyan-10)] text-[var(--cyan-dark)]'
                      : 'border-none bg-[var(--navy-06)] text-[var(--navy)]'
                  }
                >
                  {item.source === 'bot' ? 'Bot' : 'Manual'}
                </Badge>
                <span className="text-xs text-gray-400">{STATUS_LABEL[item.status] ?? item.status}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
