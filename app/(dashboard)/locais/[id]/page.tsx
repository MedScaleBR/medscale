import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { UnitDetailForm } from '@/components/locais/UnitDetailForm'

export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const [{ data: workspace }, { data: handoffHours }] = await Promise.all([
    supabase
      .from('workspaces')
      .select('id, name, address, city, state, zip_code, business_hours, directions_parking, contact_info, handoff_number')
      .eq('id', id)
      .eq('account_id', session.accountId)
      .maybeSingle(),
    supabase.from('handoff_hours').select('*').eq('workspace_id', id).order('day_of_week').order('start_time'),
  ])
  if (!workspace) notFound()

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
        handoffHours={handoffHours ?? []}
        canManage={session.role === 'owner' || session.role === 'admin'}
      />
    </div>
  )
}
