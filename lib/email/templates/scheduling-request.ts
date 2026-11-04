// E-mail da solicitação de agendamento (unidade com agenda externa). Leva só o
// resumo que a equipe já vê em /bot e o link da conversa (exige login).

export interface SchedulingRequestEmailParams {
  patientName: string | null
  unitName: string
  /** Linhas do resumo (formatExternalRequestLines). */
  lines: string[]
  conversationUrl: string
  hasCardPhoto: boolean
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Sem caracteres de controle (CR/LF quebrariam o Subject) e com tamanho limitado.
function sanitizeText(value: string, maxLen = 200): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      out += ' '
      continue
    }
    out += ch
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, maxLen)
}

export function buildSchedulingRequestEmail(params: SchedulingRequestEmailParams): {
  subject: string
  html: string
  text: string
} {
  const patient = sanitizeText(params.patientName ?? '', 120) || 'Paciente'
  const unit = sanitizeText(params.unitName, 120)
  const lines = params.lines.map((l) => sanitizeText(l, 300))
  const subject = `Nova solicitação de agendamento — ${patient} — ${unit}`
  const attachmentNote = params.hasCardPhoto ? 'A foto da carteirinha está em anexo.' : null

  const text = [
    'Nova solicitação de agendamento',
    '',
    ...lines,
    '',
    ...(attachmentNote ? [attachmentNote, ''] : []),
    `Abrir conversa: ${params.conversationUrl}`,
  ].join('\n')

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;">
      <tr><td>
        <h1 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#0b1f3a;">Nova solicitação de agendamento</h1>
        <ul style="margin:0 0 16px;padding-left:18px;font-size:14px;line-height:1.6;">
          ${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('\n          ')}
        </ul>
        ${attachmentNote ? `<p style="margin:0 0 16px;font-size:13px;color:#4b5563;">${attachmentNote}</p>` : ''}
        <a href="${escapeHtml(params.conversationUrl)}" style="display:inline-block;background:#22d3ee;color:#0b1f3a;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;">Abrir conversa</a>
        <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">É preciso entrar no MedScale para ver a conversa.</p>
      </td></tr>
    </table>
  </body>
</html>`

  return { subject, html, text }
}
