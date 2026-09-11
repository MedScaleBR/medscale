import { describe, it, expect } from 'vitest'
import { attachBalances, reserveBalance, resolveReserveByName } from '@/lib/finance/reserves'
import type { FinanceReserve, FinanceReserveMovement } from '@/lib/finance/types'

function reserve(partial: Partial<FinanceReserve> = {}): FinanceReserve {
  return {
    id: 'r1',
    account_id: 'a1',
    kind: 'pf',
    name: 'Reserva de emergência',
    archived_at: null,
    created_at: '',
    ...partial,
  }
}

function movement(partial: Partial<FinanceReserveMovement> = {}): FinanceReserveMovement {
  return {
    id: Math.random().toString(36).slice(2),
    reserve_id: 'r1',
    account_id: 'a1',
    amount: 100,
    type: 'deposit',
    source: 'web',
    note: null,
    occurred_at: '2026-09-01',
    created_at: '',
    ...partial,
  }
}

describe('reserveBalance', () => {
  it('soma depósitos e subtrai retiradas', () => {
    const saldo = reserveBalance([
      movement({ amount: 500, type: 'deposit' }),
      movement({ amount: 200, type: 'withdrawal' }),
      movement({ amount: 100, type: 'deposit' }),
    ])
    expect(saldo).toBe(400)
  })

  it('reserva sem movimento tem saldo zero', () => {
    expect(reserveBalance([])).toBe(0)
  })

  it('deixa o saldo ficar negativo em vez de mascarar um lançamento errado', () => {
    expect(reserveBalance([movement({ amount: 50, type: 'withdrawal' })])).toBe(-50)
  })
})

describe('attachBalances', () => {
  it('separa os movimentos por reserva e ordena do mais recente', () => {
    const out = attachBalances(
      [reserve({ id: 'r1' }), reserve({ id: 'r2', name: 'Viagem' })],
      [
        movement({ reserve_id: 'r1', amount: 300, occurred_at: '2026-09-01' }),
        movement({ reserve_id: 'r1', amount: 100, occurred_at: '2026-09-10' }),
        movement({ reserve_id: 'r2', amount: 50 }),
      ]
    )
    expect(out[0].balance).toBe(400)
    expect(out[0].movements[0].occurred_at).toBe('2026-09-10')
    expect(out[1].balance).toBe(50)
  })
})

describe('resolveReserveByName', () => {
  const lista = [reserve({ id: 'r1' }), reserve({ id: 'r2', name: 'Viagem Japão' })]

  it('acha pelo nome exato, ignorando acento e caixa', () => {
    const m = resolveReserveByName(lista, 'RESERVA DE EMERGENCIA')
    expect(m.status).toBe('one')
    expect(m.status === 'one' && m.reserve.id).toBe('r1')
  })

  it('acha por trecho do nome', () => {
    const m = resolveReserveByName(lista, 'emergência')
    expect(m.status === 'one' && m.reserve.id).toBe('r1')
  })

  it('não inventa reserva quando nada casa', () => {
    expect(resolveReserveByName(lista, 'carro novo').status).toBe('none')
  })

  it('ignora reserva arquivada', () => {
    const arquivada = [reserve({ archived_at: '2026-01-01T00:00:00Z' })]
    expect(resolveReserveByName(arquivada, 'emergência').status).toBe('none')
  })

  it('pede desambiguação quando o trecho casa com mais de uma', () => {
    const ambiguas = [
      reserve({ id: 'r1', name: 'Viagem Japão' }),
      reserve({ id: 'r2', name: 'Viagem Chile' }),
    ]
    const m = resolveReserveByName(ambiguas, 'viagem')
    expect(m.status).toBe('many')
    expect(m.status === 'many' && m.reserves).toHaveLength(2)
  })
})
