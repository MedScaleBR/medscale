import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'
import { sendInviteEmail } from '@/lib/email/mailer'
import type { MembershipRole } from '@/types/database'

// Convite/gestão de equipe é self-service, mas exclusivo do owner — admin e
// member não convidam ninguém nem enxergam esta lista. Só é possível
// convidar como 'admin' ou 'member' — virar 'owner' continua exigindo o
// painel interno da MedScale (evita transferência de titularidade por acidente).
const INVITABLE_ROLES: MembershipRole[] = ['admin', 'member']

function requireOwner(session: { role: string }) {
  if (session.role !== 'owner') {
    return NextResponse.json({ error: 'Restrito ao owner da account' }, { status: 403 })
  }
  return null
}

export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const ownerCheck = requireOwner(session)
  if (ownerCheck) return ownerCheck

  const body = await req.json()
  const email = (body.email as string | undefined)?.trim().toLowerCase()
  const role = body.role as MembershipRole | undefined

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'E-mail válido é obrigatório' }, { status: 400 })
  }
  if (!role || !INVITABLE_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Papel deve ser admin ou member' }, { status: 400 })
  }

  // Client admin: convite ainda não tem membership, então não há policy de
  // RLS que cubra checar se o e-mail já é membro (profiles só é legível pelo
  // próprio dono da linha) — mesmo motivo do fluxo equivalente em
  // app/api/admin/accounts/[id]/memberships/route.ts.
  const admin = createAdminClient()

  const [{ data: account }, { data: inviterProfile }] = await Promise.all([
    admin.from('accounts').select('name').eq('id', session.accountId).single(),
    admin.from('profiles').select('full_name, email').eq('id', session.userId).single(),
  ])
  if (!account) return NextResponse.json({ error: 'Account não encontrada' }, { status: 404 })

  const { data: existingProfile } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()

  if (existingProfile) {
    const { data: existingMembership } = await admin
      .from('memberships')
      .select('id')
      .eq('account_id', session.accountId)
      .eq('user_id', existingProfile.id)
      .maybeSingle()
    if (existingMembership) {
      return NextResponse.json({ error: 'Este e-mail já é membro desta account.' }, { status: 400 })
    }
  }

  const { data: existingInvite } = await admin
    .from('invites')
    .select('id')
    .eq('account_id', session.accountId)
    .eq('email', email)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (existingInvite) {
    return NextResponse.json({ error: 'Já existe um convite pendente para este e-mail.' }, { status: 400 })
  }

  const { data: invite, error: inviteError } = await admin
    .from('invites')
    .insert({ account_id: session.accountId, email, role, invited_by: session.userId })
    .select()
    .single()

  if (inviteError) return NextResponse.json({ error: inviteError.message }, { status: 500 })

  const emailResult = await sendInviteEmail({
    to: email,
    accountName: account.name,
    token: invite.token,
    inviterName: inviterProfile?.full_name || inviterProfile?.email || 'Equipe MedScale',
    role,
  })

  return NextResponse.json({ invite, emailSent: emailResult.sent }, { status: 201 })
}
