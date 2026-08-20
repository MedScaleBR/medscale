import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { Badge } from '@/components/ui/badge'

const STATUS_LABEL: Record<string, string> = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  realizado: 'Realizado',
  cancelado: 'Cancelado',
  no_show: 'No-show',
}

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const { data: patient } = await supabase
    .from('patients')
    .select('*')
    .eq('id', id)
    .eq('account_id', session.accountId)
    .single()

  if (!patient) notFound()

  // Histórico completo do paciente, entre todas as workspaces do account
  const { data: appointments } = await supabase
    .from('appointments')
    .select('*')
    .eq('patient_id', id)
    .eq('account_id', session.accountId)
    .order('scheduled_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">{patient.full_name}</h1>
        <p className="text-sm text-gray-400">{patient.phone}{patient.email ? ` · ${patient.email}` : ''}</p>
      </div>

      {patient.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {patient.tags.map((t) => (
            <Badge key={t} className="border-none bg-[var(--navy-06)] text-[var(--navy)]">
              {t}
            </Badge>
          ))}
        </div>
      )}

      {patient.notes && (
        <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
          <h2 className="mb-2 text-sm font-medium text-gray-900">Observações</h2>
          <p className="text-sm text-gray-600">{patient.notes}</p>
        </div>
      )}

      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
        <h2 className="mb-4 text-sm font-medium text-gray-900">Histórico de consultas</h2>
        {!appointments || appointments.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">Nenhuma consulta registrada.</p>
        ) : (
          <ul className="divide-y divide-[var(--navy-06)]">
            {appointments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {new Date(a.scheduled_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                  <p className="text-xs text-gray-400">{a.type}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    className={
                      a.source === 'bot'
                        ? 'border-none bg-[var(--cyan-10)] text-[var(--cyan-dark)]'
                        : 'border-none bg-[var(--navy-06)] text-[var(--navy)]'
                    }
                  >
                    {a.source === 'bot' ? 'Bot' : 'Manual'}
                  </Badge>
                  <span className="text-xs text-gray-400">{STATUS_LABEL[a.status] ?? a.status}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
