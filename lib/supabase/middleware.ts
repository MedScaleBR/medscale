import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/types/database'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  // Rotas públicas de autenticação — usuário já logado é redirecionado para o dashboard.
  // /redefinir-senha fica de fora de propósito: exige sessão (criada pelo link de
  // recuperação) e não deve redirecionar o usuário autenticado para longe dela.
  const AUTH_ROUTES = ['/login', '/registrar', '/esqueci-senha']
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
  const isApiRoute = pathname.startsWith('/api')
  const isWebhook = pathname.startsWith('/api/whatsapp')
  // Troca o code por sessão — por definição o usuário AINDA não está
  // autenticado ao chegar aqui (login com Google, confirmação de e-mail e
  // link de redefinição de senha passam todos por esta rota). Bloqueá-la
  // pela mesma regra de "precisa estar logado" impedia a sessão de ser
  // criada e devolvia o usuário direto para /login.
  const isAuthCallback = pathname === '/auth/callback'

  // Webhooks da Meta e o callback de OAuth não usam autenticação de sessão
  if (isWebhook || isAuthCallback) return response

  if (!user && !isAuthRoute && !isApiRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return response
}
