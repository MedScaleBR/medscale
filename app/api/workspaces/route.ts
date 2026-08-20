import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export async function GET() {
  const session = await resolveActiveSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('workspaces')
    .select('id, name, slug, address, city, state, zip_code, is_active, is_default, display_order')
    .eq('account_id', session.accountId)
    .order('display_order')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const session = await resolveActiveSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'owner' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas admins do account podem criar unidades.' }, { status: 403 })
  }

  const supabase = await createClient()
  const body = await req.json()
  if (!body.name) {
    return NextResponse.json({ error: 'name é obrigatório' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('workspaces')
    .insert({
      account_id: session.accountId,
      name: body.name,
      slug: slugify(body.slug || body.name),
      address: body.address ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      zip_code: body.zip_code ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
