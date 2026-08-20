import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { sendInviteEmail } from '@/lib/email/mailer'
import type { MembershipRole } from '@/types/database'

const VALID_ROLES: MembershipRole[] = ['owner', 'admin', 'member']

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: isAdmin } = await supabase.rpc('is_medscale_admin')
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const email = (body.email as string | undefined)?.trim().toLowerCase()
  const role = body.role as MembershipRole | undefined

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'E-mail válido é obrigatório' }, { status: 400 })
  }
  if (!role || !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Papel inválido' }, { status: 400 })
  }

  // A partir daqui usamos o client admin (service role) pelo mesmo motivo do
  // POST em /api/admin/accounts: convite ainda não tem membership, então não
  // há policy de RLS que cubra essas leituras/escritas via o client comum.
  const admin = createAdminClient()

  const { data: account } = await admin.from('accounts').select('name').eq('id', id).single()
  if (!account) return NextResponse.json({ error: 'Account não encontrada' }, { status: 404 })

  const { data: existingProfile } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
  if (existingProfile) {
    const { data: existingMembership } = await admin
      .from('memberships')
      .select('id')
      .eq('account_id', id)
      .eq('user_id', existingProfile.id)
      .maybeSingle()
    if (existingMembership) {
      return NextResponse.json({ error: 'Este e-mail já é membro desta account.' }, { status: 400 })
    }
  }

  const { data: existingInvite } = await admin
    .from('invites')
    .select('id')
    .eq('account_id', id)
    .eq('email', email)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (existingInvite) {
    return NextResponse.json({ error: 'Já existe um convite pendente para este e-mail.' }, { status: 400 })
  }

  const { data: invite, error: inviteError } = await admin
    .from('invites')
    .insert({ account_id: id, email, role, invited_by: user.id })
    .select()
    .single()

  if (inviteError) return NextResponse.json({ error: inviteError.message }, { status: 500 })

  const emailResult = await sendInviteEmail({
    to: email,
    accountName: account.name,
    token: invite.token,
    inviterName: user.email ?? 'Equipe MedScale',
  })

  return NextResponse.json({ invite, emailSent: emailResult.sent }, { status: 201 })
}
