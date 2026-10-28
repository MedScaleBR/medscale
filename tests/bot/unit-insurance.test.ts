import { describe, it, expect } from 'vitest'
import {
  buildCoverageByUnit,
  coverageProblem,
  coverageSummary,
  isUniformCoverage,
  mergeCoverages,
} from '@/lib/bot/unit-insurance'

const unimed = { id: 'i1', name: 'Unimed' }
const amil = { id: 'i2', name: 'Amil' }

describe('buildCoverageByUnit', () => {
  it('liga cada convênio só às unidades marcadas', () => {
    const c = buildCoverageByUnit(
      [{ id: 'w1', acceptsPrivate: false }, { id: 'w2', acceptsPrivate: true }],
      [{ ...unimed, workspaceIds: ['w2'] }, { ...amil, workspaceIds: ['w1', 'w2'] }],
      true
    )
    expect(c.w1).toEqual({ acceptsPrivate: false, insurers: [amil] })
    expect(c.w2).toEqual({ acceptsPrivate: true, insurers: [unimed, amil] })
  })

  it('sem migration aplicada: particular da account e convênio em todas as unidades', () => {
    const c = buildCoverageByUnit([{ id: 'w1' }, { id: 'w2', acceptsPrivate: null }], [{ ...unimed, workspaceIds: null }], false)
    expect(c.w1).toEqual({ acceptsPrivate: false, insurers: [unimed] })
    expect(c.w2).toEqual({ acceptsPrivate: false, insurers: [unimed] })
  })
})

describe('mergeCoverages / isUniformCoverage', () => {
  it('junta o que alguma unidade aceita', () => {
    expect(mergeCoverages([{ acceptsPrivate: false, insurers: [unimed] }, { acceptsPrivate: true, insurers: [amil, unimed] }])).toEqual({
      acceptsPrivate: true,
      insurers: [amil, unimed],
    })
  })

  it('compara convênios sem depender da ordem', () => {
    expect(isUniformCoverage([{ acceptsPrivate: true, insurers: [unimed, amil] }, { acceptsPrivate: true, insurers: [amil, unimed] }])).toBe(true)
    expect(isUniformCoverage([{ acceptsPrivate: true, insurers: [unimed] }, { acceptsPrivate: false, insurers: [unimed] }])).toBe(false)
  })
})

describe('coverageSummary', () => {
  it.each([
    [{ acceptsPrivate: true, insurers: [] }, 'Atendimento apenas particular (sem convênios).'],
    [{ acceptsPrivate: true, insurers: [unimed] }, 'Convênios aceitos: Unimed. Também atende particular.'],
    [{ acceptsPrivate: false, insurers: [unimed] }, 'Convênios aceitos: Unimed. Não atende particular.'],
    [{ acceptsPrivate: false, insurers: [] }, 'Consulte a equipe para informações sobre convênios.'],
  ])('%j', (coverage, text) => {
    expect(coverageSummary(coverage)).toBe(text)
  })
})

describe('coverageProblem', () => {
  const c = { acceptsPrivate: false, insurers: [unimed] }
  it('recusa particular e convênio que a unidade não aceita', () => {
    expect(coverageProblem(c, 'Centro', null)).toBe('A unidade Centro não atende particular.')
    expect(coverageProblem(c, 'Centro', 'i2')).toBe('A unidade Centro não aceita este convênio.')
    expect(coverageProblem(c, 'Centro', 'i1')).toBeNull()
  })
})
