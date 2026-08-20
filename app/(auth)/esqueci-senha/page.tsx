import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'
import { AuthLayout } from '@/components/auth/AuthLayout'

export default async function ForgotPasswordPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  return (
    <AuthLayout
      title="Esqueceu a senha?"
      subtitle="Informe seu e-mail e enviamos um link para redefinir"
      footer={
        <Link href="/login" className="font-medium text-[var(--cyan-dark)] hover:underline">
          ← Voltar para o login
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthLayout>
  )
}
