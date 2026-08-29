import nodemailer from 'nodemailer'
import type { MembershipRole } from '@/types/database'
import { buildInviteEmail } from '@/lib/email/templates/invite'

interface SendInviteEmailParams {
  to: string
  accountName: string
  token: string
  inviterName: string
  role?: MembershipRole
}

let cachedTransporter: ReturnType<typeof nodemailer.createTransport> | null = null

function getTransporter() {
  if (cachedTransporter) return cachedTransporter

  const host = process.env.SMTP_HOST
  const port = process.env.SMTP_PORT
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !port || !user || !pass) return null

  cachedTransporter = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: Number(port) === 465,
    auth: { user, pass },
  })
  return cachedTransporter
}

// Envia o e-mail de convite via SMTP (Nodemailer). Sem as variáveis SMTP_*
// configuradas, o convite continua sendo criado normalmente no banco (a tela
// de admin mostra o link para copiar/colar manualmente) — só o disparo do
// e-mail é pulado.
export async function sendInviteEmail({
  to,
  accountName,
  token,
  inviterName,
  role,
}: SendInviteEmailParams): Promise<{ sent: boolean; error?: string }> {
  const transporter = getTransporter()
  const from = process.env.SMTP_FROM

  if (!transporter || !from) {
    console.warn(`SMTP_* não configuradas — convite para ${to} não foi enviado por e-mail.`)
    return { sent: false, error: 'not_configured' }
  }

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${token}`
  const { subject, html, text } = buildInviteEmail({
    inviterName,
    accountName,
    inviteUrl,
    recipientEmail: to,
    role,
  })

  try {
    await transporter.sendMail({ from, to, subject, html, text })

    return { sent: true }
  } catch (err) {
    return { sent: false, error: String(err) }
  }
}
