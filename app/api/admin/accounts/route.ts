import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { sendInviteEmail } from '@/lib/email/mailer'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: isAdmin } = await supabase.rpc('is_medscale_admin')
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { name, plan, modules, max_workspaces, max_members, billing_email, owner_email } = body

  if (!name || !owner_email) {
    return NextResponse.json({ error: 'name e owner_email são obrigatórios' }, { status: 400 })
  }

  // A partir daqui usamos o client admin (service role): esta rota já validou
  // is_medscale_admin acima, e algumas dessas operações (ex: criar convite
  // antes de existir qualquer membership) não teriam uma policy de RLS que
  // as permitisse via o client comum.
  const admin = createAdminClient()

  const { data: account, error: accountError } = await admin
    .from('accounts')
    .insert({
      name,
      slug: slugify(name),
      plan: plan ?? 'essencial',
      modules: modules ?? ['dashboard', 'agenda', 'patients', 'settings'],
      max_workspaces: max_workspaces ?? 1,
      max_members: max_members ?? 3,
      billing_email: billing_email ?? null,
      created_by: user.id,
    })
    .select()
    .single()

  if (accountError) return NextResponse.json({ error: accountError.message }, { status: 500 })

  const { error: workspaceError } = await admin.from('workspaces').insert({
    account_id: account.id,
    name,
    slug: slugify(name),
    is_default: true,
  })

  if (workspaceError) return NextResponse.json({ error: workspaceError.message }, { status: 500 })

  const { data: invite, error: inviteError } = await admin
    .from('invites')
    .insert({ account_id: account.id, email: owner_email, role: 'owner', invited_by: user.id })
    .select()
    .single()

  if (inviteError) return NextResponse.json({ error: inviteError.message }, { status: 500 })

  const emailResult = await sendInviteEmail({
    to: owner_email,
    accountName: name,
    token: invite.token,
    inviterName: user.email ?? 'Equipe MedScale',
  })

  return NextResponse.json({ account, invite, emailSent: emailResult.sent }, { status: 201 })
}
