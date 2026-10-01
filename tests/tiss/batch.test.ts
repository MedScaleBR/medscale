import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { buildBatch, validate } from '@/lib/tiss/v4_03_00/batch'
import { epilogueHash } from '@/lib/tiss/v4_03_00/hash'
import { el, toLatin1Text, centsToDecimal } from '@/lib/tiss/xml'
import { sanitizeValidatorMessage } from '@/lib/tiss/validate'
import { fakeGuides, fakePayload, FAKE_INSURER, FIXED_NOW } from './fixtures'

function batch(count: number, guideType: 'consulta' | 'sp_sadt' = 'consulta') {
  return buildBatch({
    batchNumber: 7,
    guideType,
    insurer: FAKE_INSURER,
    guides: fakeGuides(count, guideType),
    now: FIXED_NOW,
  })
}

// Recalcula o hash direto do arquivo, sem passar pela árvore: tira as tags
// de tudo entre <cabecalho> e o fim de <prestadorParaOperadora> e aplica o MD5
// sobre os bytes ISO-8859-1. Se o gerador e esta leitura "burra" do arquivo
// concordarem, o hash confere com o que a operadora vai recalcular.
function hashFromFile(xml: Buffer): string {
  const text = xml.toString('latin1')
  const start = text.indexOf('<ans:cabecalho>')
  const end = text.indexOf('<ans:epilogo>')
  const content = text
    .slice(start, end)
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
  return createHash('md5').update(Buffer.from(content, 'latin1')).digest('hex')
}

describe('lote TISS 4.03.00 — geração e validação contra o XSD da ANS', () => {
  it('deve gerar lote de 3 guias de consulta válido contra o XSD 4.03.00', async () => {
    const { xml } = batch(3)
    const result = await validate(xml)

    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    expect(xml.toString('latin1').match(/<ans:guiaConsulta>/g)).toHaveLength(3)
  })

  it('deve gerar lote SP/SADT válido contra o XSD 4.03.00', async () => {
    const result = await validate(batch(2, 'sp_sadt').xml)

    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('deve incluir dadosAutorizacao na SP/SADT quando há data de autorização', async () => {
    const guides = fakeGuides(1, 'sp_sadt')
    guides[0].payload.service.authorization_number = 'SENHA123'
    guides[0].payload.service.authorization_date = '2026-09-20'
    const { xml } = buildBatch({ batchNumber: 1, guideType: 'sp_sadt', insurer: FAKE_INSURER, guides, now: FIXED_NOW })

    expect(xml.toString('latin1')).toContain(
      '<ans:dadosAutorizacao><ans:dataAutorizacao>2026-09-20</ans:dataAutorizacao><ans:senha>SENHA123</ans:senha></ans:dadosAutorizacao>',
    )
    expect((await validate(xml)).valid).toBe(true)
  })

  it('deve gravar data e hora da transação no fuso de São Paulo', () => {
    const text = batch(1).xml.toString('latin1')

    expect(text).toContain('<ans:dataRegistroTransacao>2026-09-29</ans:dataRegistroTransacao>')
    expect(text).toContain('<ans:horaRegistroTransacao>18:30:00</ans:horaRegistroTransacao>')
  })

  it('deve codificar o arquivo em ISO-8859-1 e converter a UF para o código IBGE', () => {
    const text = batch(1, 'sp_sadt').xml.toString('latin1')

    expect(text.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe(true)
    expect(text).toContain('Clínica Fictícia São João Ltda')
    expect(text).toContain('<ans:UF>35</ans:UF>')
    expect(text).toContain('<ans:numeroConselhoProfissional>123456</ans:numeroConselhoProfissional>')
  })

  it('não deve incluir nome do paciente nem CID no XML', () => {
    const text = batch(1).xml.toString('latin1')

    expect(text).not.toContain('Paciente Fictício')
    expect(text).not.toContain('J06.9')
  })

  it('deve recusar lote vazio, com mais de 100 guias ou com tipos misturados', () => {
    expect(() => batch(0)).toThrow()
    expect(() => batch(101)).toThrow()
    const mixed = [...fakeGuides(1, 'consulta'), ...fakeGuides(1, 'sp_sadt')]
    expect(() =>
      buildBatch({ batchNumber: 1, guideType: 'consulta', insurer: FAKE_INSURER, guides: mixed, now: FIXED_NOW }),
    ).toThrow()
  })

  it('deve reprovar na validação um XML com campo obrigatório vazio, sem vazar o valor', async () => {
    const guides = fakeGuides(1)
    guides[0].payload.professional.crm_uf = null // UF vazia não está em dm_UF
    guides[0].payload.service.tuss_code = 'CARTEIRA-00001111' // > 10 posições
    const { xml } = buildBatch({ batchNumber: 1, guideType: 'consulta', insurer: FAKE_INSURER, guides, now: FIXED_NOW })

    const result = await validate(xml)

    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.join('\n')).not.toContain('CARTEIRA-00001111')
    expect(result.errors.join('\n')).toMatch(/UF|codigoProcedimento/)
  })
})

describe('hash do epílogo', () => {
  it('deve ser o MD5 da concatenação dos valores, sem tags', () => {
    const tree = [el('a', [el('b', 'ab'), el('c', 'cd')])]

    expect(epilogueHash(tree)).toBe(createHash('md5').update('abcd').digest('hex'))
  })

  it('deve usar os bytes ISO-8859-1, não UTF-8', () => {
    const latin1 = createHash('md5').update(Buffer.from('ção', 'latin1')).digest('hex')
    const utf8 = createHash('md5').update(Buffer.from('ção', 'utf8')).digest('hex')

    expect(epilogueHash([el('x', 'ção')])).toBe(latin1)
    expect(epilogueHash([el('x', 'ção')])).not.toBe(utf8)
  })

  it('deve bater com o hash recalculado a partir do arquivo gerado', () => {
    const { xml, hash } = batch(3)

    expect(hash).toMatch(/^[0-9a-f]{32}$/)
    expect(hash).toBe(hashFromFile(xml))
    expect(xml.toString('latin1')).toContain(`<ans:epilogo><ans:hash>${hash}</ans:hash></ans:epilogo>`)
  })

  it('deve continuar batendo com caracteres escapados no XML (&)', () => {
    const guides = fakeGuides(1, 'sp_sadt')
    guides[0].payload.provider.legal_name = 'Silva & Souza <Clínica>'
    const { xml, hash } = buildBatch({ batchNumber: 1, guideType: 'sp_sadt', insurer: FAKE_INSURER, guides, now: FIXED_NOW })

    expect(xml.toString('latin1')).toContain('Silva &amp; Souza &lt;Clínica&gt;')
    expect(hash).toBe(hashFromFile(xml))
  })
})

describe('helpers de XML', () => {
  it('deve converter centavos para decimal sem float', () => {
    expect(centsToDecimal(15050)).toBe('150.50')
    expect(centsToDecimal(5)).toBe('0.05')
    expect(centsToDecimal(0)).toBe('0.00')
    expect(centsToDecimal(123456789)).toBe('1234567.89')
  })

  it('deve manter acentos Latin-1 e rebaixar os de fora para a letra base', () => {
    expect(toLatin1Text('João Ávila')).toBe('João Ávila')
    expect(toLatin1Text('Erdős')).toBe('Erdos')
    expect(toLatin1Text('linha1\nlinha2')).toBe('linha1linha2')
  })

  it('deve tirar valores e namespaces das mensagens do validador', () => {
    const raw =
      "Schemas validity error : Element '{http://www.ans.gov.br/padroes/tiss/schemas}numeroCarteira': [facet 'maxLength'] The value '000011112222333344445555' has a length of '24'; this exceeds the allowed maximum length of '20'."

    const clean = sanitizeValidatorMessage(raw)

    expect(clean).toContain('numeroCarteira')
    expect(clean).toContain('[facet maxLength]')
    expect(clean).not.toContain('000011112222333344445555')
    expect(clean).not.toContain('http://')
  })

  it('deve esconder também valores só com letras', () => {
    const raw =
      "Schemas validity error : Element '{http://www.ans.gov.br/padroes/tiss/schemas}numeroCarteira': 'MARIASILVA' is not a valid value of the atomic type '{http://www.ans.gov.br/padroes/tiss/schemas}st_texto20'."

    const clean = sanitizeValidatorMessage(raw)

    expect(clean).not.toContain('MARIASILVA')
    expect(clean).toContain('numeroCarteira')
  })

  it('não deve deixar o nome do beneficiário no payload chegar ao XML de SP/SADT', () => {
    const payload = fakePayload({ guide_type: 'sp_sadt', name: 'Nome Secreto' })
    const { xml } = buildBatch({
      batchNumber: 1,
      guideType: 'sp_sadt',
      insurer: FAKE_INSURER,
      guides: [{ id: 'g1', provider_guide_number: '1', guide_type: 'sp_sadt', payload }],
      now: FIXED_NOW,
    })
    expect(xml.toString('latin1')).not.toContain('Nome Secreto')
  })
})
