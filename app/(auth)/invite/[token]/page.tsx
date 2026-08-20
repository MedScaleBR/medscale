import Link from 'next/link'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { AcceptInviteButton } from '@/components/auth/AcceptInviteButton'

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Membro' }

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const admin = createAdminClient()
  const { data: invite } = await admin
    .from('invites')
    .select('*, accounts:account_id(name)')
    .eq('token', token)
    .single()

  if (!invite) {
    return (
      <AuthLayout title="Convite não encontrado" subtitle="Este link de convite não é válido">
        <p className="text-sm text-gray-600">
          Verifique se copiou o link completo, ou peça um novo convite a quem administra sua
          clínica.
        </p>
      </AuthLayout>
    )
  }

  const accountName = (invite.accounts as unknown as { name: string } | null)?.name ?? 'MedScale'

  let inviterEmail: string | undefined
  if (invite.invited_by) {
    const { data: inviter } = await admin.from('profiles').select('email').eq('id', invite.invited_by).single()
    inviterEmail = inviter?.email ?? undefined
  }

  if (invite.accepted_at) {
    return (
      <AuthLayout title="Convite já aceito" subtitle={accountName}>
        <div className="space-y-4 text-sm text-gray-600">
          <p>Este convite já foi aceito anteriormente.</p>
          <Link
            href="/login"
            className="block w-full rounded-lg bg-[var(--navy-dark)] py-2.5 text-center text-sm font-medium text-white hover:bg-[var(--navy)]"
          >
            Ir para o login
          </Link>
        </div>
      </AuthLayout>
    )
  }

  if (new Date(invite.expires_at) < new Date()) {
    return (
      <AuthLayout title="Convite expirado" subtitle={accountName}>
        <p className="text-sm text-gray-600">
          Este convite expirou. Peça para {inviterEmail ?? 'quem administra sua clínica'} enviar um
          novo.
        </p>
      </AuthLayout>
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const redirectPath = `/invite/${token}`

  return (
    <AuthLayout
      title={`Convite para ${accountName}`}
      subtitle={`${inviterEmail ?? 'Alguém'} te convidou como ${ROLE_LABEL[invite.role] ?? invite.role}`}
    >
      {user ? (
        user.email?.toLowerCase() === invite.email.toLowerCase() ? (
          <AcceptInviteButton token={token} />
        ) : (
          <p className="text-sm text-gray-600">
            Este convite foi enviado para <strong>{invite.email}</strong>, mas você está logado como{' '}
            <strong>{user.email}</strong>. Saia e entre novamente com o e-mail correto.
          </p>
        )
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Entre ou crie uma conta com o e-mail <strong>{invite.email}</strong> para aceitar.
          </p>
          <Link
            href={`/login?redirect=${encodeURIComponent(redirectPath)}`}
            className="block w-full rounded-lg bg-[var(--navy-dark)] py-2.5 text-center text-sm font-medium text-white hover:bg-[var(--navy)]"
          >
            Entrar
          </Link>
          <Link
            href={`/registrar?redirect=${encodeURIComponent(redirectPath)}`}
            className="block w-full rounded-lg border border-gray-200 py-2.5 text-center text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Criar conta
          </Link>
        </div>
      )}
    </AuthLayout>
  )
}
