'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { loadFbSdk } from '@/lib/meta/fb-sdk'

interface Props {
  isConnected: boolean
  whatsappNumber: string | null
  /** false quando faltam NEXT_PUBLIC_META_APP_ID / config do Embedded Signup */
  isConfigured: boolean
  appId: string
  configId: string
}

// Allowlist exata: `endsWith('facebook.com')` aceitaria `evilfacebook.com`, que
// qualquer um registra, e o forjador passaria waba_id/phone_number_id nossos.
const ORIGENS_META = ['https://www.facebook.com', 'https://web.facebook.com']

export function WhatsAppConnectButton({ isConnected, whatsappNumber, isConfigured, appId, configId }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionInfo = useRef<{ waba_id?: string; phone_number_id?: string }>({})
  // Distingue desistência do usuário de popup que nunca abriu: sem isso as duas
  // terminam no mesmo callback sem `code` e o botão fica mudo.
  const cancelled = useRef(false)

  // O popup do Embedded Signup devolve WABA e Phone Number ID por postMessage —
  // o callback do FB.login traz só o `code`. Precisamos dos dois lados.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!ORIGENS_META.includes(event.origin)) return
      try {
        const data = JSON.parse(event.data)
        if (data.type !== 'WA_EMBEDDED_SIGNUP') return
        if (data.event === 'FINISH') sessionInfo.current = data.data ?? {}
        if (data.event === 'CANCEL') {
          cancelled.current = true
          setLoading(false)
        }
        if (data.event === 'ERROR') {
          setError(data.data?.error_message ?? 'A Meta interrompeu a conexão.')
          setLoading(false)
        }
      } catch {
        // mensagens de outros produtos da Meta trafegam no mesmo canal
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Carrega o SDK antes de qualquer clique. Dentro do handler o download
  // consumiria a ativação do gesto e o Chrome bloquearia o popup em silêncio.
  const [sdkReady, setSdkReady] = useState(false)
  useEffect(() => {
    if (!isConfigured || isConnected) return
    let ativo = true
    loadFbSdk(appId)
      .then(() => {
        if (ativo) setSdkReady(true)
      })
      .catch((err: unknown) => {
        if (ativo) setError(err instanceof Error ? err.message : 'Falha ao carregar o SDK do Facebook.')
      })
    return () => {
      ativo = false
    }
  }, [isConfigured, isConnected, appId])

  const handleConnect = () => {
    if (!window.FB) {
      setError('O SDK do Facebook ainda não carregou. Aguarde um instante e tente de novo.')
      return
    }
    setLoading(true)
    setError(null)
    sessionInfo.current = {}
    cancelled.current = false
    const finishSignup = async (response: { authResponse?: { code?: string } }) => {
      const code = response.authResponse?.code
      const { waba_id, phone_number_id } = sessionInfo.current
      if (!code || !waba_id || !phone_number_id) {
        // Desistência é silenciosa; qualquer outro caminho sem dados é
        // falha real (popup bloqueado, fluxo interrompido) e precisa
        // aparecer — foi o que escondeu esse bug até agora.
        if (!cancelled.current) {
          setError(
            'A conexão não foi concluída. Se nenhuma janela da Meta abriu, libere os popups deste site no navegador e tente de novo.'
          )
        }
        setLoading(false)
        return
      }
      const res = await fetch('/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, waba_id, phone_number_id }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Não foi possível concluir a conexão.')
        setLoading(false)
        return
      }
      // Navegação de página inteira: precisa recarregar os dados do servidor
      // (workspace.whatsappNumber, whatsappConnected) que vêm por props do page.tsx.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/configuracoes?whatsapp=connected'
    }
    try {
      window.FB.login(
        // O SDK valida o tipo do callback e rejeita async function
        // ("Expression is of type asyncfunction, not function"), dentro de uma
        // promise — sem stack útil e sem erro na tela. Tem que ser função comum.
        (response) => {
          finishSignup(response).catch((err: unknown) => {
            setError(err instanceof Error ? err.message : 'Falha ao concluir a conexão.')
            setLoading(false)
          })
        },
        {
          config_id: configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { sessionInfoVersion: '3' },
        }
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao iniciar a conexão.')
      setLoading(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('Desconectar o WhatsApp? A Clara para de responder os pacientes.')) return
    setLoading(true)
    await fetch('/api/bot/onboarding/disconnect', { method: 'DELETE' })
    window.location.reload()
  }

  if (isConnected) {
    return (
      <div className="flex items-center gap-3">
        <Badge className="border-none bg-green-50 text-green-700">
          ✓ Conectado{whatsappNumber ? ` — ${whatsappNumber}` : ''}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDisconnect}
          disabled={loading}
          className="border-red-200 text-red-500 hover:text-red-700"
        >
          Desconectar
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Button
        onClick={handleConnect}
        disabled={loading || !isConfigured || !sdkReady}
        className="bg-[var(--cyan)] font-medium text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
      >
        {!isConfigured
          ? 'Integração em aprovação na Meta'
          : loading
            ? 'Conectando...'
            : !sdkReady
              ? 'Carregando...'
              : 'Conectar WhatsApp'}
      </Button>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
}
