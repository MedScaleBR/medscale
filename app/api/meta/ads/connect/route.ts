import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getAdsAuthUrl, isAdsConfigured } from '@/lib/meta/ads-oauth'
import { requireWorkspaceSession, requireRole } from '@/lib/session/api'

// Cookie de nonce anti-CSRF consumido pelo callback (ver
// app/api/meta/ads/callback/route.ts). O `state` do OAuth ali é só o
// accountId (lib/meta/ads-oauth.ts) — sozinho não prova que foi esta sessão
// que iniciou o fluxo. O valor grava `accountId:nonce` para o callback poder
// confirmar que o cookie foi mintado para o mesmo accountId do state.
const NONCE_COOKIE = 'meta_ads_oauth_nonce'
const NONCE_COOKIE_PATH = '/api/meta/ads'
const NONCE_MAX_AGE_SECONDS = 10 * 60 // janela curta pra completar o consentimento no Facebook

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  // A conexão do Facebook Ads é única por account e afeta os anúncios de
  // todas as unidades — só owner/admin conecta (mesmo critério do Google).
  const roleCheck = requireRole(session, ['owner', 'admin'])
  if (roleCheck) return roleCheck

  if (!isAdsConfigured()) {
    return NextResponse.json({ error: 'Integração com o Facebook ainda não configurada.' }, { status: 503 })
  }

  const res = NextResponse.redirect(getAdsAuthUrl(session.accountId))

  res.cookies.set(NONCE_COOKIE, `${session.accountId}:${randomUUID()}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: NONCE_COOKIE_PATH,
    maxAge: NONCE_MAX_AGE_SECONDS,
  })

  return res
}
