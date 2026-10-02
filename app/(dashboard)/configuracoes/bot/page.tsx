import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { BotConfigForm } from '@/components/configuracoes/bot/BotConfigForm'

export default async function BotConfigPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  // Configuração da Clara é exclusiva de owner/admin (a API espelha isso —
  // ver /api/bot/config e /api/bot/onboarding/*).
  if (session.role !== 'owner' && session.role !== 'admin') redirect('/configuracoes')

  const supabase = await createClient()
  const [{ data: botConfig }, { data: profile }, { data: workspaces }, { data: insurers }, { data: membership }] =
    await Promise.all([
      supabase.from('bot_config').select('*').eq('account_id', session.accountId).maybeSingle(),
      supabase.from('profiles').select('phone').eq('id', session.userId).single(),
      supabase.from('workspaces').select('id').eq('account_id', session.accountId).eq('is_active', true),
      supabase
        .from('health_insurers')
        .select('name')
        .eq('account_id', session.accountId)
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('memberships')
        .select('handoff_push_enabled')
        .eq('account_id', session.accountId)
        .eq('user_id', session.userId)
        .maybeSingle(),
    ])

  const workspaceIds = (workspaces ?? []).map((w) => w.id)
  const { data: catalog } = await supabase
    .from('procedure_catalog')
    .select('name')
    .in('workspace_id', workspaceIds)
    .eq('is_active', true)
    .order('name')

  return (
    <div className="space-y-6">
      <div>
        <Link href="/configuracoes" className="mb-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-3.5 w-3.5" />
          Configurações
        </Link>
        <h1 className="text-xl font-medium text-gray-900">Configurar a Clara (WhatsApp)</h1>
        <p className="text-sm text-gray-400">
          Conexão com a Meta e o jeito da Clara atender: mensagens, tom de voz, políticas, FAQ e
          transferência para humano. Serviços, convênios e unidades ficam nas páginas de cada um.
        </p>
      </div>

      <BotConfigForm
        initialConfig={botConfig}
        clinicData={{
          serviceNames: [...new Set((catalog ?? []).map((p) => p.name))],
          insurerNames: (insurers ?? []).map((i) => i.name),
          unitCount: workspaceIds.length,
        }}
        doctorPhone={profile?.phone ?? ''}
        initialHandoffPushEnabled={membership?.handoff_push_enabled ?? false}
      />
    </div>
  )
}
