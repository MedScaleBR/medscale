import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

async function requireMedscaleAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: isAdmin } = await supabase.rpc('is_medscale_admin')
  if (!isAdmin) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  return { supabase }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireMedscaleAdmin()
  if ('error' in result) return result.error
  const { supabase } = result

  const body = await req.json()
  if (!body.name) return NextResponse.json({ error: 'name é obrigatório' }, { status: 400 })

  // A account nasce sem unidade — a primeira cadastrada vira a padrão.
  const { count } = await supabase
    .from('workspaces')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', id)

  const { data, error } = await supabase
    .from('workspaces')
    .insert({ account_id: id, name: body.name, slug: slugify(body.slug || body.name), is_default: count === 0 })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
