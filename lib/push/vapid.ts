import webpush from 'web-push'

// Configuração do cliente web-push a partir das VAPID keys. Se as chaves não
// estiverem no ambiente, `pushConfigured` fica false e sendHandoffPush() vira
// no-op — o handoff nunca depende do push para funcionar.
const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const privateKey = process.env.VAPID_PRIVATE_KEY
const mailto = process.env.VAPID_MAILTO ?? 'mailto:suporte@medscalebr.com'

export const pushConfigured = Boolean(publicKey && privateKey)

if (pushConfigured) {
  webpush.setVapidDetails(mailto, publicKey!, privateKey!)
}

export { webpush }
