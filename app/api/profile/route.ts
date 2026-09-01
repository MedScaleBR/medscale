import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

type ProfileUpdate = Database['public']['Tables']['profiles']['Update']

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const update: ProfileUpdate = {}

  const editableFields = ['full_name', 'specialty', 'crm', 'phone', 'avatar_url'] as const
  const MAX_LEN: Record<(typeof editableFields)[number], number> = {
    full_name: 120,
    specialty: 120,
    crm: 40,
    phone: 40,
    avatar_url: 500,
  }

  // Remove caracteres de controle (CR/LF etc.) e limita o tamanho — estes
  // campos livres alimentam e-mails (full_name) e o agente financeiro (phone).
  const clean = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null
    let out = ''
    for (const ch of v) {
      const code = ch.codePointAt(0) ?? 0
      out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : ch
    }
    out = out.replace(/\s+/g, ' ').trim().slice(0, max)
    return out || null
  }

  for (const field of editableFields) {
    if (field in body) (update as Record<string, string | null>)[field] = clean(body[field], MAX_LEN[field])
  }

  const { data, error } = await supabase.from('profiles').update(update).eq('id', user.id).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
