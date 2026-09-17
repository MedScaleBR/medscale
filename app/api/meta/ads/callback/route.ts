import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeAdsCodeAndSave } from '@/lib/meta/ads-oauth'

// Mesmo cookie gravado por app/api/meta/ads/connect/route.ts.
const NONCE_COOKIE = 'meta_ads_oauth_nonce'
const NONCE_COOKIE_PATH = '/api/meta/ads'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state') // accountId passado no OAuth state
  const errorMsg = searchParams.get('error')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin

  // Toda resposta passa por aqui: o cookie de nonce é de uso único e precisa
  // sumir em QUALQUER desfecho (sucesso, erro de membership, erro da troca de
  // código) — senão uma URL de callback capturada poderia ser reaproveitada.
  const redirectTo = (path: string) => {
    const res = NextResponse.redirect(`${appUrl}${path}`)
    res.cookies.delete({ name: NONCE_COOKIE, path: NONCE_COOKIE_PATH })
    return res
  }

  if (errorMsg || !code || !state) {
    return redirectTo('/configuracoes?meta_ads=error')
  }

  // O `state` sozinho não é confiável como identidade — qualquer um pode
  // reescrevê-lo na URL de callback. Exigimos que o usuário esteja logado E
  // seja membro ativo dessa account.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return redirectTo('/login')
  }

  const { data: membership } = await supabase
    .from('memberships')
    .select('account_id')
    .eq('account_id', state)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership) {
    return redirectTo('/configuracoes?meta_ads=error')
  }

  // Nonce anti-CSRF (login-CSRF, review da Task 7): a checagem de
  // sessão/membership acima NÃO fecha o buraco sozinha — um atacante pode
  // consentir no Facebook dele mesmo, pegar um `code` válido, e montar este
  // link com o accountId da vítima; a sessão da vítima passa na checagem
  // acima igual. O cookie de uso único gravado por /connect, amarrado ao
  // accountId, prova que foi esta sessão/navegador que iniciou o fluxo.
  const nonceCookie = req.cookies.get(NONCE_COOKIE)?.value
  const [nonceAccountId, nonce] = nonceCookie?.split(':') ?? []
  if (!nonce || nonceAccountId !== state) {
    return redirectTo('/configuracoes?meta_ads=error')
  }

  try {
    await exchangeAdsCodeAndSave(code, state, user.id)
    return redirectTo('/configuracoes?meta_ads=connected')
  } catch (err) {
    console.error('Facebook Ads OAuth callback error:', err)
    return redirectTo('/configuracoes?meta_ads=error')
  }
}
