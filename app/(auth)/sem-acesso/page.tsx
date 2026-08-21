import { AuthLayout } from '@/components/auth/AuthLayout'
import { LogoutButton } from '@/components/auth/LogoutButton'

export default function SemAcessoPage() {
  return (
    <AuthLayout title="Sem acesso a nenhuma clínica" subtitle="Sua conta ainda não está vinculada a nenhuma organização">
      <div className="space-y-4 text-sm text-gray-600">
        <p>
          Você está logado, mas ainda não tem acesso a nenhuma conta MedScale. Aguarde o e-mail de convite chegar na
          sua caixa de entrada.
        </p>
        <LogoutButton />
      </div>
    </AuthLayout>
  )
}
