import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'

// Resolve o paciente pelo telefone (unique por account) ou cria um novo —
// usado ao iniciar uma transcrição a partir de uma consulta da Agenda, já
// que appointments guarda patient_name/patient_phone em texto livre e nem
// sempre tem patient_id vinculado.
export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const body = await req.json()
  const fullName = body.full_name as string | undefined
  const phone = body.phone as string | undefined
  if (!fullName || !phone) {
    return NextResponse.json({ error: 'full_name e phone são obrigatórios' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('patients')
    .select('id, full_name')
    .eq('account_id', session.accountId)
    .eq('phone', phone)
    .maybeSingle()

  if (existing) return NextResponse.json(existing)

  const { data: created, error } = await supabase
    .from('patients')
    .insert({
      account_id: session.accountId,
      full_name: fullName,
      phone,
      created_by: session.userId,
    })
    .select('id, full_name')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(created, { status: 201 })
}
