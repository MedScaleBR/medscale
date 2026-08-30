'use client'

import { useEffect, useState } from 'react'
import { Switch } from '@/components/ui/switch'
import {
  getSubscriptionStatus,
  subscribeToPush,
  unsubscribeFromPush,
  type SubscriptionStatus,
} from '@/lib/push/client'

interface PushToggleProps {
  initialHandoffEnabled: boolean
}

export function PushToggle({ initialHandoffEnabled }: PushToggleProps) {
  const [status, setStatus] = useState<SubscriptionStatus | 'loading'>('loading')
  const [deviceBusy, setDeviceBusy] = useState(false)
  const [deviceError, setDeviceError] = useState<string | null>(null)

  const [handoffEnabled, setHandoffEnabled] = useState(initialHandoffEnabled)
  const [handoffBusy, setHandoffBusy] = useState(false)
  const [handoffError, setHandoffError] = useState<string | null>(null)

  useEffect(() => {
    getSubscriptionStatus().then(setStatus).catch(() => setStatus('unsupported'))
  }, [])

  const deviceDisabled =
    deviceBusy || status === 'loading' || status === 'unsupported' || status === 'denied'

  const handleDeviceToggle = async (next: boolean) => {
    setDeviceError(null)
    setDeviceBusy(true)
    try {
      if (next) {
        await subscribeToPush()
        setStatus('subscribed')
      } else {
        await unsubscribeFromPush()
        setStatus('unsubscribed')
      }
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : 'Não foi possível alterar as notificações.')
    } finally {
      setDeviceBusy(false)
    }
  }

  const handleHandoffToggle = async (next: boolean) => {
    setHandoffError(null)
    setHandoffBusy(true)
    setHandoffEnabled(next)
    try {
      const res = await fetch('/api/push/handoff-enabled', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? 'Falha ao salvar.')
      }
    } catch (err) {
      setHandoffEnabled(!next)
      setHandoffError(err instanceof Error ? err.message : 'Falha ao salvar.')
    } finally {
      setHandoffBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-3">
          <Switch
            checked={status === 'subscribed'}
            onCheckedChange={handleDeviceToggle}
            disabled={deviceDisabled}
          />
          <span className="text-sm text-gray-700">Quero receber notificações quando chegar um handoff</span>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          {status === 'unsupported'
            ? 'Este navegador não suporta notificações push.'
            : status === 'denied'
              ? 'As notificações estão bloqueadas para este site. Reative nas configurações do navegador (cadeado ao lado do endereço) e recarregue a página.'
              : 'Este dispositivo receberá uma notificação push, mesmo com o app fechado.'}
        </p>
        {deviceError && <p className="mt-1 text-xs text-red-500">{deviceError}</p>}
      </div>

      <div>
        <div className="flex items-center gap-3">
          <Switch checked={handoffEnabled} onCheckedChange={handleHandoffToggle} disabled={handoffBusy} />
          <span className="text-sm text-gray-700">Estou habilitado para receber handoffs desta clínica</span>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          Outros membros também podem se habilitar nas próprias configurações.
        </p>
        {handoffError && <p className="mt-1 text-xs text-red-500">{handoffError}</p>}
      </div>
    </div>
  )
}
