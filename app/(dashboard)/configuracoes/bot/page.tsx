import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { BotConfigForm } from '@/components/configuracoes/bot/BotConfigForm'

export default async function BotConfigPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  // Configuração da Maria é exclusiva de owner/admin (a API espelha isso —
  // ver /api/bot/config e /api/bot/onboarding/*).
  if (session.role !== 'owner' && session.role !== 'admin') redirect('/configuracoes')

  const supabase = await createClient()
  const [{ data: botConfig }, { data: profile }, { data: handoffHours }, { data: workspaces }, { data: membership }] =
    await Promise.all([
      supabase.from('bot_config').select('*').eq('account_id', session.accountId).maybeSingle(),
      supabase.from('profiles').select('phone').eq('id', session.userId).single(),
      supabase
        .from('handoff_hours')
        .select('*')
        .order('day_of_week')
        .order('start_time'),
      supabase
        .from('workspaces')
        .select(
          'id, name, address, business_hours, directions_parking, contact_info, consultation_price_from, handoff_number'
        )
        .eq('account_id', session.accountId)
        .eq('is_active', true)
        .order('display_order'),
      supabase
        .from('memberships')
        .select('handoff_push_enabled')
        .eq('account_id', session.accountId)
        .eq('user_id', session.userId)
        .maybeSingle(),
    ])

  const workspaceList = workspaces ?? []
  const workspaceIds = new Set(workspaceList.map((w) => w.id))
  type HandoffHour = NonNullable<typeof handoffHours>[number]
  const handoffHoursByWorkspace: Record<string, HandoffHour[]> = {}
  for (const h of handoffHours ?? []) {
    if (!workspaceIds.has(h.workspace_id)) continue
    ;(handoffHoursByWorkspace[h.workspace_id] ??= []).push(h)
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/configuracoes" className="mb-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-3.5 w-3.5" />
          Configurações
        </Link>
        <h1 className="text-xl font-medium text-gray-900">Configurar a Maria (WhatsApp)</h1>
        <p className="text-sm text-gray-400">
          Conexão com a Meta, personalidade e regras da Maria (uma configuração para toda a conta) e
          os dados que variam por unidade. A Maria conversa e agenda 24/7 — só o atendimento humano
          tem horário próprio.
        </p>
      </div>

      <BotConfigForm
        initialConfig={botConfig}
        workspaces={workspaceList}
        handoffHoursByWorkspace={handoffHoursByWorkspace}
        activeWorkspaceId={session.workspaceId}
        doctorPhone={profile?.phone ?? ''}
        hasMetaAppSecret={Boolean(botConfig?.meta_app_secret)}
        initialHandoffPushEnabled={membership?.handoff_push_enabled ?? false}
      />
    </div>
  )
}
