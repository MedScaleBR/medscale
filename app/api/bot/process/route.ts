import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage } from '@/lib/whatsapp/send'
import { decryptToken } from '@/lib/crypto'
import { requireWorkspaceSession } from '@/lib/session/api'

// Permite que um membro da workspace responda manualmente uma conversa do
// bot (handoff humano) diretamente pelo painel.
export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const { conversation_id, message } = await req.json()
  if (!conversation_id || !message) {
    return NextResponse.json({ error: 'conversation_id e message são obrigatórios' }, { status: 400 })
  }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, patient_phone, status')
    .eq('id', conversation_id)
    .eq('account_id', session.accountId)
    .single()

  if (!conversation) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })

  const { data: botConfig } = await supabase
    .from('bot_config')
    .select('phone_number_id, meta_token')
    .eq('account_id', session.accountId)
    .maybeSingle()

  if (!botConfig?.phone_number_id || !botConfig?.meta_token) {
    return NextResponse.json({ error: 'WhatsApp não configurado. Acesse Configurações.' }, { status: 400 })
  }

  await sendWhatsAppMessage({
    to: conversation.patient_phone,
    message,
    phoneNumberId: botConfig.phone_number_id,
    token: decryptToken(botConfig.meta_token),
  })

  const { data: saved, error } = await supabase
    .from('messages')
    .insert({ conversation_id, role: 'assistant', content: message })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Resposta manual = intervenção humana — pausa o bot pra essa conversa até
  // a equipe reativar explicitamente pelo painel (senão ele volta a responder
  // sozinho na próxima mensagem do paciente e "atropela" quem está atendendo).
  await supabase.from('conversations').update({ status: 'handoff', bot_paused: true }).eq('id', conversation_id)

  return NextResponse.json(saved, { status: 201 })
}
