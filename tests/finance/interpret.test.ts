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

interface ToolInput {
  intencao: 'lancamento' | 'consulta' | 'confirmar_pagamento' | 'desfazer' | 'ajuda' | 'conversa' | 'desconhecido'
  tipo: 'pf' | 'pj' | null
  descricao: string | null
  valor: number | null
  categoria: string | null
  subcategoria: string | null
  mes: string | null
  unidade: string | null
  paciente: string | null
  horario: string | null
  forma_pagamento: string | null
  direcao: 'entrada' | 'saida' | null
}

const BASE_INPUT: ToolInput = {
  intencao: 'lancamento',
  tipo: 'pf',
  descricao: 'Aluguel recebido',
  valor: 3000,
  categoria: null,
  subcategoria: null,
  mes: null,
  unidade: null,
  paciente: null,
  horario: null,
  forma_pagamento: null,
  direcao: 'entrada',
}

function toolResponse(overrides: Partial<ToolInput>) {
  return {
    content: [{ type: 'tool_use', id: 't1', name: 'registrar_intencao', input: { ...BASE_INPUT, ...overrides } }],
  }
}

beforeEach(() => createMock.mockReset())

describe('interpretMessage — direction', () => {
  it('lancamento com direcao=entrada vira entry direction=in', async () => {
    createMock.mockResolvedValue(toolResponse({ direcao: 'entrada' }))
    const intent = await interpretMessage('recebi 3000 de aluguel', '2026-09-04', TREE)
    expect(intent).toMatchObject({ kind: 'entry', direction: 'in', amount: 3000 })
  })

  it('lancamento com direcao=saida vira entry direction=out', async () => {
    createMock.mockResolvedValue(toolResponse({ direcao: 'saida', descricao: 'Mercado', valor: 50 }))
    const intent = await interpretMessage('gastei 50 no mercado', '2026-09-04', TREE)
    expect(intent).toMatchObject({ kind: 'entry', direction: 'out', amount: 50 })
  })

  it('lancamento com direcao null vira entry direction=out (default)', async () => {
    createMock.mockResolvedValue(toolResponse({ direcao: null }))
    const intent = await interpretMessage('30 mercado', '2026-09-04', TREE)
    expect(intent).toMatchObject({ kind: 'entry', direction: 'out' })
  })

  it('consulta com direcao=entrada vira query direction=in', async () => {
    createMock.mockResolvedValue(
      toolResponse({ intencao: 'consulta', direcao: 'entrada', descricao: null, valor: null })
    )
    const intent = await interpretMessage('quanto recebi esse mês', '2026-09-04', TREE)
    expect(intent).toMatchObject({ kind: 'query', direction: 'in' })
  })

  it('consulta com direcao=saida vira query direction=out', async () => {
    createMock.mockResolvedValue(
      toolResponse({ intencao: 'consulta', direcao: 'saida', descricao: null, valor: null })
    )
    const intent = await interpretMessage('quanto gastei esse mês', '2026-09-04', TREE)
    expect(intent).toMatchObject({ kind: 'query', direction: 'out' })
  })

  it('confirmar_pagamento não carrega direction (não é entry/query)', async () => {
    createMock.mockResolvedValue(
      toolResponse({
        intencao: 'confirmar_pagamento', direcao: 'entrada', paciente: 'João', descricao: null, valor: null,
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
