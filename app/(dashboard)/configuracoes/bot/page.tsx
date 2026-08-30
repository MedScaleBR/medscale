import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { BotConfigForm } from '@/components/configuracoes/bot/BotConfigForm'

export default async function BotConfigPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const [{ data: botConfig }, { data: profile }, { data: handoffHours }, { data: workspace }, { data: membership }] =
    await Promise.all([
      supabase.from('bot_config').select('*').eq('workspace_id', session.workspaceId).maybeSingle(),
      supabase.from('profiles').select('phone').eq('id', session.userId).single(),
      supabase
        .from('handoff_hours')
        .select('*')
        .eq('workspace_id', session.workspaceId)
        .order('day_of_week')
        .order('start_time'),
      supabase.from('workspaces').select('meta_app_secret').eq('id', session.workspaceId).single(),
      supabase
        .from('memberships')
        .select('handoff_push_enabled')
        .eq('account_id', session.accountId)
        .eq('user_id', session.userId)
        .maybeSingle(),
    ])

  return (
    <div className="space-y-6">
      <div>
        <Link href="/configuracoes" className="mb-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-3.5 w-3.5" />
          Configurações
        </Link>
        <h1 className="text-xl font-medium text-gray-900">Configurar o bot WhatsApp</h1>
        <p className="text-sm text-gray-400">
          Conexão com a Meta, personalidade do bot e transferência para atendimento humano. O bot
          conversa e agenda 24/7 — só o atendimento humano tem horário próprio.
        </p>
      </div>

      <BotConfigForm
        initialConfig={botConfig}
        initialHandoffHours={handoffHours ?? []}
        doctorPhone={profile?.phone ?? ''}
        hasMetaAppSecret={Boolean(workspace?.meta_app_secret)}
        initialHandoffPushEnabled={membership?.handoff_push_enabled ?? false}
      />
    </div>
  )
}
