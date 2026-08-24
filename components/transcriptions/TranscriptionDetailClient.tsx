'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { TranscriptionStatusBadge } from './TranscriptionStatusBadge'
import { SOAPEditor } from './SOAPEditor'
import { AlertsPanel } from './AlertsPanel'
import { Loader2 } from 'lucide-react'
import type { Transcription } from '@/lib/transcriptions/types'

const STATUS_MESSAGE: Record<string, string> = {
  pending: 'Na fila para transcrição...',
  transcribing: 'Transcrevendo o áudio da consulta...',
  transcribed: 'Preparando geração do prontuário...',
  generating: 'Gerando o prontuário com IA...',
}

export function TranscriptionDetailClient({ initial }: { initial: Transcription }) {
  const router = useRouter()
  const [transcription, setTranscription] = useState(initial)
  const [signOpen, setSignOpen] = useState(false)
  const [signing, setSigning] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [draft, setDraft] = useState(initial.medical_record_draft)

  useEffect(() => {
    if (transcription.status === 'signed' || transcription.status === 'error') return

    const supabase = createClient()
    const channel = supabase
      .channel(`transcription-${transcription.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'transcriptions', filter: `id=eq.${transcription.id}` },
        (payload) => {
          const next = payload.new as Transcription
          setTranscription(next)
          setDraft(next.medical_record_draft)
          if (next.status === 'draft_ready' || next.status === 'signed' || next.status === 'error') {
            router.refresh()
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcription.id, transcription.status])

  async function handleSign() {
    if (!draft) return
    setSigning(true)
    try {
      const res = await fetch(`/api/transcriptions/${transcription.id}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medical_record_final: draft }),
      })
      if (res.ok) {
        setTranscription({
          ...transcription,
          status: 'signed',
          medical_record_final: draft,
          signed_at: new Date().toISOString(),
        })
        router.refresh()
      }
    } finally {
      setSigning(false)
      setSignOpen(false)
    }
  }

  async function handleRetry() {
    setRetrying(true)
    try {
      const res = await fetch(`/api/transcriptions/${transcription.id}/retry`, { method: 'POST' })
      if (res.ok) {
        setTranscription({ ...transcription, status: 'pending', error_message: null })
      }
    } finally {
      setRetrying(false)
    }
  }

  if (['pending', 'transcribing', 'transcribed', 'generating'].includes(transcription.status)) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-[var(--navy-06)] bg-white py-16">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--cyan-dark)]" />
        <p className="text-sm text-gray-600">{STATUS_MESSAGE[transcription.status]}</p>
        <TranscriptionStatusBadge status={transcription.status} />
      </div>
    )
  }

  if (transcription.status === 'error') {
    return (
      <div className="space-y-4 rounded-xl border border-red-200 bg-red-50 p-6">
        <div>
          <p className="text-sm font-medium text-red-800">Ocorreu um erro no processamento</p>
          <p className="mt-1 text-sm text-red-700">{transcription.error_message ?? 'Erro desconhecido.'}</p>
        </div>
        <Button onClick={handleRetry} disabled={retrying} variant="destructive">
          {retrying ? 'Reprocessando...' : 'Tentar novamente'}
        </Button>
      </div>
    )
  }

  if (transcription.status === 'draft_ready' && draft) {
    return (
      <div className="space-y-4">
        <AlertsPanel alertas={draft.alertas} />
        <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
          <SOAPEditor initialValue={draft} onChange={setDraft} />
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => setSignOpen(true)}
            className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            Assinar prontuário
          </Button>
        </div>

        <Dialog open={signOpen} onOpenChange={setSignOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Assinar prontuário</DialogTitle>
              <DialogDescription>
                Ao assinar, o prontuário fica registrado como final e não pode mais ser editado. Confirma?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSignOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSign}
                disabled={signing}
                className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
              >
                {signing ? 'Assinando...' : 'Confirmar assinatura'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  if (transcription.status === 'signed' && transcription.medical_record_final) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
          <SOAPEditor initialValue={transcription.medical_record_final} readOnly />
        </div>
      </div>
    )
  }

  return null
}
