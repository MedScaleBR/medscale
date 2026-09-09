import { describe, it, expect } from 'vitest'
import {
  buildQueryMessage,
  buildHelpMessage,
  buildChooseTypeMessage,
  buildAskAmountMessage,
  buildUnknownMessage,
  buildBatchConfirmationMessage,
  type QueryFilters,
  type BatchTotal,
} from '@/lib/finance/respond'
import type { FinanceEntry } from '@/lib/finance/types'

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

// A confirmação em lote é o único retorno que o médico tem do que entrou —
// o formato é contrato: uma linha por lançamento gravado, depois uma linha de
// total por bucket (tipo + direção) tocado, nada de markdown.
describe('buildBatchConfirmationMessage', () => {
  // Intl separa "R$" do número com espaço não-quebrável — literal com espaço
  // comum não casa.
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  function entry(over: Partial<FinanceEntry>): FinanceEntry {
    return {
      id: 'e', account_id: 'acc1', workspace_id: null, recorded_by_phone: '5511',
      type: 'pf', direction: 'out', description: 'x', amount: 10,
      category: null, category_id: null, subcategory_id: null,
      raw_message: 'x', entry_date: '2026-09-08', revenue_entry_id: null, created_at: '',
      ...over,
    }
  }

  const entries: FinanceEntry[] = [
    entry({ type: 'pf', direction: 'out', description: 'iFood', amount: 35 }),
    entry({ type: 'pj', direction: 'out', description: 'Material', amount: 400 }),
    entry({ type: 'pf', direction: 'in', description: 'Aluguel recebido', amount: 3000 }),
  ]
  const totals: BatchTotal[] = [
    { type: 'pf', direction: 'out', total: 1230 },
    { type: 'pj', direction: 'out', total: 8000 },
    { type: 'pf', direction: 'in', total: 3000 },
  ]

  it('uma linha por lançamento e uma linha de total por bucket', () => {
    const msg = buildBatchConfirmationMessage(entries, totals)
    expect(msg).toContain('Registrei 3 lançamentos')

    const bullets = msg.split('\n').filter((l) => l.startsWith('• '))
    expect(bullets).toHaveLength(3)
    expect(bullets[0]).toBe(`• iFood — ${brl(35)} (PF, despesa)`)
    expect(bullets[1]).toBe(`• Material — ${brl(400)} (PJ, despesa)`)
    expect(bullets[2]).toBe(`• Aluguel recebido — ${brl(3000)} (PF, receita)`)

    const totalLines = msg.split('\n').filter((l) => /^(Despesas|Receitas) (PF|PJ) em /.test(l))
    expect(totalLines).toHaveLength(3)
    expect(totalLines[0]).toContain('Despesas PF')
    expect(totalLines[0]).toContain(brl(1230))
    expect(totalLines[1]).toContain('Despesas PJ')
    expect(totalLines[1]).toContain(brl(8000))
    expect(totalLines[2]).toContain('Receitas PF')
    expect(totalLines[2]).toContain(brl(3000))
  })

  it('sem markdown', () => {
    const msg = buildBatchConfirmationMessage(entries, totals)
    expect(msg).not.toContain('*')
    expect(msg).not.toContain('_')
  })

  it('lançamento sem descrição não vira linha vazia', () => {
    const msg = buildBatchConfirmationMessage(
      [entry({ description: null, amount: 12 }), entry({ description: 'Uber', amount: 20 })],
      [{ type: 'pf', direction: 'out', total: 32 }]
    )
    expect(msg).toContain(`• Sem descrição — ${brl(12)} (PF, despesa)`)
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
