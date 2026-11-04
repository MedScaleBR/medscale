import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'
import { INSURANCE_CARD_BUCKET, INSURANCE_CARD_SIGNED_URL_TTL } from '@/lib/bot/insurance-card'

// Abre a foto da carteirinha: redireciona para uma signed URL curta (5 min).
// A leitura do registro usa o client da sessão, então a RLS de
// conversation_attachments (mesma visibilidade da conversa) decide quem pode.
// O storage_path nunca sai do servidor; o bucket não tem policy de usuário,
// por isso a URL é assinada com o service role.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error

  const supabase = await createClient()
  const { data: attachment, error } = await supabase
    .from('conversation_attachments')
    .select('storage_path')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error || !attachment) return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 404 })

  const { data: signed, error: signError } = await createAdminClient()
    .storage.from(INSURANCE_CARD_BUCKET)
    .createSignedUrl(attachment.storage_path, INSURANCE_CARD_SIGNED_URL_TTL)
  if (signError || !signed?.signedUrl) {
    console.error(`[insurance-card] signed_url_failed attachment=${id}`)
    return NextResponse.json({ error: 'Não foi possível abrir o arquivo.' }, { status: 500 })
  }

  const res = NextResponse.redirect(signed.signedUrl, 302)
  res.headers.set('Cache-Control', 'private, no-store')
  return res
}
