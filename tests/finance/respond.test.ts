import { describe, it, expect } from 'vitest'
import {
  buildQueryMessage,
  buildHelpMessage,
  buildChooseTypeMessage,
  buildAskAmountMessage,
  buildUnknownMessage,
  type QueryFilters,
} from '@/lib/finance/respond'

// buildQueryMessage com entries:[] responde de forma determinística (sem
// chamar o Claude) — dá pra testar o texto do escopo por direção sem mock
// do SDK.
const baseFilters: QueryFilters = {
  type: 'pf',
  direction: 'out',
  category: null,
  categoryId: null,
  subcategoryId: null,
  month: null,
  workspaceId: null,
  unitLabel: null,
}

describe('buildQueryMessage — escopo por direção', () => {
  it('despesa PF: "gastos pessoais (PF)"', async () => {
    const msg = await buildQueryMessage([], { ...baseFilters, direction: 'out' })
    expect(msg).toContain('gastos pessoais (PF)')
  })

  it('receita PF: "receitas pessoais (PF)"', async () => {
    const msg = await buildQueryMessage([], { ...baseFilters, direction: 'in' })
    expect(msg).toContain('receitas pessoais (PF)')
  })

  it('receita PJ: "receitas da clínica (PJ)"', async () => {
    const msg = await buildQueryMessage([], { ...baseFilters, type: 'pj', direction: 'in' })
    expect(msg).toContain('receitas da clínica (PJ)')
  })

  it('sem type: "receitas" genérico', async () => {
    const msg = await buildQueryMessage([], { ...baseFilters, type: null, direction: 'in' })
    expect(msg).toContain('Não encontrei receitas')
  })
})

// As duas perguntas do lançamento incompleto são feitas antes de a direção ser
// considerada — chamar "gasto" uma receita ("recebi 500 de consulta") confunde
// o médico logo na pergunta.
describe('buildChooseTypeMessage — direção', () => {
  it('receita: fala em receita, não em gasto', () => {
    const msg = buildChooseTypeMessage('consulta particular', 500, 'in')
    expect(msg).toContain('A receita de consulta particular')
    expect(msg).not.toContain('gasto')
    expect(msg).toContain('é pessoal (PF) ou da clínica (PJ)?')
  })

  it('despesa: mantém "O gasto com …"', () => {
    const msg = buildChooseTypeMessage('aluguel', 2600, 'out')
    expect(msg).toContain('O gasto com aluguel')
    expect(msg).toContain('é pessoal (PF) ou da clínica (PJ)?')
  })

  it('sem descrição e sem valor: cai no genérico, sem "(R$"', () => {
    expect(buildChooseTypeMessage(null, null, 'out')).toContain('O gasto com esse lançamento é pessoal')
    expect(buildChooseTypeMessage(null, null, 'in')).toContain('A receita desse lançamento é pessoal')
    expect(buildChooseTypeMessage(null, null, 'in')).not.toContain('(R$')
  })
})

describe('buildAskAmountMessage — direção', () => {
  it('receita: "Quanto você recebeu de …"', () => {
    const msg = buildAskAmountMessage('consulta particular', 'in')
    expect(msg).toContain('Quanto você recebeu de consulta particular?')
    expect(msg).not.toContain('gasto')
  })

  it('despesa: mantém "Quanto foi o gasto com …"', () => {
    expect(buildAskAmountMessage('almoço', 'out')).toContain('Quanto foi o gasto com almoço?')
  })

  it('sem descrição: genérico por direção', () => {
    expect(buildAskAmountMessage(null, 'in')).toContain('Quanto você recebeu?')
    expect(buildAskAmountMessage(null, 'out')).toContain('Quanto foi esse gasto?')
  })
})

describe('buildHelpMessage', () => {
  it('documenta /pf+ /pj+ /resumo pf+ e exemplos de receita', () => {
    const help = buildHelpMessage()
    expect(help).toContain('/pf+')
    expect(help).toContain('/pj+')
    expect(help).toContain('/resumo pf+')
    expect(help.toLowerCase()).toContain('recebi')
  })
})

describe('buildUnknownMessage', () => {
  it('sério mas com um exemplo concreto e a saída de consulta', () => {
    const m = buildUnknownMessage()
    expect(m).toMatch(/almoço|aluguel/)
    expect(m.toLowerCase()).toContain('quanto gastei')
    expect(m).not.toContain('Não consegui entender')
    expect(m).not.toContain('*') // sem markdown
  })
})
