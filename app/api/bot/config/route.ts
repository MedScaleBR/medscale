import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { invalidateBotConfigCache } from '@/lib/bot/config'
import { requireWorkspaceSession } from '@/lib/session/api'
import type { Database } from '@/types/database'

type BotConfigUpdate = Database['public']['Tables']['bot_config']['Update']

// Campos editáveis pelo médico via este endpoint — is_active, onboarding_step,
// number_source e webhook_verify_token são controlados pelo fluxo de onboarding.
const EDITABLE_FIELDS = [
  'bot_name',
  'specialty',
  'procedures',
  'insurance_plans',
  'accepts_private',
  'consultation_price_from',
  'business_hours',
  'address',
  'directions_parking',
  'contact_info',
  'payment_methods',
  'pricing_info',
  'exam_preparation',
  'policies',
  'tone_of_voice',
  'handoff_instructions',
  'forbidden_actions',
  'faq',
  'handoff_number',
  'handoff_message',
  'welcome_message',
  'out_of_hours_message',
] as const

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const { data, error } = await supabase.from('bot_config').select('*').eq('workspace_id', session.workspaceId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const body = await req.json()

  if (body.handoff_number && !/^\+\d{10,15}$/.test(body.handoff_number)) {
    return NextResponse.json(
      { error: 'Número de handoff inválido. Use o formato internacional: +5511999999999' },
      { status: 400 }
    )
  }

  const update: BotConfigUpdate = {}
  for (const field of EDITABLE_FIELDS) {
    if (field in body) update[field] = body[field]
  }

  const { data, error } = await supabase
    .from('bot_config')
    .upsert({ ...update, workspace_id: session.workspaceId, account_id: session.accountId }, { onConflict: 'workspace_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Invalida o cache para o bot usar a config nova já na próxima mensagem
  invalidateBotConfigCache(session.workspaceId)

  return NextResponse.json(data)
}
