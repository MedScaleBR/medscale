import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

const createMock = vi.hoisted(() => vi.fn())
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock }
  },
}))

import { interpretMessage } from '@/lib/finance/interpret'

const TREE: FinanceCategoryTree = {
  pf: [
    { id: 'pf-ali', name: 'Alimentação', direction: 'out', sortOrder: 0, isArchived: false, children: [] },
    { id: 'pf-sal', name: 'Salário / Pró-labore', direction: 'in', sortOrder: 0, isArchived: false, children: [] },
  ],
  pj: [
    { id: 'pj-alu', name: 'Aluguel', direction: 'out', sortOrder: 0, isArchived: false, children: [] },
    { id: 'pj-rec', name: 'Consultas particulares', direction: 'in', sortOrder: 0, isArchived: false, children: [] },
  ],
}

interface LancamentoItem {
  tipo: 'pf' | 'pj' | null
  descricao: string | null
  valor: number | null
  categoria: string | null
  subcategoria: string | null
  unidade: string | null
  direcao: 'entrada' | 'saida' | null
}

interface ToolInput {
  intencao: 'lancamento' | 'consulta' | 'confirmar_pagamento' | 'desfazer' | 'ajuda' | 'conversa' | 'desconhecido'
  lancamentos: LancamentoItem[]
  tipo: 'pf' | 'pj' | null
  categoria: string | null
  subcategoria: string | null
  unidade: string | null
  direcao: 'entrada' | 'saida' | null
  mes: string | null
  paciente: string | null
  horario: string | null
  forma_pagamento: string | null
}

const ITEM: LancamentoItem = {
  tipo: 'pf', descricao: 'Mercado', valor: 50,
  categoria: null, subcategoria: null, unidade: null, direcao: 'saida',
}

const BASE_INPUT: ToolInput = {
  intencao: 'lancamento',
  lancamentos: [ { ...ITEM } ],
  tipo: null, categoria: null, subcategoria: null, unidade: null, direcao: null,
  mes: null, paciente: null, horario: null, forma_pagamento: null,
}

function toolResponse(overrides: Partial<ToolInput>) {
  return {
    content: [{ type: 'tool_use', id: 't1', name: 'registrar_intencao', input: { ...BASE_INPUT, ...overrides } }],
  }
}

beforeEach(() => createMock.mockReset())

describe('interpretMessage — direction', () => {
  it('lancamento vira entry com um item em entries[]', async () => {
    createMock.mockResolvedValue(
      toolResponse({ lancamentos: [{ ...ITEM, descricao: 'Mercado', valor: 50, direcao: 'saida' }] })
    )
    const intent = await interpretMessage('gastei 50 no mercado', '2026-09-04', TREE)
    expect(intent).toMatchObject({ kind: 'entry' })
    if (intent.kind !== 'entry') throw new Error('esperava entry')
    expect(intent.entries).toHaveLength(1)
    expect(intent.entries[0]).toMatchObject({ type: 'pf', direction: 'out', amount: 50, description: 'Mercado' })
  })

  it('lancamento sem valor claro (com descrição) vira unknown — comportamento de hoje', async () => {
    createMock.mockResolvedValue(
      toolResponse({ lancamentos: [{ ...ITEM, descricao: 'Mercado', valor: null, direcao: 'saida' }] })
    )
    const intent = await interpretMessage('comprei umas coisas no mercado', '2026-09-04', TREE)
    expect(intent).toMatchObject({ kind: 'unknown' })
  })

  it('lancamento com direcao=entrada vira entry direction=in', async () => {
    createMock.mockResolvedValue(
      toolResponse({ lancamentos: [{ ...ITEM, descricao: 'Aluguel recebido', valor: 3000, direcao: 'entrada' }] })
    )
    const intent = await interpretMessage('recebi 3000 de aluguel', '2026-09-04', TREE)
    expect(intent).toMatchObject({ kind: 'entry' })
    if (intent.kind !== 'entry') throw new Error('esperava entry')
    expect(intent.entries[0]).toMatchObject({ direction: 'in', amount: 3000 })
  })

  it('lancamento com direcao=saida vira entry direction=out', async () => {
    createMock.mockResolvedValue(
      toolResponse({ lancamentos: [{ ...ITEM, descricao: 'Mercado', valor: 50, direcao: 'saida' }] })
    )
    const intent = await interpretMessage('gastei 50 no mercado', '2026-09-04', TREE)
    expect(intent).toMatchObject({ kind: 'entry' })
    if (intent.kind !== 'entry') throw new Error('esperava entry')
    expect(intent.entries[0]).toMatchObject({ direction: 'out', amount: 50 })
  })

  it('lancamento com direcao null vira entry direction=out (default)', async () => {
    createMock.mockResolvedValue(
      toolResponse({ lancamentos: [{ ...ITEM, descricao: null, valor: 30, direcao: null }] })
    )
    const intent = await interpretMessage('30 mercado', '2026-09-04', TREE)
    expect(intent).toMatchObject({ kind: 'entry' })
    if (intent.kind !== 'entry') throw new Error('esperava entry')
    expect(intent.entries[0]).toMatchObject({ direction: 'out' })
  })

  it('consulta com direcao=entrada vira query direction=in', async () => {
    createMock.mockResolvedValue(
      toolResponse({ intencao: 'consulta', direcao: 'entrada', lancamentos: [] })
    )
    const intent = await interpretMessage('quanto recebi esse mês', '2026-09-04', TREE)
    expect(intent).toMatchObject({ kind: 'query', direction: 'in' })
  })

  it('consulta com direcao=saida vira query direction=out', async () => {
    createMock.mockResolvedValue(
      toolResponse({ intencao: 'consulta', direcao: 'saida', lancamentos: [] })
    )
    const intent = await interpretMessage('quanto gastei esse mês', '2026-09-04', TREE)
    expect(intent).toMatchObject({ kind: 'query', direction: 'out' })
  })

  it('confirmar_pagamento não carrega direction (não é entry/query)', async () => {
    createMock.mockResolvedValue(
      toolResponse({
        intencao: 'confirmar_pagamento', direcao: 'entrada', paciente: 'João', lancamentos: [],
      })
    )
    const intent = await interpretMessage('o João pagou a consulta', '2026-09-04', TREE)
    expect(intent).toEqual({ kind: 'confirm_payment', patient: 'João', time: null, method: null })
  })
})

describe('interpretMessage — prompt do sistema', () => {
  it('lista categorias de despesa e receita separadas por pf/pj', async () => {
    createMock.mockResolvedValue(toolResponse({}))
    await interpretMessage('recebi 3000 de aluguel', '2026-09-04', TREE)
    const system = createMock.mock.calls[0][0].system as string
    expect(system).toContain('Categorias de despesa em pf: Alimentação')
    expect(system).toContain('Categorias de receita em pf: Salário / Pró-labore')
    expect(system).toContain('Categorias de despesa em pj: Aluguel')
    expect(system).toContain('Categorias de receita em pj: Consultas particulares')
  })

  it('a ferramenta exige o campo direcao', async () => {
    createMock.mockResolvedValue(toolResponse({}))
    await interpretMessage('recebi 3000 de aluguel', '2026-09-04', TREE)
    const tool = createMock.mock.calls[0][0].tools[0]
    expect(tool.input_schema.required).toContain('direcao')
    expect(tool.input_schema.properties.direcao).toBeDefined()
  })
})

describe('interpretMessage — múltiplos lançamentos', () => {
  it('mensagem com dois gastos vira dois itens em entries', async () => {
    createMock.mockResolvedValue(
      toolResponse({
        lancamentos: [
          { tipo: 'pf', descricao: 'iFood', valor: 35, categoria: null, subcategoria: null, unidade: null, direcao: 'saida' },
          { tipo: 'pf', descricao: 'Uber', valor: 50, categoria: null, subcategoria: null, unidade: null, direcao: 'saida' },
        ],
      })
    )
    const intent = await interpretMessage('gastei 35 no ifood e 50 no uber', '2026-09-04', TREE)
    if (intent.kind !== 'entry') throw new Error('esperava entry')
    expect(intent.entries.map((e) => e.description)).toEqual(['iFood', 'Uber'])
  })

  it('prompt instrui um item por gasto e não manda usar desconhecido para vários', async () => {
    createMock.mockResolvedValue(toolResponse({}))
    await interpretMessage('x', '2026-09-04', TREE)
    const system = createMock.mock.calls[0][0].system as string
    expect(system).toMatch(/um item .*para cada|mais de um lançamento/i)
    expect(system).not.toContain('use "desconhecido" — o registro é de um por vez')
  })
})

describe('interpretMessage — PF/PJ ambíguo retorna null', () => {
  it('tipo null no item passa como type null (não vira pf)', async () => {
    createMock.mockResolvedValue(
      toolResponse({
        lancamentos: [{ tipo: null, descricao: 'aluguel', valor: 2600, categoria: null, subcategoria: null, unidade: null, direcao: 'saida' }],
      })
    )
    const intent = await interpretMessage('gastei 2600 no aluguel', '2026-09-04', TREE)
    if (intent.kind !== 'entry') throw new Error('esperava entry')
    expect(intent.entries[0].type).toBeNull()
  })

  it('prompt tem os três buckets pf/pj/null e não tem o tiebreak clínico antigo', async () => {
    createMock.mockResolvedValue(toolResponse({}))
    await interpretMessage('x', '2026-09-04', TREE)
    const system = createMock.mock.calls[0][0].system as string
    expect(system).toContain('genuinamente ambíguo')
    expect(system).toContain('NÃO chute')
    expect(system).not.toContain('escolha pelo contexto clínico')
  })
})
