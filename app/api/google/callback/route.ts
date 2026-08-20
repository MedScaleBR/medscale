import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeCodeAndSave } from '@/lib/google/auth'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state') // workspaceId passado no OAuth state
  const errorMsg = searchParams.get('error')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin

  if (errorMsg || !code || !state) {
    return NextResponse.redirect(`${appUrl}/configuracoes?google=error`)
  }

  // O `state` sozinho não é confiável como identidade — qualquer um pode
  // reescrevê-lo na URL de callback. Exigimos que o usuário esteja logado E
  // tenha acesso a essa workspace — a policy de RLS de `workspaces` já
  // resolve isso: se a linha vier vazia, ele não tem acesso.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(`${appUrl}/login`)
  }

  const { data: workspace } = await supabase.from('workspaces').select('id').eq('id', state).single()
  if (!workspace) {
    return NextResponse.redirect(`${appUrl}/configuracoes?google=error`)
  }

  try {
    await exchangeCodeAndSave(code, state, user.id)
    return NextResponse.redirect(`${appUrl}/configuracoes?google=connected`)
  } catch (err) {
    console.error('Google OAuth callback error:', err)
    return NextResponse.redirect(`${appUrl}/configuracoes?google=error`)
  }
}
