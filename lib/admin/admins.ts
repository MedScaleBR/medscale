import { createAdminClient, createClient } from '@/lib/supabase/server'

export interface MedscaleAdminProfile {
  id: string
  full_name: string
  email: string | null
}

// medscale_admins não tem nenhuma RLS policy (leitura só via service role),
// então esta listagem — usada nos dropdowns de "responsável" das tarefas do
// CRM — precisa do client admin mesmo sendo chamada a partir de uma página.
// O layout de /admin já exige is_medscale_admin(), mas layout não protege a
// página: num request RSC ela pode renderizar sozinha. Por isso confere de
// novo com o client do usuário antes de usar a service role.
export async function getMedscaleAdmins(): Promise<MedscaleAdminProfile[]> {
  const supabase = await createClient()
  const { data: isAdmin, error } = await supabase.rpc('is_medscale_admin')
  if (error || !isAdmin) return []

  const admin = createAdminClient()

  const { data: adminRows } = await admin.from('medscale_admins').select('user_id')
  const ids = (adminRows ?? []).map((r) => r.user_id)
  if (ids.length === 0) return []

  const { data: profiles } = await admin.from('profiles').select('id, full_name, email').in('id', ids)
  return profiles ?? []
}
