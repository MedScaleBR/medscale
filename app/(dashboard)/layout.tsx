import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession, listMyAccounts } from '@/lib/session/server'
import { SessionProvider } from '@/lib/session/session-context'
import { PostHogIdentify } from '@/components/analytics/PostHogIdentify'
import { Sidebar } from '@/components/layout/Sidebar'
import { Topbar } from '@/components/layout/Topbar'
import { MobileTabBar } from '@/components/layout/MobileTabBar'
import { Toaster } from '@/components/ui/sonner'
import { ActiveConversationProvider } from '@/components/bot/active-conversation'
import { HandoffToastListener } from '@/components/bot/HandoffToastListener'
import { TranscriptionErrorToastListener } from '@/components/transcriptions/TranscriptionErrorToastListener'
import { FeedbackProvider } from '@/components/feedback/feedback-context'
import { FeedbackBalloon } from '@/components/feedback/FeedbackBalloon'
import { shouldShowFeedbackPrompt } from '@/lib/feedback/prompt'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const session = await resolveActiveSession()
  if (!session) redirect('/sem-acesso')

  const [{ data: profile }, { data: account }, { data: membership }, accounts] = await Promise.all([
    supabase.from('profiles').select('full_name, feedback_prompt_dismissed_at').eq('id', user.id).single(),
    supabase.from('accounts').select('plan').eq('id', session.accountId).single(),
    supabase
      .from('memberships')
      .select('handoff_push_enabled')
      .eq('account_id', session.accountId)
      .eq('user_id', session.userId)
      .maybeSingle(),
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
      <ActiveConversationProvider>
        <FeedbackProvider
          initialOpen={shouldShowFeedbackPrompt({ dismissedAt: profile?.feedback_prompt_dismissed_at ?? null })}
        >
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
              <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 pb-safe-14 md:p-6 md:pb-6">
                {children}
              </main>
            </div>
            <MobileTabBar session={session} accounts={accounts} />
          </div>
          <FeedbackBalloon />
        </FeedbackProvider>
        <HandoffToastListener handoffEnabled={membership?.handoff_push_enabled ?? false} />
        <TranscriptionErrorToastListener />
        <Toaster />
      </ActiveConversationProvider>
    </SessionProvider>
  )
}
