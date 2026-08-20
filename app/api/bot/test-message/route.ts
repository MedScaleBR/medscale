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

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('phone_number_id, meta_token, name')
    .eq('id', session.workspaceId)
    .single()

  if (!workspace?.phone_number_id || !workspace?.meta_token) {
    return NextResponse.json({ error: 'Número WhatsApp não configurado em Configurações.' }, { status: 400 })
  }

  const { data: config } = await supabase
    .from('bot_config')
    .select('welcome_message')
    .eq('workspace_id', session.workspaceId)
    .maybeSingle()

  const testMessage = config?.welcome_message ?? `Olá! Sou o assistente de ${workspace.name}. Esta é uma mensagem de teste do MedScale.`

  try {
    await sendWhatsAppMessage({
      to,
      message: testMessage,
      phoneNumberId: workspace.phone_number_id,
      token: decryptToken(workspace.meta_token),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }

  return NextResponse.json({ ok: true, sentTo: to })
}
