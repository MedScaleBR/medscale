import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { AvailabilitySettings } from '@/components/configuracoes/AvailabilitySettings'

export default async function ExpedientePage() {
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const [{ data: rules }, { data: exceptions }] = await Promise.all([
    supabase
      .from('availability_rules')
      .select('*')
      .eq('workspace_id', session.workspaceId)
      .order('day_of_week')
      .order('start_time'),
    supabase.from('availability_exceptions').select('*').eq('workspace_id', session.workspaceId).order('date'),
  ])

  return (
    <div className="space-y-6">
      <div>
        <Link href="/configuracoes" className="mb-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-3.5 w-3.5" />
          Configurações
        </Link>
        <h1 className="text-xl font-medium text-gray-900">Meu expediente</h1>
        <p className="text-sm text-gray-400">Horários de atendimento e dias bloqueados usados pelo bot para agendar.</p>
      </div>

      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <AvailabilitySettings initialRules={rules ?? []} initialExceptions={exceptions ?? []} />
      </div>
    </div>
  )
}
