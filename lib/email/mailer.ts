import nodemailer from 'nodemailer'

interface SendInviteEmailParams {
  to: string
  accountName: string
  token: string
  inviterName: string
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
}: SendInviteEmailParams): Promise<{ sent: boolean; error?: string }> {
  const transporter = getTransporter()
  const from = process.env.SMTP_FROM

  if (!transporter || !from) {
    console.warn(`SMTP_* não configuradas — convite para ${to} não foi enviado por e-mail.`)
    return { sent: false, error: 'not_configured' }
  }

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${token}`

  try {
    await transporter.sendMail({
      from,
      to,
      subject: `${inviterName} te convidou para o MedScale`,
      html: `
        <p>Olá!</p>
        <p><strong>${inviterName}</strong> te convidou para fazer parte de <strong>${accountName}</strong> no MedScale.</p>
        <p><a href="${inviteUrl}">Clique aqui para aceitar o convite</a></p>
        <p style="color:#888;font-size:12px">Este link expira em 7 dias.</p>
      `,
    })

    return { sent: true }
  } catch (err) {
    return { sent: false, error: String(err) }
  }
}
