import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { UnitDetailForm } from '@/components/locais/UnitDetailForm'
import { AvailabilitySettings } from '@/components/configuracoes/AvailabilitySettings'

export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id, name, address, city, state, zip_code, directions_parking, contact_info, handoff_number')
    .eq('id', id)
    .eq('account_id', session.accountId)
    .maybeSingle()
  if (!workspace) notFound()
  const [{ data: rules }, { data: exceptions }] = await Promise.all([
    supabase.from('availability_rules').select('*').eq('workspace_id', id).order('day_of_week').order('start_time'),
    supabase.from('availability_exceptions').select('*').eq('workspace_id', id).order('date'),
  ])
  const canManage = session.role === 'owner' || session.role === 'admin'

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/locais" className="mb-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-3.5 w-3.5" />
          Meus locais
        </Link>
        <h1 className="text-xl font-medium text-gray-900">{workspace.name}</h1>
        <p className="text-sm text-gray-400">Dados que aparecem para o paciente e que a Clara usa nesta unidade.</p>
      </div>
      <UnitDetailForm
        workspace={workspace}
        canManage={canManage}
      />
      <section className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">Expediente presencial</h2>
        <AvailabilitySettings
          key={workspace.id}
          initialRules={rules ?? []}
          initialExceptions={exceptions ?? []}
          workspaces={[workspace]}
          initialWorkspaceId={workspace.id}
        />
      </section>
    </div>
  )
}
