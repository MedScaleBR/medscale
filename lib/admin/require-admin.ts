import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type AdminClient = Awaited<ReturnType<typeof createClient>>
type AdminUser = NonNullable<Awaited<ReturnType<AdminClient['auth']['getUser']>>['data']['user']>

export type RequireAdminResult = { error: NextResponse } | { supabase: AdminClient; user: AdminUser }

// Guarda das rotas /api/admin: exige usuário logado que seja admin da Medscale.
// Retorna o client já autenticado para a rota reutilizar, ou a resposta de erro.
export async function requireMedscaleAdmin(): Promise<RequireAdminResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }

  const { data: isAdmin } = await supabase.rpc('is_medscale_admin')
  if (!isAdmin) return { error: NextResponse.json({ error: 'Acesso negado' }, { status: 403 }) }

  return { supabase, user }
}
