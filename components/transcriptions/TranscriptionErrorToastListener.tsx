'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/lib/session/session-context'
import { workspaceChannel } from '@/lib/realtime/broadcast'
import { shouldShowTranscriptionErrorToast, type TranscriptionErrorToastEvent } from '@/lib/transcriptions/transcription-toast'

// Par in-app da notificação Web Push (sendTranscriptionErrorPush): enquanto o
// médico que gravou a consulta está com o sistema aberto, mostra um toast
// quando a transcrição dele esgota as tentativas automáticas e vira `error`.
// Passivo — não depende de nenhum opt-in, ao contrário da push.
export function TranscriptionErrorToastListener() {
  const { workspaceId, userId, accountModules } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (!workspaceId || !userId || !accountModules.includes('transcriptions')) return

    const supabase = createClient()
    const channel = supabase
      .channel(workspaceChannel(workspaceId), { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'transcription_error' }, ({ payload }) => {
        const event = payload as TranscriptionErrorToastEvent
        if (!event?.transcriptionId) return
        if (!shouldShowTranscriptionErrorToast({ currentUserId: userId, event })) return

        const name = event.patientName ?? 'Paciente'
        toast(`⚠️ Transcrição de ${name} não foi processada`, {
          description: 'Toque para abrir e tentar novamente',
          duration: 8000,
          action: {
            label: 'Abrir',
            onClick: () => router.push(`/transcricoes/${event.transcriptionId}`),
          },
        })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [workspaceId, userId, accountModules, router])

  return null
}
