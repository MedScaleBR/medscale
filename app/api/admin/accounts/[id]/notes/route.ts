import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { AccountNoteType } from '@/types/database'

const VALID_TYPES: AccountNoteType[] = ['note', 'call', 'email', 'meeting']

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireMedscaleAdmin()
  if ('error' in result) return result.error
  const { supabase, user } = result

  const body = await req.json()
  const type = body.type as AccountNoteType | undefined
  const noteBody = (body.body as string | undefined)?.trim()

  if (!noteBody) return NextResponse.json({ error: 'Conteúdo é obrigatório' }, { status: 400 })
  if (type && !VALID_TYPES.includes(type)) return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 })

  const { data, error } = await supabase
    .from('account_notes')
    .insert({ account_id: id, type: type ?? 'note', body: noteBody, created_by: user.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
