import { createAdminClient } from '@/lib/supabase/server'
import { pushConfigured, webpush } from './vapid'

type PushPayload = {
  title: string
  body: string
  url: string
}

// Dispara um Web Push para todos os dispositivos registrados dos membros da
// account (dona da workspace) que ativaram `handoff_push_enabled` e têm acesso
// a essa workspace. Fire-and-forget: nunca lança — qualquer erro é engolido
// para não afetar executeHandoff().
export async function sendHandoffPush(workspaceId: string, payload: PushPayload): Promise<void> {
  if (!pushConfigured) return

  try {
    const supabase = createAdminClient()

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('account_id')
      .eq('id', workspaceId)
      .single()

    if (!workspace) return

    // Membros da account com push habilitado e acesso a essa workspace
    // (workspace_ids null = acesso a todas).
    const { data: memberships } = await supabase
      .from('memberships')
      .select('user_id')
      .eq('account_id', workspace.account_id)
      .eq('status', 'active')
      .eq('handoff_push_enabled', true)
      .or(`workspace_ids.is.null,workspace_ids.cs.{${workspaceId}}`)

    if (!memberships?.length) return

    const userIds = memberships.map((m) => m.user_id)

    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('workspace_id', workspaceId)
      .in('user_id', userIds)

    if (!subscriptions?.length) return

    const payloadStr = JSON.stringify(payload)

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payloadStr
          )
        } catch (err) {
          const statusCode = (err as { statusCode?: number })?.statusCode
          // Subscription expirada/removida no browser — limpa do banco.
          if (statusCode === 404 || statusCode === 410) {
            await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          } else {
            // Não logar o endpoint (dado de dispositivo — LGPD).
            console.error('[push] falha ao enviar handoff push, status', statusCode)
          }
        }
      })
    )
  } catch (err) {
    console.error('[push] sendHandoffPush falhou', err)
  }
}
