'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { FEEDBACK_MESSAGE_MAX_LENGTH } from '@/lib/feedback/prompt'
import { useFeedback } from './feedback-context'

type Step = 'ask' | 'write' | 'sent'

export function FeedbackBalloon() {
  const { isOpen, close } = useFeedback()
  const [step, setStep] = useState<Step>('ask')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  function reset() {
    close()
    setStep('ask')
    setMessage('')
    setError(null)
  }

  // "Agora não": fecha na hora e adia em segundo plano. Se a chamada falhar, o
  // pior caso é o balão reaparecer na próxima visita — não vale travar a UI.
  function handleDismiss() {
    reset()
    void fetch('/api/feedback/dismiss', { method: 'POST' })
  }

  async function handleSubmit() {
    if (!message.trim() || sending) return
    setSending(true)
    setError(null)

    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })

    setSending(false)

    if (!res.ok) {
      // Só a validação (400) tem texto pensado para o usuário; 500 carrega
      // mensagem crua do Postgres, que não deve chegar à tela.
      const data = res.status === 400 ? await res.json().catch(() => ({})) : {}
      setError(data.error ?? 'Não foi possível enviar agora. Tente de novo em instantes.')
      return
    }

    setStep('sent')
    setTimeout(reset, 2500)
  }

  return (
    <div
      role="dialog"
      aria-label="Feedback"
      className="fixed right-4 bottom-20 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-lg)] md:right-6 md:bottom-6"
    >
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Fechar"
        className="absolute top-3 right-3 text-gray-400 transition-colors hover:text-gray-600"
      >
        <X className="h-4 w-4" />
      </button>

      {step === 'ask' && (
        <>
          <p className="pr-6 text-sm font-medium text-gray-900">Tem alguma sugestão para a MedScale?</p>
          <p className="mt-1 text-xs text-gray-400">
            Sua opinião guia o que a gente constrói em seguida. Leva menos de um minuto.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="lg" onClick={() => setStep('write')}>
              Quero opinar
            </Button>
            <Button size="lg" variant="ghost" onClick={handleDismiss}>
              Agora não
            </Button>
          </div>
        </>
      )}

      {step === 'write' && (
        <>
          <p className="pr-6 text-sm font-medium text-gray-900">O que podemos melhorar?</p>
          <Textarea
            autoFocus
            rows={4}
            value={message}
            maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Conte o que poderia funcionar melhor, ou o que está faltando…"
            className="mt-2 text-sm"
          />
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs text-gray-400">
              {message.length}/{FEEDBACK_MESSAGE_MAX_LENGTH}
            </span>
            <Button size="lg" onClick={handleSubmit} disabled={!message.trim() || sending}>
              {sending ? 'Enviando…' : 'Enviar'}
            </Button>
          </div>
        </>
      )}

      {step === 'sent' && (
        <>
          <p className="pr-6 text-sm font-medium text-gray-900">Obrigado!</p>
          <p className="mt-1 text-xs text-gray-400">Sua mensagem chegou ao time da MedScale.</p>
        </>
      )}
    </div>
  )
}
