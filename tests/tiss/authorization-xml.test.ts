import { describe, it, expect } from 'vitest'
import { validate } from '@/lib/tiss/v4_03_00/batch'
import { buildAuthorizationRequestMessage, buildOpmeAnnexMessage } from '@/lib/tiss/v4_03_00/authorization-messages'
import { clip, optText } from '@/lib/tiss/v4_03_00/authorization-common'
import { fakeHospitalizationRequest, fakeOpmeAnnex, fakeSpSadtRequest, opmeItem } from './authorization-fixtures'
import type { AuthorizationXmlSource } from '@/lib/billing/authorizations/types'
import { FIXED_NOW } from './fixtures'
import { hashFromFile } from './hash-from-file'

const text = (xml: Buffer) => xml.toString('latin1')
// Nenhum elemento vazio (<a></a> ou <a/>): minLength=1 em todo st_texto.
const EMPTY_ELEMENT = /<ans:\w+\/>|<ans:(\w+)><\/ans:\1>/
const opmeXml = (annex = fakeOpmeAnnex()) => buildOpmeAnnexMessage({ annex, referencedGuideNumber: '41', now: FIXED_NOW })

type RequestSource = AuthorizationXmlSource<'sp_sadt_request'> | AuthorizationXmlSource<'hospitalization_request'>
const requestXml = (request: RequestSource, embeddedOpme: AuthorizationXmlSource<'opme_request'> | null = null) =>
  buildAuthorizationRequestMessage({ request, embeddedOpme, now: FIXED_NOW })

describe('helpers de texto das solicitações', () => {
  it('clip converte para Latin-1 antes de cortar e optText omite vazio', () => {
    expect(clip('  ação  ', 3)).toBe('açã')
    expect(clip(null, 5)).toBe('')
    expect(clip('😀😀abc', 2)).toBe('ab')
    expect(optText('observacao', '  \n ', 500)).toBeNull()
  })

  it('clip troca quebra de linha e tab por espaço e colapsa espaços repetidos', () => {
    expect(clip('fixação\r\ninterna\tda\n\ntíbia', 1000)).toBe('fixação interna da tíbia')
    expect(clip('a — b 😀  c', 100)).toBe('a b c')
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
    expect(t).toContain('Erdos linha ½ º')
    expect(t).not.toContain('😀')
    expect(t).toContain('Parafuso cortical ½ rosca 3,5 mm')
    expect(hash).toBe(hashFromFile(xml))
    expect((await validate(xml)).valid).toBe(true)
  })

  it('justificativa com \\r\\n e \\t entre palavras sai com espaços simples', async () => {
    const annex = fakeOpmeAnnex()
    annex.payload.request.technical_justification = 'Fratura\r\nde\ttíbia\r\n\r\ncom  desvio'
    const { xml, hash } = opmeXml(annex)
    expect(text(xml)).toContain('<ans:justificativaTecnica>Fratura de tíbia com desvio</ans:justificativaTecnica>')
    expect(hash).toBe(hashFromFile(xml))
    expect((await validate(xml)).valid).toBe(true)
  })

  it('recusa anexo sem materiais', () => {
    expect(() => opmeXml(fakeOpmeAnnex(0))).toThrow('anexo OPME sem materiais')
  })
})

describe('Solicitação de SP/SADT (SOLICITACAO_PROCEDIMENTOS)', () => {
  it('é válida com 2 procedimentos e só os obrigatórios', async () => {
    const { xml } = requestXml(fakeSpSadtRequest(2))
    const result = await validate(xml)
    expect(result.errors).toEqual([])
    const t = text(xml)
    expect(t).toContain(
      '<ans:tipoTransacao>SOLICITACAO_PROCEDIMENTOS</ans:tipoTransacao><ans:sequencialTransacao>41</ans:sequencialTransacao>' +
      '<ans:dataRegistroTransacao>2026-09-29</ans:dataRegistroTransacao><ans:horaRegistroTransacao>18:30:00</ans:horaRegistroTransacao>',
    )
    expect(t).toContain(
      '<ans:prestadorParaOperadora><ans:solicitacaoProcedimento><ans:solicitacaoSP-SADT><ans:cabecalhoSolicitacao>' +
      '<ans:registroANS>999999</ans:registroANS><ans:numeroGuiaPrestador>41</ans:numeroGuiaPrestador></ans:cabecalhoSolicitacao>' +
      '<ans:tipoEtapaAutorizacao>1</ans:tipoEtapaAutorizacao><ans:dadosBeneficiario>',
    )
    expect(t).toContain(
      '<ans:dadosSolicitante><ans:contratadoSolicitante><ans:codigoPrestadorNaOperadora>PREST0001</ans:codigoPrestadorNaOperadora>' +
      '</ans:contratadoSolicitante><ans:nomeContratadoSolicitante>Clínica Fictícia São João Ltda</ans:nomeContratadoSolicitante>' +
      '<ans:profissionalSolicitante><ans:nomeProfissional>Dra. Maria Exemplo</ans:nomeProfissional>' +
      '<ans:conselhoProfissional>06</ans:conselhoProfissional><ans:numeroConselhoProfissional>123456</ans:numeroConselhoProfissional>' +
      '<ans:UF>35</ans:UF><ans:CBOS>225125</ans:CBOS></ans:profissionalSolicitante></ans:dadosSolicitante>' +
      '<ans:caraterAtendimento>1</ans:caraterAtendimento><ans:dataSolicitacao>2026-10-05</ans:dataSolicitacao>' +
      '<ans:indicacaoClinica>Investigação de anemia</ans:indicacaoClinica><ans:procedimentosSolicitados>',
    )
    expect(t.match(/<ans:procedimentosSolicitados>/g)).toHaveLength(2)
    expect(t).not.toMatch(/dadosExecutante|anexoClinico|coberturaEspecial|<ans:observacao>|numeroGuiaPrincipal|sequencialItem/)
    expect(t).not.toMatch(EMPTY_ELEMENT)
  })

  it('inclui os opcionais na ordem do XSD', async () => {
    const req = fakeSpSadtRequest(1)
    Object.assign(req.payload.request, {
      main_guide_number: 'G-1', absence_code: '02', code: 'ABC123', character: '2', special_coverage: '02',
      executor: { operator_code: 'EXEC01', cnes: '7654321' }, observation: 'Paciente em jejum',
    })
    const { xml } = requestXml(req)
    expect((await validate(xml)).errors).toEqual([])
    const t = text(xml)
    expect(t).toContain(
      '</ans:cabecalhoSolicitacao><ans:numeroGuiaPrincipal>G-1</ans:numeroGuiaPrincipal>' +
      '<ans:ausenciaCodValidacao>02</ans:ausenciaCodValidacao><ans:codValidacao>ABC123</ans:codValidacao>' +
      '<ans:tipoEtapaAutorizacao>1</ans:tipoEtapaAutorizacao>',
    )
    expect(t).toContain('</ans:indicacaoClinica><ans:coberturaEspecial>02</ans:coberturaEspecial><ans:procedimentosSolicitados>')
    expect(t).toContain(
      '</ans:procedimentosSolicitados><ans:dadosExecutante><ans:codigonaOperadora>EXEC01</ans:codigonaOperadora>' +
      '<ans:CNES>7654321</ans:CNES></ans:dadosExecutante><ans:observacao>Paciente em jejum</ans:observacao></ans:solicitacaoSP-SADT>',
    )
  })

  it('reprova sem razão social (nomeContratadoSolicitante é obrigatório)', async () => {
    const req = fakeSpSadtRequest(1)
    req.payload.provider.legal_name = null
    const result = await validate(requestXml(req).xml)
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toMatch(/nomeContratadoSolicitante/)
  })

  it('hash bate com & e < no nome do contratado; sem nome do paciente', () => {
    const req = fakeSpSadtRequest(1)
    req.payload.provider.legal_name = 'Silva & Souza <Clínica>'
    const { xml, hash } = requestXml(req)
    expect(text(xml)).toContain('Silva &amp; Souza &lt;Clínica&gt;')
    expect(hash).toBe(hashFromFile(xml))
    expect(text(xml)).not.toContain('Paciente')
  })

  it('recusa solicitação sem procedimentos', () => {
    expect(() => requestXml(fakeSpSadtRequest(0))).toThrow('solicitação sem procedimentos')
  })
})

describe('Solicitação de Internação (SOLICITACAO_PROCEDIMENTOS)', () => {
  it('é válida com 4 CIDs, 13 procedimentos e observação de 1000 caracteres', async () => {
    const req = fakeHospitalizationRequest(13)
    req.payload.request.cid10 = ['K359', 'R10', 'R509', 'E86']
    req.payload.request.observation = 'x'.repeat(1000)
    const { xml } = requestXml(req)
    expect((await validate(xml)).errors).toEqual([])
    const t = text(xml)
    expect(t).toContain(
      '<ans:solicitacaoProcedimento><ans:solicitacaoInternacao><ans:registroANS>999999</ans:registroANS>' +
      '<ans:numeroGuiaPrestador>42</ans:numeroGuiaPrestador><ans:tipoEtapaAutorizacao>1</ans:tipoEtapaAutorizacao>',
    )
    expect(t).not.toContain('cabecalhoSolicitacao')
    expect(t).toContain(
      '<ans:identificacaoSolicitante><ans:dadosDoContratado><ans:codigoPrestadorNaOperadora>PREST0001</ans:codigoPrestadorNaOperadora>' +
      '</ans:dadosDoContratado><ans:dadosProfissionalContratado>',
    )
    expect(t).not.toContain('nomeContratadoSolicitante')
    expect(t).toContain(
      '<ans:dadosHospitalSolicitado><ans:codigoIndicadonaOperadora>HOSP0001</ans:codigoIndicadonaOperadora>' +
      '<ans:nomeContratadoIndicado>Hospital Fictício</ans:nomeContratadoIndicado>' +
      '<ans:dataSugeridaInternacao>2026-10-20</ans:dataSugeridaInternacao></ans:dadosHospitalSolicitado>',
    )
    expect(t).toContain(
      '<ans:dadosInternacao><ans:caraterAtendimento>1</ans:caraterAtendimento><ans:tipoInternacao>2</ans:tipoInternacao>' +
      '<ans:regimeInternacao>1</ans:regimeInternacao><ans:qtDiariasSolicitadas>3</ans:qtDiariasSolicitadas>' +
      '<ans:indicadorOPME>N</ans:indicadorOPME><ans:indicadorQuimio>N</ans:indicadorQuimio>' +
      '<ans:indicacaoClinica>Apendicite aguda</ans:indicacaoClinica></ans:dadosInternacao>',
    )
    expect(t.match(/<ans:diagnosticoCID>/g)).toHaveLength(4)
    expect(t.match(/<ans:procedimentosSolicitados>/g)).toHaveLength(13)
    expect(t).toContain(`</ans:procedimentosSolicitados><ans:dataSolicitacao>2026-10-05</ans:dataSolicitacao><ans:observacao>${'x'.repeat(1000)}</ans:observacao></ans:solicitacaoInternacao>`)
  })

  it('sem CID emite só o indicador de acidente', async () => {
    const req = fakeHospitalizationRequest(1)
    req.payload.request.cid10 = []
    const { xml } = requestXml(req)
    expect(text(xml)).toContain('<ans:hipotesesDiagnosticas><ans:indicadorAcidente>9</ans:indicadorAcidente></ans:hipotesesDiagnosticas>')
    expect((await validate(xml)).valid).toBe(true)
  })

  it('reprova sem diárias ou sem hospital', async () => {
    const noDays = fakeHospitalizationRequest(1)
    noDays.payload.request.daily_count = null
    expect((await validate(requestXml(noDays).xml)).errors.join('\n')).toMatch(/qtDiariasSolicitadas/)
    const noHospital = fakeHospitalizationRequest(1)
    noHospital.payload.request.hospital.operator_code = null
    expect((await validate(requestXml(noHospital).xml)).errors.join('\n')).toMatch(/codigoIndicadonaOperadora/)
  })

  it('nunca descarta CID nem corta carteirinha: o XSD reprova o excesso', async () => {
    const req = fakeHospitalizationRequest(1)
    req.payload.request.cid10 = ['K359', 'R10', 'R509', 'E86', 'A09']
    req.payload.beneficiary.card_number = '1'.repeat(21)
    const { xml } = requestXml(req)
    const t = text(xml)
    expect(t.match(/<ans:diagnosticoCID>/g)).toHaveLength(5)
    expect(t).toContain(`<ans:numeroCarteira>${'1'.repeat(21)}</ans:numeroCarteira>`)
    const errors = (await validate(xml)).errors.join('\n')
    expect(errors).toMatch(/numeroCarteira/)
    expect(errors).toMatch(/diagnosticoCID|indicadorAcidente/)
  })

  it('indicação clínica com quebras de linha sai com espaços simples; hash bate', async () => {
    const req = fakeHospitalizationRequest(1)
    req.payload.request.clinical_indication = 'Dor em FID\r\nhá 2 dias\t& febre'
    const { xml, hash } = requestXml(req)
    expect(text(xml)).toContain('<ans:indicacaoClinica>Dor em FID há 2 dias &amp; febre</ans:indicacaoClinica>')
    expect(hash).toBe(hashFromFile(xml))
    expect((await validate(xml)).valid).toBe(true)
  })
})

describe('OPME embutido em anexoClinico/solicitacaoOPME', () => {
  it('SP/SADT: anexo entre dadosExecutante e observacao, referenciando a própria guia', async () => {
    const req = fakeSpSadtRequest(1)
    req.payload.request.observation = 'Com OPME'
    const { xml } = requestXml(req, fakeOpmeAnnex(2))
    expect((await validate(xml)).errors).toEqual([])
    const t = text(xml)
    expect(t).toContain(
      '<ans:anexoClinico><ans:solicitacaoOPME><ans:cabecalhoAnexo><ans:registroANS>999999</ans:registroANS>' +
      '<ans:numeroGuiaAnexo>43</ans:numeroGuiaAnexo><ans:numeroGuiaReferenciada>41</ans:numeroGuiaReferenciada>',
    )
    expect(t).toContain('</ans:solicitacaoOPME></ans:anexoClinico><ans:observacao>Com OPME</ans:observacao>')
    expect(t).not.toContain('anexoSolicitacaoOPME')
  })

  it('Internação: anexo por último e indicadorOPME = S mesmo se não marcado', async () => {
    const req = fakeHospitalizationRequest(1)
    req.payload.request.opme_expected = false
    req.payload.request.observation = 'Obs'
    const { xml } = requestXml(req, fakeOpmeAnnex(1))
    expect((await validate(xml)).errors).toEqual([])
    const t = text(xml)
    expect(t).toContain('<ans:indicadorOPME>S</ans:indicadorOPME>')
    expect(t).toContain('<ans:observacao>Obs</ans:observacao><ans:anexoClinico><ans:solicitacaoOPME>')
    expect(t).toContain('</ans:anexoClinico></ans:solicitacaoInternacao>')
  })

  it('recusa OPME embutido sem materiais', () => {
    expect(() => requestXml(fakeSpSadtRequest(1), fakeOpmeAnnex(0))).toThrow('anexo OPME sem materiais')
  })
})
