import { describe, it, expect } from 'vitest'
import { hasTissIdentity } from '@/lib/billing/insurer'

describe('hasTissIdentity', () => {
  it('exige registro ANS e código do prestador preenchidos', () => {
    expect(hasTissIdentity({ ans_registry: '123456', provider_code: 'P1' })).toBe(true)
    expect(hasTissIdentity({ ans_registry: null, provider_code: 'P1' })).toBe(false)
    expect(hasTissIdentity({ ans_registry: '123456', provider_code: null })).toBe(false)
    expect(hasTissIdentity({ ans_registry: '', provider_code: '' })).toBe(false)
  })
})
