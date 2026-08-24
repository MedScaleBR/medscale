'use client'

import { useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { ConsentDialog } from './ConsentDialog'
import { Mic, Square, Loader2 } from 'lucide-react'

type RecordingButtonProps = {
  appointmentId?: string
  patientId: string
  onComplete?: (transcriptionId: string) => void
}

type RecordingState = 'idle' | 'recording' | 'uploading'

function pickMimeType() {
  const preferred = 'audio/webm;codecs=opus'
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(preferred)) return preferred
  return 'audio/webm'
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function RecordingButton({ appointmentId, patientId, onComplete }: RecordingButtonProps) {
  const router = useRouter()
  const [state, setState] = useState<RecordingState>('idle')
  const [consentOpen, setConsentOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  async function startRecording() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.start(10_000)
      mediaRecorderRef.current = recorder
      startedAtRef.current = Date.now()
      setElapsed(0)
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000))
      }, 1000)
      setState('recording')
    } catch {
      setError('Não foi possível acessar o microfone. Verifique as permissões do navegador.')
    }
  }

  async function stopRecording() {
    const recorder = mediaRecorderRef.current
    if (!recorder) return

    if (timerRef.current) clearInterval(timerRef.current)
    const durationSeconds = Math.floor((Date.now() - startedAtRef.current) / 1000)

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
    })
    recorder.stop()
    await stopped
    streamRef.current?.getTracks().forEach((t) => t.stop())

    setState('uploading')

    const blob = new Blob(chunksRef.current, { type: recorder.mimeType })

    try {
      // 1. Pede uma signed upload URL pro nosso backend (valida sessão +
      // módulo, mas não recebe o arquivo — só metadados).
      const urlRes = await fetch('/api/transcriptions/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointment_id: appointmentId ?? null, content_type: blob.type }),
      })
      if (!urlRes.ok) {
        const body = await urlRes.json().catch(() => ({}))
        throw new Error(body.error ?? 'Falha ao preparar o upload')
      }
      const { path, token } = await urlRes.json()

      // 2. Sobe o áudio direto pro Supabase Storage — o Blob nunca passa
      // pelo corpo de uma rota do Next.js, então gravações longas não
      // esbarram no limite de corpo de funções serverless da Vercel.
      const supabase = createClient()
      const { error: uploadError } = await supabase.storage
        .from('recordings')
        .uploadToSignedUrl(path, token, blob, { contentType: blob.type })
      if (uploadError) throw new Error(uploadError.message)

      // 3. Cria o registro da transcrição referenciando o áudio já
      // enviado, e dispara o pipeline.
      const finalizeRes = await fetch('/api/transcriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_path: path,
          appointment_id: appointmentId ?? null,
          patient_id: patientId,
          consent_confirmed: true,
          duration_seconds: durationSeconds,
        }),
      })
      if (!finalizeRes.ok) {
        const body = await finalizeRes.json().catch(() => ({}))
        throw new Error(body.error ?? 'Falha ao registrar a transcrição')
      }
      const { id } = await finalizeRes.json()

      setState('idle')
      onComplete?.(id)
      router.push(`/transcricoes/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar a gravação')
      setState('idle')
    }
  }

  if (state === 'recording') {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-red-600">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
          {formatDuration(elapsed)}
        </span>
        <Button variant="destructive" onClick={stopRecording} className="gap-2">
          <Square className="h-4 w-4" />
          Encerrar gravação
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        onClick={() => setConsentOpen(true)}
        disabled={state === 'uploading'}
        className="gap-2 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
      >
        {state === 'uploading' ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Enviando...
          </>
        ) : (
          <>
            <Mic className="h-4 w-4" />
            Gravar consulta
          </>
        )}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <ConsentDialog open={consentOpen} onOpenChange={setConsentOpen} onConfirm={startRecording} />
    </div>
  )
}
