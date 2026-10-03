import { NextRequest, NextResponse } from 'next/server'
import { requireMedscaleAdmin } from '@/lib/admin/require-admin'
import type { FeedbackStatus } from '@/types/database'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ feedbackId: string }> }) {
  const { feedbackId } = await params
  const result = await requireMedscaleAdmin()
  if ('error' in result) return result.error
  const { supabase } = result

  const body = await req.json().catch(() => null)
  const status = body?.status as FeedbackStatus
  if (status !== 'new' && status !== 'reviewed') {
    return NextResponse.json({ error: "status deve ser 'new' ou 'reviewed'" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('feedback')
    .update({ status })
    .eq('id', feedbackId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Não foi possível atualizar o feedback' }, { status: 500 })
  return NextResponse.json(data)
}
