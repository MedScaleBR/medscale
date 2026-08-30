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
// para não afetar executeHandoff(). Loga cada saída como `[push] ...` para dar
// pra diagnosticar por que uma notificação não chegou.
export async function sendHandoffPush(workspaceId: string, payload: PushPayload): Promise<void> {
  if (!pushConfigured) {
    console.warn('[push] VAPID keys ausentes (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) — push ignorado')
    return
  }

  try {
    const supabase = createAdminClient()

    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .select('account_id')
      .eq('id', workspaceId)
      .single()

    if (wsError || !workspace) {
      console.error('[push] workspace não encontrada', workspaceId, wsError?.message)
      return
    }

    // Membros da account com push habilitado. O filtro por workspace
    // (workspace_ids null = acesso a todas) é feito em JS — mesmo padrão de
    // lib/session/server.ts — para não depender da sintaxe de array do
    // PostgREST.
    const { data: memberships, error: mError } = await supabase
      .from('memberships')
      .select('user_id, workspace_ids')
      .eq('account_id', workspace.account_id)
      .eq('status', 'active')
      .eq('handoff_push_enabled', true)

    if (mError) {
      console.error('[push] erro ao buscar memberships', mError.message)
      return
    }

    const userIds = (memberships ?? [])
      .filter((m) => !m.workspace_ids || m.workspace_ids.includes(workspaceId))
      .map((m) => m.user_id)

    if (!userIds.length) {
      console.log('[push] nenhum membro com handoff_push_enabled nessa workspace')
      return
    }

    const { data: subscriptions, error: sError } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('workspace_id', workspaceId)
      .in('user_id', userIds)

    if (sError) {
      console.error('[push] erro ao buscar push_subscriptions', sError.message)
      return
    }

    if (!subscriptions?.length) {
      console.log('[push] membros habilitados, mas sem subscription registrada nessa workspace')
      return
    }

    const payloadStr = JSON.stringify(payload)

    const results = await Promise.allSettled(
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
            console.error('[push] falha ao enviar, status', statusCode)
          }
          throw err
        }
      })
    )

    const ok = results.filter((r) => r.status === 'fulfilled').length
    console.log(`[push] handoff: ${ok}/${subscriptions.length} notificações enviadas`)
  } catch (err) {
    console.error('[push] sendHandoffPush falhou', err)
  }
}
