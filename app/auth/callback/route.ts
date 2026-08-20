import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    try {
      const supabase = await createClient()
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error) {
        return NextResponse.redirect(`${origin}${next}`)
      }
      console.error('exchangeCodeForSession failed:', error.message)
    } catch (err) {
      // Nunca deixar uma exceção não tratada travar o usuário nesta página —
      // sem isso, um erro aqui (ex: env var do Supabase ausente/errada) faz o
      // Next.js renderizar uma página de erro em vez de redirecionar, e o
      // usuário fica preso em /auth/callback?code=... sem entender o motivo.
      console.error('Erro inesperado em /auth/callback:', err)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
