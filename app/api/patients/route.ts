import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const search = req.nextUrl.searchParams.get('q')

  // Pacientes são compartilhados entre as workspaces do mesmo account
  let query = supabase.from('patients').select('*').eq('account_id', session.accountId).order('full_name')

  if (search) {
    query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const body = await req.json()
  if (!body.full_name || !body.phone) {
    return NextResponse.json({ error: 'full_name e phone são obrigatórios' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('patients')
    .insert({
      account_id: session.accountId,
      full_name: body.full_name,
      phone: body.phone,
      email: body.email ?? null,
      birth_date: body.birth_date ?? null,
      notes: body.notes ?? null,
      tags: body.tags ?? [],
      created_by: session.userId,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
