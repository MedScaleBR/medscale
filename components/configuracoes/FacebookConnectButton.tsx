'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface FacebookConnectButtonProps {
  isConnected: boolean
  /** false quando o token expirou/foi revogado (Meta respondeu 190) — pedir reconexão. */
  isValid: boolean
  mappedCount: number
  totalWorkspaces: number
}

export function FacebookConnectButton({ isConnected, isValid, mappedCount, totalWorkspaces }: FacebookConnectButtonProps) {
  const [loading, setLoading] = useState(false)

  const handleConnect = () => {
    setLoading(true)
    // Navegação de página inteira, não uma rota do App Router: precisa seguir o
    // redirect 302 do servidor (com o cookie de nonce) até o consentimento do Facebook.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/api/meta/ads/connect'
  }

  const handleDisconnect = async () => {
    if (!confirm('Desconectar o Facebook Ads? Os mapeamentos de unidade por conta de anúncio serão perdidos.')) return
    setLoading(true)
    await fetch('/api/meta/ads/disconnect', { method: 'DELETE' })
    window.location.reload()
  }

  if (isConnected && !isValid) {
    return (
      <div className="flex items-center gap-3">
        <Badge className="border-none bg-amber-50 text-amber-700">Conexão expirada</Badge>
        <Button
          onClick={handleConnect}
          disabled={loading}
          className="gap-2 bg-[#1877F2] font-medium text-white hover:bg-[#1877F2]/90"
        >
          <FacebookIcon className="h-4 w-4" />
          {loading ? 'Redirecionando...' : 'Reconectar com Facebook'}
        </Button>
      </div>
    )
  }

  if (isConnected) {
    return (
      <div className="flex items-center gap-3">
        <Badge className="border-none bg-green-50 text-green-700">✓ Conectado</Badge>
        <span className="text-xs text-gray-400">
          {mappedCount} de {totalWorkspaces} unidades mapeadas
        </span>
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
    <Button
      onClick={handleConnect}
      disabled={loading}
      className="gap-2 bg-[#1877F2] font-medium text-white hover:bg-[#1877F2]/90"
    >
      <FacebookIcon className="h-4 w-4" />
      {loading ? 'Redirecionando...' : 'Login com Facebook'}
    </Button>
  )
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.9 3.77-3.9 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.87h2.78l-.45 2.91h-2.33V22c4.78-.76 8.44-4.92 8.44-9.94z" />
    </svg>
  )
}
