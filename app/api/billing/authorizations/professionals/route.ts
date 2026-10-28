import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { loadProfessionals } from '@/lib/billing/authorizations/sources'

// Profissionais com CRM da account, para o seletor "Profissional solicitante".
// Só owner/admin; sem telefone/e-mail (R3).
export async function GET(req: NextRequest) {
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session } = result
  try {
    const supabase = await createClient()
    return NextResponse.json({ professionals: await loadProfessionals(supabase, session.workspaceId) })
  } catch {
    return NextResponse.json({ error: 'Não foi possível carregar os profissionais.' }, { status: 500 })
  }
}
