import { NextRequest, NextResponse } from 'next/server'
import { requireMedscaleAdmin } from '@/lib/admin/require-admin'
import { createAdminClient } from '@/lib/supabase/server'
import { invalidateBotConfigCache } from '@/lib/bot/config'

// Opções da Clara por account que só a equipe MedScale altera. bot_config não
// tem policy de staff MedScale, então a gravação usa o service role depois de
// conferir que quem chama é admin da MedScale.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireMedscaleAdmin()
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => null)
  if (typeof body?.ask_insurance_first !== 'boolean') {
    return NextResponse.json({ error: 'ask_insurance_first deve ser verdadeiro ou falso.' }, { status: 400 })
  }

  const { data, error } = await createAdminClient()
    .from('bot_config')
    .update({ ask_insurance_first: body.ask_insurance_first })
    .eq('account_id', id)
    .select('ask_insurance_first')
    .maybeSingle()

  if (error) {
    console.error(`[admin] clara account falhou account=${id}`)
    return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Esta account ainda não tem a Clara configurada.' }, { status: 404 })

  invalidateBotConfigCache(id)
  return NextResponse.json(data)
}
