import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { invalidateBotConfigCache } from '@/lib/bot/config'
import { requireWorkspaceSession } from '@/lib/session/api'
import type { Database } from '@/types/database'

type BotConfigUpdate = Database['public']['Tables']['bot_config']['Update']

// Campos da personalidade/regras da Maria — uma configuração por account.
// is_active, onboarding_step, number_source, webhook_verify_token e a conexão
// WhatsApp são controlados pelo fluxo de onboarding. Campos que variam por
// unidade (endereço, horário, estacionamento, contato, preço, número de
// handoff) ficam em workspaces e são salvos via /api/workspaces/[id].
// bot_name NÃO está aqui de propósito: o nome é fixo ("Maria").
const EDITABLE_FIELDS = [
  'specialty',
  'procedures',
  'insurance_plans',
  'accepts_private',
  'payment_methods',
  'pricing_info',
  'exam_preparation',
  'policies',
  'tone_of_voice',
  'handoff_instructions',
  'forbidden_actions',
  'faq',
  'handoff_message',
  'welcome_message',
  'out_of_hours_message',
] as const

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const { data, error } = await supabase.from('bot_config').select('*').eq('account_id', session.accountId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const body = await req.json()

  const update: BotConfigUpdate = {}
  for (const field of EDITABLE_FIELDS) {
    if (field in body) update[field] = body[field]
  }

  const { data, error } = await supabase
    .from('bot_config')
    .upsert({ ...update, account_id: session.accountId }, { onConflict: 'account_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Invalida o cache para a Maria usar a config nova já na próxima mensagem
  invalidateBotConfigCache(session.accountId)

  return NextResponse.json(data)
}
