import { describe, it, expect } from 'vitest'
import {
  formatVisit,
  isUnread,
  matchesFilter,
  sortConversations,
  summarizeVisits,
  type InboxEntry,
} from '@/lib/bot/inbox'

const AGORA = new Date(2026, 2, 10, 12, 0).getTime()

function entry(over: Partial<InboxEntry> = {}): InboxEntry {
  return {
    status: 'open',
    archived_at: null,
    started_at: new Date(2026, 2, 1).toISOString(),
    last_message_at: null,
    unread: false,
    ...over,
  }
}

describe('summarizeVisits', () => {
  const consultas = [
    { patient_phone: '+5511900000001', scheduled_at: new Date(2026, 1, 12, 9, 0).toISOString() },
    { patient_phone: '+5511900000001', scheduled_at: new Date(2026, 2, 5, 9, 0).toISOString() },
    { patient_phone: '+5511900000001', scheduled_at: new Date(2026, 2, 19, 9, 0).toISOString() },
    { patient_phone: '+5511900000001', scheduled_at: new Date(2026, 3, 2, 9, 0).toISOString() },
    { patient_phone: '+5511900000002', scheduled_at: new Date(2026, 3, 8, 14, 30).toISOString() },
  ]

  it('usa a consulta passada mais recente como última quando há várias', () => {
    const visits = summarizeVisits(consultas, AGORA)
    expect(visits.get('+5511900000001')?.last).toBe(new Date(2026, 2, 5, 9, 0).toISOString())
  })

  it('usa a primeira consulta futura como próxima quando há várias', () => {
    const visits = summarizeVisits(consultas, AGORA)
    expect(visits.get('+5511900000001')?.next).toBe(new Date(2026, 2, 19, 9, 0).toISOString())
  })

  it('deixa última nula quando o paciente só tem consulta futura', () => {
    const visits = summarizeVisits(consultas, AGORA)
    expect(visits.get('+5511900000002')).toEqual({
      last: null,
      next: new Date(2026, 3, 8, 14, 30).toISOString(),
    })
  })

  it('não cria entrada para telefone sem consulta', () => {
    expect(summarizeVisits(consultas, AGORA).get('+5511900000003')).toBeUndefined()
  })

  it('ignora consulta com data inválida em vez de quebrar a barra', () => {
    const visits = summarizeVisits(
      [{ patient_phone: '+5511900000009', scheduled_at: 'não é data' }],
      AGORA
    )
    expect(visits.get('+5511900000009')).toBeUndefined()
  })

  it('devolve mapa vazio quando não há consultas', () => {
    expect(summarizeVisits([], AGORA).size).toBe(0)
  })
})

describe('isUnread', () => {
  it('marca como não lida quando o paciente falou por último', () => {
    expect(isUnread('user', 'open')).toBe(true)
    expect(isUnread('user', 'handoff')).toBe(true)
  })

  it('não marca quando a conversa já foi resolvida', () => {
    expect(isUnread('user', 'resolved')).toBe(false)
  })

  it('não marca quando quem falou por último foi o bot ou o sistema', () => {
    expect(isUnread('assistant', 'open')).toBe(false)
    expect(isUnread('system', 'open')).toBe(false)
  })

  it('não marca conversa sem nenhuma mensagem', () => {
    expect(isUnread(undefined, 'open')).toBe(false)
  })
})

describe('formatVisit', () => {
  it('mostra travessão quando não há data', () => {
    expect(formatVisit(null, false)).toBe('—')
    expect(formatVisit('não é data', true)).toBe('—')
  })

  it('mostra só a data quando withTime é falso', () => {
    expect(formatVisit(new Date(2026, 2, 19, 9, 0).toISOString(), false)).toBe('19/03/2026')
  })

  it('mostra data e hora quando withTime é verdadeiro', () => {
    expect(formatVisit(new Date(2026, 2, 19, 9, 0).toISOString(), true)).toBe('19/03/2026 09:00')
  })
})

describe('matchesFilter', () => {
  it('esconde arquivada de todas as abas menos a dela', () => {
    const arquivada = { status: 'open' as const, archived_at: new Date(2026, 2, 1).toISOString() }
    expect(matchesFilter(arquivada, 'all')).toBe(false)
    expect(matchesFilter(arquivada, 'open')).toBe(false)
    expect(matchesFilter(arquivada, 'archived')).toBe(true)
  })

  it('não mostra conversa ativa na aba de arquivadas', () => {
    expect(matchesFilter({ status: 'open', archived_at: null }, 'archived')).toBe(false)
  })

  it('casa a aba pelo status da conversa', () => {
    expect(matchesFilter({ status: 'handoff', archived_at: null }, 'handoff')).toBe(true)
    expect(matchesFilter({ status: 'handoff', archived_at: null }, 'resolved')).toBe(false)
    expect(matchesFilter({ status: 'resolved', archived_at: null }, 'all')).toBe(true)
  })
})

describe('sortConversations', () => {
  const antiga = entry({ last_message_at: new Date(2026, 2, 1, 8, 0).toISOString() })
  const recente = entry({ last_message_at: new Date(2026, 2, 9, 8, 0).toISOString() })
  const antigaNaoLida = entry({
    last_message_at: new Date(2026, 1, 20, 8, 0).toISOString(),
    unread: true,
  })

  it('ordena da mais recente para a mais antiga', () => {
    expect(sortConversations([antiga, recente], 'recent')).toEqual([recente, antiga])
  })

  it('sobe as não lidas quando a ordenação é por não lidas', () => {
    expect(sortConversations([recente, antigaNaoLida], 'unread')).toEqual([antigaNaoLida, recente])
  })

  it('desempata as não lidas pela mais recente', () => {
    const recenteNaoLida = entry({
      last_message_at: new Date(2026, 2, 8, 8, 0).toISOString(),
      unread: true,
    })
    expect(sortConversations([antigaNaoLida, recenteNaoLida], 'unread')).toEqual([
      recenteNaoLida,
      antigaNaoLida,
    ])
  })

  it('cai em started_at quando a conversa não tem mensagem', () => {
    const semMensagem = entry({ started_at: new Date(2026, 2, 15).toISOString() })
    expect(sortConversations([recente, semMensagem], 'recent')).toEqual([semMensagem, recente])
  })

  it('não altera a lista recebida', () => {
    const lista = [antiga, recente]
    sortConversations(lista, 'recent')
    expect(lista).toEqual([antiga, recente])
  })
})
