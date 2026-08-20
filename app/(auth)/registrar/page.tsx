import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GoogleLoginButton } from '@/components/auth/GoogleLoginButton'
import { AuthForm } from '@/components/auth/AuthForm'
import { AuthLayout } from '@/components/auth/AuthLayout'

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; email?: string }>
}) {
  const { redirect: redirectTo, email } = await searchParams
  const destination = redirectTo && redirectTo.startsWith('/') ? redirectTo : '/dashboard'
  const query = new URLSearchParams()
  if (redirectTo) query.set('redirect', redirectTo)
  if (email) query.set('email', email)
  const loginHref = query.toString() ? `/login?${query.toString()}` : '/login'
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) redirect(destination)

  return (
    <AuthLayout
      title="Criar conta no MedScale"
      subtitle="Comece a gerenciar sua clínica em poucos minutos"
      footer={
        <>
          Já tem uma conta?{' '}
          <Link href={loginHref} className="font-medium text-[var(--cyan-dark)] hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        <GoogleLoginButton redirectTo={destination} />

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-200" />
          <span className="text-xs text-gray-400">ou cadastre-se com e-mail</span>
          <div className="h-px flex-1 bg-gray-200" />
        </div>

        <AuthForm mode="signup" redirectTo={destination} initialEmail={email} />

        <p className="text-center text-xs text-gray-400">
          Ao criar sua conta, você concorda com o uso responsável dos dados dos seus pacientes e
          com a finalidade exclusivamente administrativa do assistente de agendamento.
        </p>
      </div>
    </AuthLayout>
  )
}
