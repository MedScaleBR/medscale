import { describe, it, expect } from 'vitest'
import { validate } from '@/lib/tiss/v4_03_00/batch'
import { buildOpmeAnnexMessage } from '@/lib/tiss/v4_03_00/authorization-messages'
import { clip, optText } from '@/lib/tiss/v4_03_00/authorization-common'
import { fakeOpmeAnnex, opmeItem } from './authorization-fixtures'
import { FIXED_NOW } from './fixtures'
import { hashFromFile } from './hash-from-file'

const text = (xml: Buffer) => xml.toString('latin1')
// Nenhum elemento vazio (<a></a> ou <a/>): minLength=1 em todo st_texto.
const EMPTY_ELEMENT = /<ans:\w+\/>|<ans:(\w+)><\/ans:\1>/
const opmeXml = (annex = fakeOpmeAnnex()) => buildOpmeAnnexMessage({ annex, referencedGuideNumber: '41', now: FIXED_NOW })

describe('helpers de texto das solicitações', () => {
  it('clip converte para Latin-1 antes de cortar e optText omite vazio', () => {
    expect(clip('  ação  ', 3)).toBe('açã')
    expect(clip(null, 5)).toBe('')
    expect(clip('😀😀abc', 2)).toBe('ab')
    expect(optText('observacao', '  \n ', 500)).toBeNull()
  })
})

describe('Anexo de Solicitação de OPME avulso (ENVIO_ANEXO)', () => {
  it('é válido contra o XSD 4.03.00 em loteAnexos/AnexosGuiasTISS/anexoSolicitacaoOPME', async () => {
    const { xml } = opmeXml()
    const result = await validate(xml)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    const t = text(xml)
    expect(t).toContain('<ans:tipoTransacao>ENVIO_ANEXO</ans:tipoTransacao><ans:sequencialTransacao>43</ans:sequencialTransacao>')
    expect(t).toContain('<ans:prestadorParaOperadora><ans:loteAnexos><ans:numeroLote>43</ans:numeroLote><ans:AnexosGuiasTISS><ans:anexoSolicitacaoOPME>')
    expect(t).toContain(
      '<ans:cabecalhoAnexo><ans:registroANS>999999</ans:registroANS><ans:numeroGuiaAnexo>43</ans:numeroGuiaAnexo>' +
      '<ans:numeroGuiaReferenciada>41</ans:numeroGuiaReferenciada><ans:dataSolicitacao>2026-10-05</ans:dataSolicitacao></ans:cabecalhoAnexo>',
    )
    expect(t).toContain('<ans:profissionalSolicitante><ans:nomeProfissional>Dra. Maria Exemplo</ans:nomeProfissional><ans:telefoneProfissional>11999990000</ans:telefoneProfissional><ans:emailProfissional>maria@exemplo.test</ans:emailProfissional></ans:profissionalSolicitante>')
    expect(t).toContain('<ans:dadosBeneficiario><ans:numeroCarteira>00001111222233334</ans:numeroCarteira><ans:atendimentoRN>N</ans:atendimentoRN></ans:dadosBeneficiario>')
    // Solicitação não leva campos de resposta (D5).
    expect(t).not.toMatch(/numeroGuiaOperadora|<ans:senha>|dataAutorizacao/)
    expect(t).not.toMatch(EMPTY_ELEMENT)
  })

  it('aceita vários materiais, valor em decimal e omite opcionais vazios', async () => {
    const annex = fakeOpmeAnnex(3)
    annex.items[1] = opmeItem(2, { requested_value_cents: null, anvisa_registration: null, manufacturer_reference: null, operating_authorization: null })
    annex.payload.request.observation = '   '
    annex.payload.request.material_specification = null
    annex.payload.professional.email = null
    const { xml } = opmeXml(annex)
    expect((await validate(xml)).errors).toEqual([])
    const t = text(xml)
    expect(t.match(/<ans:opmeSolicitada>/g)).toHaveLength(3)
    expect(t.match(/<ans:valorSolicitado>1500\.00<\/ans:valorSolicitado>/g)).toHaveLength(2)
    expect(t).not.toMatch(/<ans:Observacao>|<ans:especificacaoMaterial>|<ans:emailProfissional>/)
    expect(t).not.toMatch(EMPTY_ELEMENT)
  })

  it('usa Observacao com O maiúsculo e na última posição', async () => {
    const annex = fakeOpmeAnnex()
    annex.payload.request.material_specification = 'Placa bloqueada 4,5 mm'
    annex.payload.request.observation = 'Urgente'
    const t = text(opmeXml(annex).xml)
    expect(t).toContain('</ans:opmeSolicitadas><ans:Observacao>Urgente</ans:Observacao></ans:anexoSolicitacaoOPME>')
    expect(t).toContain('</ans:justificativaTecnica><ans:especificacaoMaterial>Placa bloqueada 4,5 mm</ans:especificacaoMaterial><ans:opmeSolicitadas>')
    expect((await validate(opmeXml(annex).xml)).valid).toBe(true)
  })

  it('corta texto livre no maxLength, mas nunca identificadores', async () => {
    const annex = fakeOpmeAnnex()
    annex.payload.request.technical_justification = 'J'.repeat(1200)
    annex.payload.request.observation = 'O'.repeat(600)
    const cut = opmeXml(annex)
    expect((await validate(cut.xml)).valid).toBe(true)
    expect(text(cut.xml)).toContain(`<ans:justificativaTecnica>${'J'.repeat(1000)}</ans:justificativaTecnica>`)
    expect(text(cut.xml)).toContain(`<ans:Observacao>${'O'.repeat(500)}</ans:Observacao>`)

    annex.payload.beneficiary.card_number = '1'.repeat(21)
    const bad = opmeXml(annex)
    expect(text(bad.xml)).toContain(`<ans:numeroCarteira>${'1'.repeat(21)}</ans:numeroCarteira>`)
    const result = await validate(bad.xml)
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toContain('numeroCarteira')
    expect(result.errors.join('\n')).not.toContain('1'.repeat(21))
  })

  it('reprova quando falta obrigatório (telefone do profissional)', async () => {
    const annex = fakeOpmeAnnex()
    annex.payload.professional.phone = null
    const result = await validate(opmeXml(annex).xml)
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toMatch(/telefoneProfissional/)
  })

  it('caracteres especiais: escapa & e <, mantém Latin-1, descarta o resto, hash bate com o arquivo', async () => {
    const annex = fakeOpmeAnnex()
    annex.payload.request.technical_justification = 'Dor & edema <grave> 😀 Erdős\nlinha ½ º'
    annex.items[0].description = 'Parafuso cortical ½ rosca — 3,5 mm'
    const { xml, hash } = opmeXml(annex)
    const t = text(xml)
    expect(t).toContain('Dor &amp; edema &lt;grave&gt;')
    expect(t).toContain('Erdoslinha ½ º')
    expect(t).not.toContain('😀')
    expect(t).toContain('Parafuso cortical ½ rosca  3,5 mm')
    expect(hash).toBe(hashFromFile(xml))
    expect((await validate(xml)).valid).toBe(true)
  })

  it('recusa anexo sem materiais', () => {
    expect(() => opmeXml(fakeOpmeAnnex(0))).toThrow('anexo OPME sem materiais')
  })
})
