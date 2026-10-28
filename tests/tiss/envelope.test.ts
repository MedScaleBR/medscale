import { describe, it, expect } from 'vitest'
import { cabecalho, mensagemTISS } from '@/lib/tiss/v4_03_00/envelope'
import { el, serialize } from '@/lib/tiss/xml'
import { epilogueHash } from '@/lib/tiss/v4_03_00/hash'
import { FAKE_INSURER, FIXED_NOW } from './fixtures'

describe('envelope mensagemTISS', () => {
  it('monta o cabecalho com o tipo de transação pedido, no fuso de São Paulo', () => {
    const head = cabecalho({ tipoTransacao: 'SOLICITACAO_PROCEDIMENTOS', sequencialTransacao: '41', now: FIXED_NOW, insurer: FAKE_INSURER })
    expect(serialize(head).toString('latin1')).toContain(
      '<ans:identificacaoTransacao><ans:tipoTransacao>SOLICITACAO_PROCEDIMENTOS</ans:tipoTransacao>' +
      '<ans:sequencialTransacao>41</ans:sequencialTransacao><ans:dataRegistroTransacao>2026-09-29</ans:dataRegistroTransacao>' +
      '<ans:horaRegistroTransacao>18:30:00</ans:horaRegistroTransacao></ans:identificacaoTransacao>' +
      '<ans:origem><ans:identificacaoPrestador><ans:codigoPrestadorNaOperadora>PREST0001</ans:codigoPrestadorNaOperadora>' +
      '</ans:identificacaoPrestador></ans:origem><ans:destino><ans:registroANS>999999</ans:registroANS></ans:destino>' +
      '<ans:Padrao>4.03.00</ans:Padrao>',
    )
  })

  it('o epílogo leva o hash de cabecalho + corpo', () => {
    const head = cabecalho({ tipoTransacao: 'ENVIO_ANEXO', sequencialTransacao: '1', now: FIXED_NOW, insurer: FAKE_INSURER })
    const body = el('prestadorParaOperadora', [el('x', 'y')])
    const { xml, hash } = mensagemTISS(head, body)
    expect(hash).toBe(epilogueHash([head, body]))
    expect(xml.toString('latin1')).toContain(`<ans:epilogo><ans:hash>${hash}</ans:hash></ans:epilogo></ans:mensagemTISS>`)
  })
})
