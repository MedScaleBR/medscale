import { describe, it, expect } from 'vitest'
import { buildInviteEmail } from '@/lib/email/templates/invite'

const base = {
  inviterName: 'Dra. Camila Reis',
  accountName: 'Clínica Vitale',
  inviteUrl: 'https://app.medscale.com.br/invite/9f2c7a41-3b8e-4d6a-9c15-7e0b2d84af53',
  recipientEmail: 'camila.reis@clinicavitale.com.br',
  role: 'admin' as const,
}

describe('buildInviteEmail', () => {
  it('monta assunto, html e texto com os dados do convite', () => {
    const { subject, html, text } = buildInviteEmail(base)

    expect(subject).toBe('Dra. Camila Reis te convidou para o MedScale')
    expect(html).toContain('Você foi convidado para a Clínica Vitale')
    expect(html).toContain(base.inviteUrl)
    expect(html).toContain('Admin &middot; camila.reis@clinicavitale.com.br')
    expect(html).toContain('Este convite expira em 7 dias')
    expect(text).toContain(base.inviteUrl)
    expect(text).toContain('Seu acesso: Admin - camila.reis@clinicavitale.com.br')
  })

  it('usa o rótulo pt-BR de cada papel', () => {
    expect(buildInviteEmail({ ...base, role: 'owner' }).html).toContain('Owner &middot;')
    expect(buildInviteEmail({ ...base, role: 'member' }).html).toContain('Membro &middot;')
  })

  it('cai num rótulo genérico quando o papel não é informado', () => {
    const { html } = buildInviteEmail({ ...base, role: undefined })
    expect(html).toContain('Acesso à equipe &middot;')
  })

  it('escapa HTML nos valores dinâmicos para não quebrar o layout nem injetar marcação', () => {
    const { html } = buildInviteEmail({
      ...base,
      inviterName: 'Ana <b>"Nina"</b> & cia',
      accountName: 'Clínica <script>alert(1)</script>',
    })

    expect(html).toContain('Ana &lt;b&gt;&quot;Nina&quot;&lt;/b&gt; &amp; cia')
    expect(html).toContain('Clínica &lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('mantém o assunto como texto puro, sem escape de entidades', () => {
    const { subject } = buildInviteEmail({ ...base, inviterName: 'Marina & João' })
    expect(subject).toBe('Marina & João te convidou para o MedScale')
  })
})
