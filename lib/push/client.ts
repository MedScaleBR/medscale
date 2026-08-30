'use client'

// Utilitários client-side do ciclo de vida da subscription de Web Push.
// Usados por components/push/PushToggle.tsx.

export type SubscriptionStatus = 'subscribed' | 'unsubscribed' | 'unsupported' | 'denied'

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length))
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

function isSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

// Estado atual sem efeitos colaterais — não registra o service worker.
export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  if (!isSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'

  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return 'unsubscribed'

  const sub = await registration.pushManager.getSubscription()
  return sub ? 'subscribed' : 'unsubscribed'
}

// Registra o SW (idempotente), pede permissão se necessário, cria a
// PushSubscription e persiste no backend.
export async function subscribeToPush(): Promise<void> {
  if (!isSupported()) throw new Error('Push não suportado neste navegador')

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapidKey) throw new Error('VAPID public key não configurada')

  const registration = await navigator.serviceWorker.register('/sw.js', {
    scope: '/',
    updateViaCache: 'none',
  })
  await navigator.serviceWorker.ready

  let sub = await registration.pushManager.getSubscription()
  if (!sub) {
    sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    })
  }

  const json = sub.toJSON()
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      userAgent: navigator.userAgent,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error ?? 'Falha ao salvar a subscription')
  }
}

// Remove a subscription do backend e do browser.
export async function unsubscribeFromPush(): Promise<void> {
  if (!isSupported()) return

  const registration = await navigator.serviceWorker.getRegistration()
  const sub = await registration?.pushManager.getSubscription()
  if (!sub) return

  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {})

  await sub.unsubscribe().catch(() => {})
}
