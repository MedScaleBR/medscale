import { redirect } from 'next/navigation'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { LogoutButton } from '@/components/auth/LogoutButton'
import { FirstWorkspaceForm } from '@/components/auth/FirstWorkspaceForm'
import { resolveActiveSession, resolveAccountWithoutWorkspace } from '@/lib/session/server'

// Primeiro acesso de uma account que ainda não tem nenhuma unidade de
// atendimento — o cadastro da conta não cria uma automaticamente.
export default async function PrimeiraUnidadePage() {
  if (await resolveActiveSession()) redirect('/dashboard')

  const setup = await resolveAccountWithoutWorkspace()
  if (!setup) redirect('/sem-acesso')

  if (setup.role === 'member') {
    return (
      <AuthLayout title="Nenhuma unidade cadastrada" subtitle={setup.accountName}>
        <div className="space-y-4 text-sm text-gray-600">
          <p>
            Esta conta ainda não tem nenhuma unidade de atendimento. Peça a um administrador da conta para cadastrar a
            primeira unidade.
          </p>
          <LogoutButton />
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Cadastre sua primeira unidade"
      subtitle={`Onde ${setup.accountName} atende — você pode adicionar outras depois em Meus locais`}
      footer={<LogoutButton />}
    >
      <FirstWorkspaceForm />
    </AuthLayout>
  )
}
