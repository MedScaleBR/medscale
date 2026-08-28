import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession, listMyAccounts } from '@/lib/session/server'
import { SessionProvider } from '@/lib/session/session-context'
import { PostHogIdentify } from '@/components/analytics/PostHogIdentify'
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

  const [{ data: profile }, { data: account }, accounts] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).single(),
    supabase.from('accounts').select('plan').eq('id', session.accountId).single(),
    listMyAccounts(),
  ])

  return (
    <SessionProvider
      value={{
        userId: session.userId,
        accountId: session.accountId,
        accountName: session.accountName,
        accountPlan: account?.plan ?? 'essencial',
        accountModules: session.accountModules,
        workspaceId: session.workspaceId,
        role: session.role,
      }}
    >
      <PostHogIdentify email={user.email ?? ''} name={profile?.full_name ?? ''} />
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
    </SessionProvider>
  )
}
