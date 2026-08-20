import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { createClient } from '@/lib/supabase/server'

// A raiz do site é a landing page estática em medscale-site/ (não um
// componente React) — servida byte a byte, sem alterar o arquivo original.
// Usuário logado continua indo direto para o dashboard, como antes.
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  const html = await readFile(path.join(process.cwd(), 'medscale-site', 'index.html'), 'utf-8')
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
