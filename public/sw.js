// Service worker de Web Push da MedScale.
// Servido em /sw.js (arquivo estático). Registrado sob demanda em
// lib/push/client.ts quando o membro liga as notificações neste dispositivo.
// Payload esperado do backend (lib/push/send.ts): { title, body, url }.

// Assume o controle assim que uma versão nova é instalada, sem esperar todas
// as abas fecharem — evita SW antigo (sem handler de push) ficar no comando.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }

  const title = data.title || 'MedScale'
  const options = {
    body: data.body || '',
    icon: '/logo-icon.png',
    data: { url: data.url || '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(targetUrl) && 'focus' in client) {
            return client.focus()
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl)
        }
        return undefined
      })
  )
})
