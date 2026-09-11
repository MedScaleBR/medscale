import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'
import { validateFeedbackMessage } from '@/lib/feedback/prompt'

// Sem requireModule: feedback não é módulo do plano, está aberto a qualquer
// membro ativo. O GET fica de fora de propósito — só o painel admin lê.
export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const body = await req.json()
  const validation = validateFeedbackMessage(body.message)
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 })

  const supabase = await createClient()
  const { error } = await supabase.from('feedback').insert({
    account_id: session.accountId,
    workspace_id: session.workspaceId,
    user_id: session.userId,
    message: validation.message,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Reinicia o relógio do balão junto do envio: quem acabou de escrever não
  // deve ser perguntado de novo na próxima visita.
  await supabase
    .from('profiles')
    .update({ feedback_prompt_dismissed_at: new Date().toISOString() })
    .eq('id', session.userId)

  return NextResponse.json({ ok: true }, { status: 201 })
}
