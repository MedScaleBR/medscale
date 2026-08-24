import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule } from '@/lib/session/api'
import type { SOAPRecord } from '@/lib/transcriptions/types'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'transcriptions')
  if (moduleCheck) return moduleCheck

  const { medical_record_final }: { medical_record_final: SOAPRecord } = await req.json()
  if (!medical_record_final) {
    return NextResponse.json({ error: 'medical_record_final é obrigatório' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: transcription } = await supabase
    .from('transcriptions')
    .select('id, appointment_id, status')
    .eq('id', id)
    .eq('workspace_id', session.workspaceId)
    .single()

  if (!transcription) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  if (transcription.status === 'signed') {
    return NextResponse.json({ error: 'Já assinado' }, { status: 409 })
  }

  const { error } = await supabase
    .from('transcriptions')
    .update({
      medical_record_final,
      status: 'signed',
      signed_at: new Date().toISOString(),
      signed_by: session.userId,
    })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (transcription.appointment_id) {
    await supabase.from('appointments').update({ status: 'realizado' }).eq('id', transcription.appointment_id)
  }

  return NextResponse.json({ ok: true })
}
