import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession, listMyAccounts } from '@/lib/session/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { Topbar } from '@/components/layout/Topbar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const session = await resolveActiveSession()
  if (!session) redirect('/sem-acesso')

  const [{ data: profile }, accounts] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).single(),
    listMyAccounts(),
  ])

  return (
    <div className="flex min-h-screen bg-[var(--navy-06)]">
      <Sidebar session={session} accounts={accounts} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          userName={profile?.full_name ?? user.email ?? 'Usuário'}
          userEmail={user.email ?? ''}
          avatarUrl={user.user_metadata?.avatar_url}
          session={session}
          accounts={accounts}
        />
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
