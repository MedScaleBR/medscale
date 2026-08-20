import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { PatientsClient } from '@/components/pacientes/PatientsClient'

export default async function PacientesPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const { data: patients } = await supabase
    .from('patients')
    .select('*')
    .eq('account_id', session.accountId)
    .order('full_name')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Pacientes</h1>
        <p className="text-sm text-gray-400">{patients?.length ?? 0} pacientes cadastrados</p>
      </div>
      <PatientsClient initialPatients={patients ?? []} />
    </div>
  )
}
