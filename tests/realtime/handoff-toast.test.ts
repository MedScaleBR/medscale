import { describe, it, expect } from 'vitest'
import { shouldShowHandoffToast } from '@/lib/bot/handoff-toast'

describe('shouldShowHandoffToast — decide se o toast in-app aparece', () => {
  const evt = { conversationId: 'c-1' }

  it('deve mostrar quando o usuário está em outra página do sistema', () => {
    expect(
      shouldShowHandoffToast({ pathname: '/pacientes', openConversationId: null, event: evt })
    ).toBe(true)
  })

  it('deve mostrar quando está no inbox mas com outra conversa aberta', () => {
    expect(
      shouldShowHandoffToast({ pathname: '/bot', openConversationId: 'c-99', event: evt })
    ).toBe(true)
  })

  it('deve mostrar quando está no inbox sem nenhuma conversa aberta', () => {
    expect(
      shouldShowHandoffToast({ pathname: '/bot', openConversationId: null, event: evt })
    ).toBe(true)
  })

  it('NÃO deve mostrar quando está no inbox com exatamente a conversa da mensagem aberta', () => {
    expect(
      shouldShowHandoffToast({ pathname: '/bot', openConversationId: 'c-1', event: evt })
    ).toBe(false)
  })
})
