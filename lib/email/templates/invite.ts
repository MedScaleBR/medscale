import type { MembershipRole } from '@/types/database'

export interface InviteEmailParams {
  /** Nome (ou e-mail) de quem enviou o convite. */
  inviterName: string
  /** Nome da account para a qual a pessoa está sendo convidada. */
  accountName: string
  /** URL completa de aceite: `${NEXT_PUBLIC_APP_URL}/invite/${token}`. */
  inviteUrl: string
  /** E-mail que recebeu o convite — precisa ser o mesmo no cadastro. */
  recipientEmail: string
  /** Papel concedido. Sem ele, o bloco "Seu acesso" cai num texto genérico. */
  role?: MembershipRole
}

// Mesmos rótulos da tela de aceite (app/(auth)/invite/[token]/page.tsx).
const ROLE_LABEL: Record<MembershipRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Membro',
}

// Valores vêm de full_name / nome da account / e-mail digitado — todos podem
// conter caracteres que quebram (ou injetam) HTML. Escapamos antes de interpolar.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Monta o e-mail de convite/cadastro a partir do template de marca
 * (`Invite email HTML design/invite-email.html`). Retorna assunto, HTML e uma
 * versão texto puro pra clientes que não renderizam HTML e pra entregabilidade.
 */
export function buildInviteEmail(params: InviteEmailParams): {
  subject: string
  html: string
  text: string
} {
  const { inviterName, accountName, inviteUrl, recipientEmail, role } = params
  const roleLabel = role ? ROLE_LABEL[role] : 'Acesso à equipe'

  const subject = `${inviterName} te convidou para o MedScale`
  const preheader = `${inviterName} te convidou para a conta da ${accountName} no MedScale. O link expira em 7 dias.`

  const inviter = escapeHtml(inviterName)
  const account = escapeHtml(accountName)
  const email = escapeHtml(recipientEmail)
  const url = escapeHtml(inviteUrl)
  const roleText = escapeHtml(roleLabel)
  const preheaderText = escapeHtml(preheader)

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Convite para o MedScale</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style>
  a { color: #0094AF; }
  @media only screen and (max-width: 620px) {
    .sh { width: 100% !important; }
    .pad { padding-left: 24px !important; padding-right: 24px !important; }
    .h1 { font-size: 24px !important; line-height: 32px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; width:100%; background-color:#EDEFF5;">

<span style="display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; max-height:0; max-width:0; overflow:hidden; mso-hide:all;">${preheaderText}</span>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#EDEFF5;">
<tr>
<td align="center" style="padding:32px 12px;">

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="sh" style="width:600px; max-width:600px;">

    <!-- Marca -->
    <tr>
      <td style="padding:0 8px 16px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="22" style="width:22px; height:22px; background-color:#00B9D8; border-radius:6px;">&nbsp;</td>
            <td style="padding-left:10px; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:22px; mso-line-height-rule:exactly; font-weight:bold; color:#0F1E45; letter-spacing:-0.2px;">MedScale</td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Card -->
    <tr>
      <td style="background-color:#FFFFFF; border-radius:16px; border:1px solid #E1E4EE;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">

          <!-- Faixa navy -->
          <tr>
            <td style="background-color:#0F1E45; border-radius:16px 16px 0 0; padding:28px 40px;" class="pad">
              <p style="margin:0; font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:18px; mso-line-height-rule:exactly; font-weight:bold; letter-spacing:1.4px; text-transform:uppercase; color:#00B9D8;">Convite de equipe</p>
              <p style="margin:8px 0 0 0; font-family:Arial, Helvetica, sans-serif; font-size:26px; line-height:34px; mso-line-height-rule:exactly; font-weight:normal; color:#FFFFFF;" class="h1">Você foi convidado para a ${account}</p>
            </td>
          </tr>

          <!-- Corpo -->
          <tr>
            <td style="padding:32px 40px 8px 40px;" class="pad">
              <p style="margin:0; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:26px; mso-line-height-rule:exactly; color:#3D4763;">
                Olá,<br><br>
                <strong style="color:#162755;">${inviter}</strong> te convidou para fazer parte de <strong style="color:#162755;">${account}</strong> no MedScale — o painel onde a clínica gerencia agenda, pacientes e o atendimento automático no WhatsApp.
              </p>
            </td>
          </tr>

          <!-- Papel -->
          <tr>
            <td style="padding:20px 40px 4px 40px;" class="pad">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; background-color:#F5F7FB; border:1px solid #E1E4EE; border-radius:12px;">
                <tr>
                  <td style="padding:16px 20px; font-family:Arial, Helvetica, sans-serif; font-size:13px; line-height:20px; mso-line-height-rule:exactly; color:#7A839C;">
                    Seu acesso
                    <div style="font-family:Arial, Helvetica, sans-serif; font-size:15px; line-height:22px; mso-line-height-rule:exactly; font-weight:bold; color:#0F1E45; padding-top:2px;">${roleText} &middot; ${email}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Botão -->
          <tr>
            <td style="padding:28px 40px 0 40px;" class="pad">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#00B9D8" style="background-color:#00B9D8; border-radius:10px;">
                    <a href="${url}" style="display:block; padding:15px 34px; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#0F1E45; text-decoration:none; border-radius:10px;">Criar conta e aceitar convite</a>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0 0; font-family:Arial, Helvetica, sans-serif; font-size:13px; line-height:20px; mso-line-height-rule:exactly; color:#7A839C;">
                Este convite expira em 7 dias. Use o mesmo e-mail em que recebeu esta mensagem.
              </p>
            </td>
          </tr>

          <!-- Divisor -->
          <tr>
            <td style="padding:28px 40px 0 40px;" class="pad">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
                <tr><td height="1" style="height:1px; background-color:#E1E4EE; line-height:1px; font-size:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>

          <!-- O que você encontra -->
          <tr>
            <td style="padding:24px 40px 0 40px;" class="pad">
              <p style="margin:0 0 14px 0; font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:18px; mso-line-height-rule:exactly; font-weight:bold; letter-spacing:1.2px; text-transform:uppercase; color:#7A839C;">O que você encontra lá</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
                <tr>
                  <td width="8" valign="top" style="width:8px; padding:5px 12px 0 0;"><div style="width:6px; height:6px; background-color:#00B9D8; border-radius:3px; font-size:0; line-height:0;">&nbsp;</div></td>
                  <td style="font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:22px; mso-line-height-rule:exactly; color:#3D4763; padding-bottom:10px;">Agenda sincronizada com o Google Calendar</td>
                </tr>
                <tr>
                  <td width="8" valign="top" style="width:8px; padding:5px 12px 0 0;"><div style="width:6px; height:6px; background-color:#00B9D8; border-radius:3px; font-size:0; line-height:0;">&nbsp;</div></td>
                  <td style="font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:22px; mso-line-height-rule:exactly; color:#3D4763; padding-bottom:10px;">Agente de WhatsApp que agenda consultas sozinho</td>
                </tr>
                <tr>
                  <td width="8" valign="top" style="width:8px; padding:5px 12px 0 0;"><div style="width:6px; height:6px; background-color:#00B9D8; border-radius:3px; font-size:0; line-height:0;">&nbsp;</div></td>
                  <td style="font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:22px; mso-line-height-rule:exactly; color:#3D4763;">Receita, tráfego pago e métricas num só painel</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Link manual -->
          <tr>
            <td style="padding:28px 40px 36px 40px;" class="pad">
              <p style="margin:0 0 6px 0; font-family:Arial, Helvetica, sans-serif; font-size:13px; line-height:20px; mso-line-height-rule:exactly; color:#7A839C;">Se o botão não funcionar, copie e cole este endereço no navegador:</p>
              <p style="margin:0; font-family:'Courier New', Courier, monospace; font-size:12px; line-height:19px; mso-line-height-rule:exactly; word-break:break-all;">
                <a href="${url}" style="color:#0094AF; text-decoration:underline;">${url}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>

    <!-- Rodapé -->
    <tr>
      <td style="padding:24px 8px 8px 8px;">
        <p style="margin:0; font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:20px; mso-line-height-rule:exactly; color:#8A93AB;">
          Você recebeu este e-mail porque alguém da ${account} te convidou para o MedScale. Não esperava por isso? Ignore esta mensagem — sem clicar no link, nenhuma conta é criada.
        </p>
        <p style="margin:14px 0 0 0; font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:20px; mso-line-height-rule:exactly; color:#8A93AB;">
          MedScale &middot; Rua dos Pinheiros, 498 &middot; São Paulo/SP &middot; 05422-012<br>
          Dúvidas? Responda este e-mail ou escreva para <a href="mailto:suporte@medscale.com.br" style="color:#0094AF; text-decoration:underline;">suporte@medscale.com.br</a>
        </p>
      </td>
    </tr>

  </table>

</td>
</tr>
</table>

</body>
</html>`

  const text = [
    `${inviterName} te convidou para fazer parte de ${accountName} no MedScale.`,
    '',
    `Seu acesso: ${roleLabel} - ${recipientEmail}`,
    '',
    'Criar conta e aceitar convite:',
    inviteUrl,
    '',
    'Este convite expira em 7 dias. Use o mesmo e-mail em que recebeu esta mensagem.',
    '',
    'Nao esperava por isso? Ignore esta mensagem - sem clicar no link, nenhuma conta e criada.',
    '',
    'MedScale - Duvidas? Responda este e-mail ou escreva para suporte@medscale.com.br',
  ].join('\n')

  return { subject, html, text }
}
