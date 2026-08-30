import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  // `sw.js` fica de fora: o navegador revalida o service worker sem garantia
  // de cookie de sessão e, se o middleware responder com o redirect para
  // /login, o script do SW volta como HTML e o navegador invalida o registro
  // — o push para de funcionar silenciosamente.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
