import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeCodeAndSave } from '@/lib/google/auth'
import { trackGoogleCalendarConnected } from '@/lib/analytics/posthog-server'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state') // accountId passado no OAuth state
  const errorMsg = searchParams.get('error')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin

  if (errorMsg || !code || !state) {
    return NextResponse.redirect(`${appUrl}/configuracoes?google=error`)
  }

  // O `state` sozinho não é confiável como identidade — qualquer um pode
  // reescrevê-lo na URL de callback. Exigimos que o usuário esteja logado E
  // seja membro ativo dessa account.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(`${appUrl}/login`)
  }

  const { data: membership } = await supabase
    .from('memberships')
    .select('account_id')
    .eq('account_id', state)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership) {
    return NextResponse.redirect(`${appUrl}/configuracoes?google=error`)
  }

  try {
    await exchangeCodeAndSave(code, state, user.id)
    await trackGoogleCalendarConnected(user.id, { account_id: state })
    return NextResponse.redirect(`${appUrl}/configuracoes?google=connected`)
  } catch (err) {
    console.error('Google OAuth callback error:', err)
    return NextResponse.redirect(`${appUrl}/configuracoes?google=error`)
  }
}
