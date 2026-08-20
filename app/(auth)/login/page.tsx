import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GoogleLoginButton } from '@/components/auth/GoogleLoginButton'
import { AuthForm } from '@/components/auth/AuthForm'
import { AuthLayout } from '@/components/auth/AuthLayout'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirect?: string }>
}) {
  const { error, redirect: redirectTo } = await searchParams
  const destination = redirectTo && redirectTo.startsWith('/') ? redirectTo : '/dashboard'
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) redirect(destination)

  return (
    <AuthLayout
      title="Entrar no MedScale"
      subtitle="Acesse o painel de gestão da sua clínica"
      footer={
        <>
          Ainda não tem uma conta?{' '}
          <Link
            href={redirectTo ? `/registrar?redirect=${encodeURIComponent(redirectTo)}` : '/registrar'}
            className="font-medium text-[var(--cyan-dark)] hover:underline"
          >
            Criar conta
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        {error === 'auth_callback_failed' && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
            Não foi possível concluir o login. Tente novamente — se persistir, tente entrar com
            e-mail e senha.
          </div>
        )}

        <GoogleLoginButton redirectTo={destination} />

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-200" />
          <span className="text-xs text-gray-400">ou entre com e-mail</span>
          <div className="h-px flex-1 bg-gray-200" />
        </div>

        <AuthForm mode="login" redirectTo={destination} />
      </div>
    </AuthLayout>
  )
}
