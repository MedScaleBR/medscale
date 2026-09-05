import { describe, it, expect } from 'vitest'
import { parseCommand } from '@/lib/finance/parser'

describe('parseCommand', () => {
  it('/ajuda e /desfazer', () => {
    expect(parseCommand('/ajuda')).toEqual({ kind: 'help' })
    expect(parseCommand('/desfazer')).toEqual({ kind: 'undo' })
  })

  it('/pf com descrição e valor — despesa (direction out)', () => {
    expect(parseCommand('/pf Netflix 35')).toEqual({
      kind: 'entry', type: 'pf', direction: 'out',
      description: 'Netflix', amount: 35, category: null, subcategory: null, workspaceHint: null,
    })
  })

  it('/pj com valor decimal com vírgula, sem descrição', () => {
    expect(parseCommand('/pj 3500,50')).toEqual({
      kind: 'entry', type: 'pj', direction: 'out',
      description: null, amount: 3500.5, category: null, subcategory: null, workspaceHint: null,
    })
  })

  it('/pf+ registra receita (direction in)', () => {
    expect(parseCommand('/pf+ Aluguel recebido 3000')).toEqual({
      kind: 'entry', type: 'pf', direction: 'in',
      description: 'Aluguel recebido', amount: 3000, category: null, subcategory: null, workspaceHint: null,
    })
  })

  it('/pj+ sem descrição', () => {
    expect(parseCommand('/pj+ 3000')).toEqual({
      kind: 'entry', type: 'pj', direction: 'in',
      description: null, amount: 3000, category: null, subcategory: null, workspaceHint: null,
    })
  })

  it('/resumo pf e /resumo pj — despesa (direction out)', () => {
    expect(parseCommand('/resumo pf')).toEqual({
      kind: 'query', type: 'pf', direction: 'out', category: null, subcategory: null, month: null, workspace: null,
    })
    expect(parseCommand('/resumo pj')).toEqual({
      kind: 'query', type: 'pj', direction: 'out', category: null, subcategory: null, month: null, workspace: null,
    })
  })

  it('/resumo pf+ e /resumo pj+ — receita (direction in)', () => {
    expect(parseCommand('/resumo pf+')).toEqual({
      kind: 'query', type: 'pf', direction: 'in', category: null, subcategory: null, month: null, workspace: null,
    })
    expect(parseCommand('/resumo pj+')).toEqual({
      kind: 'query', type: 'pj', direction: 'in', category: null, subcategory: null, month: null, workspace: null,
    })
  })

  it('case-insensitive e com R$/espaços', () => {
    expect(parseCommand('/PF+ R$ 100')).toEqual({
      kind: 'entry', type: 'pf', direction: 'in',
      description: null, amount: 100, category: null, subcategory: null, workspaceHint: null,
    })
    expect(parseCommand('/RESUMO PJ+')).toEqual({
      kind: 'query', type: 'pj', direction: 'in', category: null, subcategory: null, month: null, workspace: null,
    })
  })

  it('texto livre e comando malformado caem em unknown', () => {
    expect(parseCommand('gastei 50 no mercado')).toEqual({ kind: 'unknown', raw: 'gastei 50 no mercado' })
    expect(parseCommand('/pf sem valor nenhum')).toEqual({ kind: 'unknown', raw: '/pf sem valor nenhum' })
  })
})
