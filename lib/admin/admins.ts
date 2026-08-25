import { createAdminClient } from '@/lib/supabase/server'

export interface MedscaleAdminProfile {
  id: string
  full_name: string
  email: string | null
}

// medscale_admins não tem nenhuma RLS policy (leitura só via service role),
// então esta listagem — usada nos dropdowns de "responsável" das tarefas do
// CRM — precisa do client admin mesmo sendo chamada a partir de uma página.
// Seguro porque toda a rota /admin já é gated por is_medscale_admin() no
// layout antes de qualquer página chegar a chamar isto.
export async function getMedscaleAdmins(): Promise<MedscaleAdminProfile[]> {
  const admin = createAdminClient()

  const { data: adminRows } = await admin.from('medscale_admins').select('user_id')
  const ids = (adminRows ?? []).map((r) => r.user_id)
  if (ids.length === 0) return []

  const { data: profiles } = await admin.from('profiles').select('id, full_name, email').in('id', ids)
  return profiles ?? []
}
