import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { displayPatientName, hasRealName } from '@/lib/bot/inbox'
import { parseProfileName } from '@/lib/whatsapp/profile-name'
import { PatientNameEditor } from '@/components/bot/PatientNameEditor'

describe('displayPatientName', () => {
  it('nome real tem prioridade sobre o do WhatsApp', () => {
    expect(displayPatientName('Maria Souza', 'Mari 🌸')).toBe('Maria Souza')
  })

  it('enquanto o nome é o provisório, mostra o do WhatsApp', () => {
    expect(displayPatientName('Paciente', 'Mari 🌸')).toBe('Mari 🌸')
  })

  it('sem nenhum dos dois → null (a tela mostra o telefone)', () => {
    expect(displayPatientName('Paciente', null)).toBeNull()
    expect(displayPatientName(null, '  ')).toBeNull()
  })

  it('hasRealName ignora o provisório e espaços', () => {
    expect(hasRealName('Paciente')).toBe(false)
    expect(hasRealName('  ')).toBe(false)
    expect(hasRealName(null)).toBe(false)
    expect(hasRealName('João')).toBe(true)
  })
})

describe('parseProfileName', () => {
  const contacts = [{ wa_id: '5571999990000', profile: { name: 'Mari 🌸' } }]

  it('pega o nome do contato que mandou a mensagem', () => {
    expect(parseProfileName(contacts, '5571999990000')).toBe('Mari 🌸')
  })

  it('contato único sem wa_id batendo ainda vale', () => {
    expect(parseProfileName([{ profile: { name: 'Ana' } }], '5571999990000')).toBe('Ana')
  })

  it('limpa quebras de linha e espaços e corta nomes enormes', () => {
    expect(parseProfileName([{ wa_id: 'x', profile: { name: '  Ana\n  Paula  ' } }], 'x')).toBe('Ana Paula')
    expect(parseProfileName([{ wa_id: 'x', profile: { name: 'a'.repeat(300) } }], 'x')).toHaveLength(100)
  })

  it('sem contatos ou sem nome → null', () => {
    expect(parseProfileName(undefined, 'x')).toBeNull()
    expect(parseProfileName([{ wa_id: 'x', profile: {} }], 'x')).toBeNull()
    expect(parseProfileName([{ wa_id: 'x', profile: { name: '   ' } }], 'x')).toBeNull()
    expect(parseProfileName([{ wa_id: 'a' }, { wa_id: 'b' }], 'x')).toBeNull()
  })
})

describe('PatientNameEditor', () => {
  it('mostra o nome e o botão de editar quando há paciente', () => {
    const html = renderToStaticMarkup(
      <PatientNameEditor patientId="p1" fullName="Paciente" whatsappName="Mari" title="Mari" onSaved={() => {}} />
    )
    expect(html).toContain('Mari')
    expect(html).toContain('Editar nome do paciente')
  })

  it('sem paciente vinculado não oferece edição', () => {
    const html = renderToStaticMarkup(
      <PatientNameEditor patientId={null} fullName={null} whatsappName={null} title="(71) 99999-0000" onSaved={() => {}} />
    )
    expect(html).not.toContain('Editar nome do paciente')
  })
})
