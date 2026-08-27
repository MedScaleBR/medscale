import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { SettingsClient } from '@/components/configuracoes/SettingsClient'

export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>
}) {
  const { google: googleStatus } = await searchParams
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const [{ data: profile }, { data: workspace }, { data: googleToken }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', session.userId).single(),
    supabase.from('workspaces').select('whatsapp_number, meta_token').eq('id', session.workspaceId).single(),
    supabase.from('google_tokens').select('google_email').eq('workspace_id', session.workspaceId).maybeSingle(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Configurações</h1>
        <p className="text-sm text-gray-400">Perfil, WhatsApp e Google Agenda</p>
      </div>

      {googleStatus === 'connected' && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">
          Google Agenda conectado com sucesso.
        </div>
      )}
      {googleStatus === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
          Não foi possível conectar o Google Agenda. Tente novamente.
        </div>
      )}

      <SettingsClient
        initialProfile={{
          full_name: profile?.full_name ?? '',
          specialty: profile?.specialty ?? null,
          crm: profile?.crm ?? null,
          phone: profile?.phone ?? null,
        }}
        workspace={{
          hasMetaToken: Boolean(workspace?.meta_token),
          whatsappNumber: workspace?.whatsapp_number ?? null,
        }}
        google={{ connected: Boolean(googleToken), email: googleToken?.google_email ?? null }}
        isOwner={session.role === 'owner'}
        showRevenueCycle={session.userModules.includes('revenue_cycle')}
      />
    </div>
  )
}
