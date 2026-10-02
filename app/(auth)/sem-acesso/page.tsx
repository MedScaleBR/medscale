import { redirect } from 'next/navigation'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { LogoutButton } from '@/components/auth/LogoutButton'
import { resolveAccountWithoutWorkspace } from '@/lib/session/server'

export default async function SemAcessoPage() {
  // Account sem nenhuma unidade ainda não é "sem acesso" — é primeiro acesso.
  if (await resolveAccountWithoutWorkspace()) redirect('/primeira-unidade')

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
