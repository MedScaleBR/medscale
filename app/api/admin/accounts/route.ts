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
  const { name, plan, modules, max_workspaces, max_members, billing_email } = body
  const owner_email = (body.owner_email as string | undefined)?.trim() || null
  const assignDirectly = body.assignDirectly === true

  if (!name) {
    return NextResponse.json({ error: 'name é obrigatório' }, { status: 400 })
  }

  // A partir daqui usamos o client admin (service role): esta rota já validou
  // is_medscale_admin acima, e algumas dessas operações (ex: criar convite
  // antes de existir qualquer membership) não teriam uma policy de RLS que
  // as permitisse via o client comum.
  const admin = createAdminClient()

  // Atribuição direta: pula convite/e-mail por completo — só funciona se a
  // pessoa já tiver logado alguma vez na MedScale (existe um profiles.id pra
  // ela). Validado ANTES de criar account/workspace, pra não deixar uma
  // account órfã (sem owner nenhum) se o e-mail não bater com ninguém.
  let ownerProfileId: string | null = null
  if (assignDirectly && owner_email) {
    const { data: ownerProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('email', owner_email)
      .maybeSingle()

    if (!ownerProfile) {
      return NextResponse.json(
        {
          error:
            'Nenhum usuário cadastrado com este e-mail. A pessoa precisa criar uma conta na MedScale (login normal) pelo menos uma vez antes de poder ser atribuída diretamente — sem isso, use o convite por e-mail.',
        },
        { status: 404 }
      )
    }
    ownerProfileId = ownerProfile.id
  }

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

  if (assignDirectly && ownerProfileId) {
    const { data: membership, error: membershipError } = await admin
      .from('memberships')
      .insert({
        account_id: account.id,
        user_id: ownerProfileId,
        role: 'owner',
        status: 'active',
        invited_by: user.id,
        accepted_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 500 })

    return NextResponse.json({ account, membership, assignedDirectly: true }, { status: 201 })
  }

  // Sem owner_email: account criada sozinha, sem convite nem membership
  // nenhuma — vincula alguém depois em /admin/accounts/[id] (convite por
  // e-mail ou atribuição direta, mesmas opções de sempre).
  if (!owner_email) {
    return NextResponse.json({ account, noOwner: true }, { status: 201 })
  }

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
