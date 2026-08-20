import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'
import { AuthLayout } from '@/components/auth/AuthLayout'

// Chegar aqui exige uma sessão válida, criada pelo link de recuperação de senha
// (trocado por sessão em /auth/callback). O middleware já bloqueia o acesso sem sessão.
export default function ResetPasswordPage() {
  return (
    <AuthLayout title="Definir nova senha" subtitle="Escolha uma nova senha para sua conta">
      <ResetPasswordForm />
    </AuthLayout>
  )
}
