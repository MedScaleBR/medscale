'use client'

import { useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { ConsentDialog } from './ConsentDialog'
import { Mic, MicOff, Square, Loader2 } from 'lucide-react'
import { useAnalyticsBase } from '@/lib/session/session-context'
import { trackRecordingStarted, trackRecordingUploaded } from '@/lib/analytics/posthog'
import { getRecordingLimitState } from '@/lib/transcriptions/recording-limits'
import {
  getMicAlert,
  levelForMeter,
  rmsFromTimeDomain,
  SILENCE_RMS_THRESHOLD,
  type MicAlert,
} from '@/lib/transcriptions/mic-health'
import { friendlyErrorMessage } from '@/lib/friendly-errors'

type RecordingButtonProps = {
  appointmentId?: string
  patientId?: string
  patientName?: string
  unitName?: string
  disabled?: boolean
  onBusyChange?: (busy: boolean) => void
  onComplete?: (transcriptionId: string) => void
}

type RecordingState = 'idle' | 'recording' | 'uploading'

function pickMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ]
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

function isRecordingSupported() {
  return (
    typeof window !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  )
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function RecordingButton({ appointmentId, patientId, patientName, unitName, disabled, onBusyChange, onComplete }: RecordingButtonProps) {
  const router = useRouter()
  const analyticsBase = useAnalyticsBase()
  const [state, setState] = useState<RecordingState>('idle')
  const [consentOpen, setConsentOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [autoStopped, setAutoStopped] = useState(false)
  const [isSupported] = useState(() => isRecordingSupported())

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoStopTriggeredRef = useRef(false)

  // Saúde do microfone (ver lib/transcriptions/mic-health): o navegador pode
  // cortar o som (tela bloqueada, outro app, Bluetooth caiu) sem o
  // MediaRecorder falhar — ele segue gravando silêncio.
  const [level, setLevel] = useState(0)
  const [meterAvailable, setMeterAvailable] = useState(false)
  const [micAlert, setMicAlert] = useState<MicAlert | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastSoundAtRef = useRef<number>(0)
  const micFlagsRef = useRef({ trackEnded: false, trackMuted: false, recorderError: false })
  const alertKindRef = useRef<MicAlert['kind'] | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    onBusyChange?.(state !== 'idle')
  }, [state, onBusyChange])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      teardownMicMonitoring()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // O navegador solta o Wake Lock sozinho quando a aba sai de vista; ao
  // voltar, pede de novo e acorda o AudioContext, que alguns aparelhos suspendem.
  useEffect(() => {
    if (state !== 'recording') return
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      void requestWakeLock()
      void audioCtxRef.current?.resume().catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [state])

  async function requestWakeLock() {
    try {
      if (!('wakeLock' in navigator) || wakeLockRef.current?.released === false) return
      wakeLockRef.current = await navigator.wakeLock.request('screen')
    } catch {
      // Sem suporte, bateria fraca ou aba em segundo plano: segue sem.
    }
  }

  function updateMicAlert(silentSeconds: number) {
    const alert = getMicAlert({ ...micFlagsRef.current, silentSeconds })
    if (alert && alertKindRef.current !== alert.kind) {
      // Vibra no celular para chamar atenção mesmo com o médico olhando o paciente.
      navigator.vibrate?.([200, 100, 200])
    }
    alertKindRef.current = alert?.kind ?? null
    setMicAlert(alert)
  }

  function startMicMonitoring(stream: MediaStream, recorder: MediaRecorder) {
    micFlagsRef.current = { trackEnded: false, trackMuted: false, recorderError: false }
    alertKindRef.current = null
    lastSoundAtRef.current = Date.now()
    setMicAlert(null)
    setLevel(0)

    const track = stream.getAudioTracks()[0]
    if (track) {
      track.onmute = () => {
        micFlagsRef.current.trackMuted = true
        updateMicAlert(0)
      }
      track.onunmute = () => {
        micFlagsRef.current.trackMuted = false
        lastSoundAtRef.current = Date.now()
        updateMicAlert(0)
      }
      track.onended = () => {
        micFlagsRef.current.trackEnded = true
        updateMicAlert(0)
      }
    }
    recorder.onerror = () => {
      micFlagsRef.current.recorderError = true
      updateMicAlert(0)
    }

    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      void ctx.resume().catch(() => {})
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      ctx.createMediaStreamSource(stream).connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)
      audioCtxRef.current = ctx
      setMeterAvailable(true)

      levelTimerRef.current = setInterval(() => {
        // Com o AudioContext suspenso não dá para medir: não conta como
        // silêncio (os eventos de mute/ended da trilha seguem valendo).
        if (ctx.state !== 'running') {
          lastSoundAtRef.current = Date.now()
          setLevel(0)
          updateMicAlert(0)
          return
        }
        analyser.getByteTimeDomainData(samples)
        const rms = rmsFromTimeDomain(samples)
        setLevel(levelForMeter(rms))
        if (rms >= SILENCE_RMS_THRESHOLD) lastSoundAtRef.current = Date.now()
        updateMicAlert((Date.now() - lastSoundAtRef.current) / 1000)
      }, 250)
    } catch (err) {
      console.warn('[RecordingButton] medidor de áudio indisponível:', err)
    }
  }

  function teardownMicMonitoring() {
    if (levelTimerRef.current) clearInterval(levelTimerRef.current)
    levelTimerRef.current = null
    void audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    void wakeLockRef.current?.release().catch(() => {})
    wakeLockRef.current = null
    const track = streamRef.current?.getAudioTracks()[0]
    if (track) {
      track.onmute = null
      track.onunmute = null
      track.onended = null
    }
  }

  async function startRecording() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {})
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.start(10_000)
      mediaRecorderRef.current = recorder
      startMicMonitoring(stream, recorder)
      void requestWakeLock()
      startedAtRef.current = Date.now()
      autoStopTriggeredRef.current = false
      trackRecordingStarted(analyticsBase)
      setElapsed(0)
      setAutoStopped(false)
      timerRef.current = setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000)
        setElapsed(seconds)
        // Encerra a gravação sozinha ao bater no teto de duração, seguindo
        // o mesmo fluxo do botão "Encerrar gravação".
        if (getRecordingLimitState(seconds).shouldStop && !autoStopTriggeredRef.current) {
          autoStopTriggeredRef.current = true
          setAutoStopped(true)
          void stopRecording()
        }
      }, 1000)
      setState('recording')
    } catch (err) {
      const error = err as DOMException
      let message = 'Não foi possível acessar o microfone.'

      if (error?.name === 'NotAllowedError') {
        message = 'Permissão de microfone negada. Verifique as configurações do navegador e tente novamente.'
      } else if (error?.name === 'NotFoundError') {
        message = 'Nenhum microfone encontrado neste dispositivo.'
      } else if (error?.name === 'NotSupportedError' || error?.name === 'SecurityError') {
        message = 'Gravação de áudio não suportada. Verifique se o site está acessado via HTTPS.'
      }

      console.error('[RecordingButton] getUserMedia error:', error?.name, error?.message)
      setError(message)
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
    teardownMicMonitoring()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    setMicAlert(null)
    setMeterAvailable(false)

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
          patient_id: patientId ?? null,
          patient_name: patientName,
          unit_name: unitName,
          consent_confirmed: true,
          duration_seconds: durationSeconds,
        }),
      })
      if (!finalizeRes.ok) {
        const body = await finalizeRes.json().catch(() => ({}))
        throw new Error(body.error ?? 'Falha ao registrar a transcrição')
      }
      const { id } = await finalizeRes.json()

      trackRecordingUploaded({
        ...analyticsBase,
        duration_seconds: durationSeconds,
        file_size_mb: blob.size / 1_000_000,
      })

      setState('idle')
      onComplete?.(id)
      router.push(`/transcricoes/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar a gravação')
      setState('idle')
    }
  }

  if (!isSupported) {
    return (
      <p className="text-sm text-muted-foreground">
        Gravação de áudio não disponível neste navegador.
      </p>
    )
  }

  if (state === 'recording') {
    const limit = getRecordingLimitState(elapsed)
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 text-sm font-medium ${
              limit.showWarning ? 'text-amber-600' : 'text-red-600'
            }`}
          >
            <span
              className={`h-2 w-2 animate-pulse rounded-full ${
                limit.showWarning ? 'bg-amber-600' : 'bg-red-600'
              }`}
            />
            {formatDuration(elapsed)}
          </span>
          {meterAvailable && (
            <span
              className="h-2 w-16 overflow-hidden rounded-full bg-muted"
              role="meter"
              aria-label="Volume do microfone"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(level * 100)}
            >
              <span
                className={`block h-full rounded-full transition-[width] duration-200 ${
                  micAlert ? 'bg-red-600' : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </span>
          )}
          <Button variant="destructive" onClick={stopRecording} className="gap-2">
            <Square className="h-4 w-4" />
            Encerrar gravação
          </Button>
        </div>
        {micAlert && (
          <p
            role="alert"
            className="flex max-w-sm items-start gap-1.5 rounded-md border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700"
          >
            <MicOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {micAlert.message}
          </p>
        )}
        {limit.showWarning && (
          <p className="text-xs text-amber-600">
            Encerra automaticamente em {formatDuration(limit.secondsUntilStop)}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        onClick={() => setConsentOpen(true)}
        disabled={disabled || state === 'uploading'}
        className="gap-2 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
      >
        {state === 'uploading' ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {autoStopped ? 'Tempo máximo de 30 min atingido — enviando...' : 'Enviando...'}
          </>
        ) : (
          <>
            <Mic className="h-4 w-4" />
            Gravar consulta
          </>
        )}
      </Button>
      {error && <p className="text-xs text-red-600">{friendlyErrorMessage(error, "Não foi possível enviar a gravação. Confira sua conexão e tente novamente.")}</p>}
      <ConsentDialog open={consentOpen} onOpenChange={setConsentOpen} onConfirm={startRecording} />
    </div>
  )
}
