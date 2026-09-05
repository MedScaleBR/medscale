import { describe, it, expect } from 'vitest'
import { buildQueryMessage, buildHelpMessage, type QueryFilters } from '@/lib/finance/respond'

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

describe('buildHelpMessage', () => {
  it('documenta /pf+ /pj+ /resumo pf+ e exemplos de receita', () => {
    const help = buildHelpMessage()
    expect(help).toContain('/pf+')
    expect(help).toContain('/pj+')
    expect(help).toContain('/resumo pf+')
    expect(help.toLowerCase()).toContain('recebi')
  })
})
