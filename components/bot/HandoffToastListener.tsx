'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/lib/session/session-context'
import { workspaceChannel } from '@/lib/realtime/broadcast'
import { shouldShowHandoffToast, type HandoffToastEvent } from '@/lib/bot/handoff-toast'
import { useActiveConversation } from './active-conversation'

// Par in-app da notificação Web Push: enquanto a equipe está com o sistema
// aberto, mostra um toast quando uma conversa passa a precisar de humano — a
// menos que a pessoa já esteja olhando exatamente aquela conversa.
export function HandoffToastListener({ handoffEnabled }: { handoffEnabled: boolean }) {
  const { workspaceId } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const { activeConversationId, requestConversation } = useActiveConversation()

  // O handler roda dentro da subscription; refs mantêm ele lendo valores atuais
  // sem precisar recriar o canal a cada navegação.
  const pathnameRef = useRef(pathname)
  const activeRef = useRef(activeConversationId)
  useEffect(() => {
    pathnameRef.current = pathname
    activeRef.current = activeConversationId
  })

  useEffect(() => {
    if (!handoffEnabled || !workspaceId) return

    const supabase = createClient()
    const channel = supabase
      .channel(workspaceChannel(workspaceId), { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'handoff_message' }, ({ payload }) => {
        const event = payload as HandoffToastEvent
        if (!event?.conversationId) return
        if (
          !shouldShowHandoffToast({
            pathname: pathnameRef.current,
            openConversationId: activeRef.current,
            event,
          })
        ) {
          return
        }

        const name = event.patientName ?? 'Paciente'
        toast(`🔔 ${name} pediu atendimento humano`, {
          description: 'Toque para abrir a conversa',
          duration: 8000,
          action: {
            label: 'Abrir',
            onClick: () => {
              requestConversation(event.conversationId)
              router.push(`/bot?c=${event.conversationId}`)
            },
          },
        })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [handoffEnabled, workspaceId, router, requestConversation])

  return null
}
