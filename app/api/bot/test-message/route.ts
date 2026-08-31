import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage } from '@/lib/whatsapp/send'
import { decryptToken } from '@/lib/crypto'
import { requireWorkspaceSession } from '@/lib/session/api'

export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const { to } = await req.json() // número de destino do teste
  if (!to) return NextResponse.json({ error: 'Informe o número de destino (to).' }, { status: 400 })

  const { data: config } = await supabase
    .from('bot_config')
    .select('welcome_message, phone_number_id, meta_token')
    .eq('account_id', session.accountId)
    .maybeSingle()

  if (!config?.phone_number_id || !config?.meta_token) {
    return NextResponse.json({ error: 'Número WhatsApp não configurado em Configurações.' }, { status: 400 })
  }

  const testMessage = config?.welcome_message ?? 'Olá! Esta é uma mensagem de teste do MedScale.'

  try {
    await sendWhatsAppMessage({
      to,
      message: testMessage,
      phoneNumberId: config.phone_number_id,
      token: decryptToken(config.meta_token),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }

  return NextResponse.json({ ok: true, sentTo: to })
}
