import { describe, it, expect } from 'vitest'
import {
  isModuleVisible,
  pickPrimaryTabs,
  moduleTitleFromPath,
  MODULE_ROUTES,
} from '@/lib/nav/tabs'
import type { ModuleSlug } from '@/lib/session/context'

const ALL: ModuleSlug[] = [
  'dashboard', 'agenda', 'conversations', 'locations', 'schedule',
  'waitlist', 'campaigns', 'patients', 'settings', 'transcriptions',
  'finance', 'revenue_cycle',
]

describe('isModuleVisible', () => {
  it('esconde módulo fora de userModules', () => {
    expect(isModuleVisible('agenda', ['dashboard'], 'owner')).toBe(false)
  })
  it('finance só para owner', () => {
    expect(isModuleVisible('finance', ['finance'], 'owner')).toBe(true)
    expect(isModuleVisible('finance', ['finance'], 'admin')).toBe(false)
    expect(isModuleVisible('finance', ['finance'], 'member')).toBe(false)
  })
  it('revenue_cycle nega member, libera admin/owner', () => {
    expect(isModuleVisible('revenue_cycle', ['revenue_cycle'], 'member')).toBe(false)
    expect(isModuleVisible('revenue_cycle', ['revenue_cycle'], 'admin')).toBe(true)
    expect(isModuleVisible('revenue_cycle', ['revenue_cycle'], 'owner')).toBe(true)
  })
})

describe('pickPrimaryTabs', () => {
  it('as 4 primárias na ordem fixa quando todas visíveis', () => {
    expect(pickPrimaryTabs(ALL, 'owner')).toEqual([
      'dashboard', 'agenda', 'conversations', 'patients',
    ])
  })
  it('pula as não visíveis sem completar com outras', () => {
    expect(pickPrimaryTabs(['dashboard', 'patients'], 'owner')).toEqual([
      'dashboard', 'patients',
    ])
  })
  it('nunca passa de 4', () => {
    expect(pickPrimaryTabs(ALL, 'owner').length).toBeLessThanOrEqual(4)
  })
})

describe('moduleTitleFromPath', () => {
  it('rota exata do módulo', () => {
    expect(moduleTitleFromPath('/dashboard')).toBe('Meu painel')
    expect(moduleTitleFromPath('/bot')).toBe('Conversas')
  })
  it('subrota casa pelo prefixo mais longo', () => {
    expect(moduleTitleFromPath('/pacientes/123')).toBe('Meus pacientes')
    expect(moduleTitleFromPath('/configuracoes/bot')).toBe('Configuração')
  })
  it('rota desconhecida devolve string vazia', () => {
    expect(moduleTitleFromPath('/nao-existe')).toBe('')
  })
})

describe('MODULE_ROUTES', () => {
  it('cobre os mesmos slugs e rótulos de NavLinks', () => {
    expect(MODULE_ROUTES.dashboard).toEqual({ href: '/dashboard', label: 'Meu painel' })
    expect(MODULE_ROUTES.conversations).toEqual({ href: '/bot', label: 'Conversas' })
    expect(MODULE_ROUTES.revenue_cycle).toEqual({ href: '/ciclo-receita', label: 'Ciclo de receita' })
  })
})
