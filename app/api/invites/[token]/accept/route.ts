import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Lookup do convite pelo token exige o client administrativo — não existe
  // policy de RLS que permita ler `invites` por token (evita vazar convites
  // pendentes de outras contas via a anon key).
  const admin = createAdminClient()
  const { data: invite } = await admin.from('invites').select('*').eq('token', token).single()

  if (!invite) return NextResponse.json({ error: 'Convite não encontrado.' }, { status: 404 })
  if (invite.accepted_at) return NextResponse.json({ error: 'Este convite já foi aceito.' }, { status: 400 })
  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Este convite expirou.' }, { status: 400 })
  }
  if (invite.email.toLowerCase() !== user.email?.toLowerCase()) {
    return NextResponse.json(
      { error: `Este convite foi enviado para ${invite.email}, faça login com esse e-mail.` },
      { status: 403 }
    )
  }

  const { data: membership, error: membershipError } = await admin
    .from('memberships')
    .insert({
      account_id: invite.account_id,
      user_id: user.id,
      role: invite.role,
      status: 'active',
      invited_by: invite.invited_by,
      accepted_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 500 })

  await admin.from('invites').update({ accepted_at: new Date().toISOString() }).eq('id', invite.id)

  return NextResponse.json({ accountId: membership.account_id })
}
