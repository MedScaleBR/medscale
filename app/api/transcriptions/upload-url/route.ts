import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule } from '@/lib/session/api'

// Emite uma signed upload URL para o bucket "recordings" — o browser sobe o
// áudio direto pro Supabase Storage a partir daqui (uploadToSignedUrl),
// sem passar pelo corpo da requisição desta rota. Existe porque funções
// serverless da Vercel têm limite de corpo (~4.5MB) e uma consulta longa
// gravada em audio/webm facilmente passa disso — ver TRANSCRICOES_COMO_FUNCIONA.md.
//
// createSignedUploadUrl roda no client autenticado da sessão (respeitando a
// RLS de storage.objects, não o admin) — só emite a URL se o usuário
// realmente for membro do workspace dono do path, mesma verificação que
// valeria para um upload direto.
function extensionFor(contentType: string) {
  if (contentType.includes('ogg')) return 'ogg'
  if (contentType.includes('mp4')) return 'mp4'
  if (contentType.includes('wav')) return 'wav'
  return 'webm'
}

export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'transcriptions')
  if (moduleCheck) return moduleCheck

  const body = await req.json().catch(() => ({}))
  const appointmentId = (body.appointment_id as string | null) || null
  const contentType = (body.content_type as string) || 'audio/webm'

  const ext = extensionFor(contentType)
  const audioPath = `${session.workspaceId}/${appointmentId ?? 'no-appointment'}/${Date.now()}.${ext}`

  const supabase = await createClient()
  const { data, error } = await supabase.storage.from('recordings').createSignedUploadUrl(audioPath)

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Falha ao gerar URL de upload' }, { status: 500 })
  }

  return NextResponse.json({ path: data.path, token: data.token, signedUrl: data.signedUrl })
}
