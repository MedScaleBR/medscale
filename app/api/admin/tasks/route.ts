import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

async function requireMedscaleAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: isAdmin } = await supabase.rpc('is_medscale_admin')
  if (!isAdmin) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  return { supabase, user }
}

// Tarefa opcionalmente atrelada a uma account — account_id pode vir vazio
// para uma tarefa interna sem cliente associado.
export async function POST(req: NextRequest) {
  const result = await requireMedscaleAdmin()
  if ('error' in result) return result.error
  const { supabase, user } = result

  const body = await req.json()
  const title = (body.title as string | undefined)?.trim()
  if (!title) return NextResponse.json({ error: 'Título é obrigatório' }, { status: 400 })

  const { data, error } = await supabase
    .from('account_tasks')
    .insert({
      account_id: body.account_id || null,
      title,
      description: body.description || null,
      due_date: body.due_date || null,
      assigned_to: body.assigned_to || null,
      status: 'pending',
      created_by: user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
