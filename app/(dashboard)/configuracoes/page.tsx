import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { SettingsClient } from '@/components/configuracoes/SettingsClient'
import { isEmbeddedSignupConfigured } from '@/lib/meta/embedded-signup'

export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; whatsapp?: string; meta_ads?: string }>
}) {
  const { google: googleStatus, whatsapp: whatsappStatus, meta_ads: metaAdsStatus } = await searchParams
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const [
    { data: profile },
    { data: botConfig },
    { data: googleToken },
    { data: workspaces },
    { data: adsConnection },
    { data: adAccountMaps },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', session.userId).single(),
    supabase
      .from('bot_config')
      .select('whatsapp_number, meta_token, phone_number_id')
      .eq('account_id', session.accountId)
      .maybeSingle(),
    supabase.from('google_tokens').select('google_email').eq('account_id', session.accountId).maybeSingle(),
    supabase
      .from('workspaces')
      .select('id, name, gcal_calendar_id')
      .eq('account_id', session.accountId)
      .eq('is_active', true)
      .order('display_order'),
    supabase
      .from('meta_ads_connections')
      .select('fb_user_id, is_valid, token_expires_at')
      .eq('account_id', session.accountId)
      .maybeSingle(),
    supabase
      .from('workspace_ad_accounts')
      .select('workspace_id, ad_account_id, ad_account_name')
      .eq('account_id', session.accountId),
  ])

  const adAccountByWorkspace = new Map((adAccountMaps ?? []).map((m) => [m.workspace_id, m.ad_account_id]))

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
      {whatsappStatus === 'connected' && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">
          WhatsApp conectado com sucesso.
        </div>
      )}
      {whatsappStatus === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
          Não foi possível conectar o WhatsApp. Tente novamente.
        </div>
      )}
      {metaAdsStatus === 'connected' && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">
          Facebook conectado com sucesso.
        </div>
      )}
      {metaAdsStatus === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
          Não foi possível conectar o Facebook. Tente novamente.
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
          whatsappNumber: botConfig?.whatsapp_number ?? null,
        }}
        whatsappConnected={Boolean(botConfig?.meta_token && botConfig?.phone_number_id)}
        metaAppId={process.env.NEXT_PUBLIC_META_APP_ID ?? ''}
        metaConfigId={process.env.META_ES_CONFIG_ID ?? ''}
        metaConfigured={isEmbeddedSignupConfigured()}
        google={{ connected: Boolean(googleToken), email: googleToken?.google_email ?? null }}
        workspaceCalendars={(workspaces ?? []).map((w) => ({
          id: w.id,
          name: w.name,
          gcalCalendarId: w.gcal_calendar_id,
        }))}
        metaAds={{
          connected: Boolean(adsConnection),
          // A expiração em si é detectada no uso (getValidAdsToken em
          // /api/meta/ads/accounts), que marca is_valid=false via
          // markAdsConnectionInvalid — aqui só refletimos essa flag.
          isValid: Boolean(adsConnection?.is_valid),
          workspaces: (workspaces ?? []).map((w) => ({
            id: w.id,
            name: w.name,
            adAccountId: adAccountByWorkspace.get(w.id) ?? null,
          })),
        }}
        isOwner={session.role === 'owner'}
        canManageIntegrations={session.role === 'owner' || session.role === 'admin'}
        showRevenueCycle={session.userModules.includes('revenue_cycle')}
      />
    </div>
  )
}
