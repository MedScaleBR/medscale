import { describe, it, expect } from 'vitest'
import { createSupabaseMock } from '../helpers/supabase-mock'
import { getAccountCostDetail, pickAccountId } from '@/lib/admin/account-cost-detail'
import { parseCostWindow, windowFromDays } from '@/lib/admin/cost-range'

const now = new Date('2026-11-12T15:00:00Z')

describe('getAccountCostDetail', () => {
  it('filtra pelo cliente e agrega', async () => {
    const s = createSupabaseMock({
      cost_events: {
        select: {
          data: [
            {
              provider: 'claude_agendamento',
              cost_brl: '1.5000',
              workspace_id: null,
              related_id: 'c1',
              quantity: null,
              created_at: '2026-11-10T15:00:00Z',
              workspaces: null,
            },
          ],
        },
      },
    })
    const r = await getAccountCostDetail(s.client as never, 'acc1', windowFromDays(7, now), now)
    const f = s.callsTo('cost_events', 'select')[0].filters
    expect(f).toContainEqual(['eq', 'account_id', 'acc1'])
    expect(f.some((x) => x[0] === 'lt')).toBe(false)
    expect(f).toContainEqual(['order', 'created_at'])
    expect(f).toContainEqual(['order', 'id'])
    expect(r.detail.total).toBe(1.5)
    expect(r.truncated).toBe(false)
    expect(r.error).toBeNull()
  })

  it('intervalo personalizado limita o fim', async () => {
    const s = createSupabaseMock({ cost_events: { select: { data: [] } } })
    await getAccountCostDetail(s.client as never, 'acc1', parseCostWindow({ from: '2026-11-11', to: '2026-11-11' }, now), now)
    const f = s.callsTo('cost_events', 'select')[0].filters
    expect(f).toContainEqual(['gte', 'created_at', '2026-11-11T03:00:00.000Z'])
    expect(f).toContainEqual(['lt', 'created_at', '2026-11-12T03:00:00.000Z'])
  })

  it('erro da consulta vem em error', async () => {
    const s = createSupabaseMock({ cost_events: { select: { data: null, error: { message: 'boom' } } } })
    const r = await getAccountCostDetail(s.client as never, 'acc1', windowFromDays(7, now), now)
    expect(r.error).toBe('boom')
    expect(r.detail.total).toBe(0)
  })
})

describe('pickAccountId', () => {
  const accounts = [{ accountId: '11111111-1111-4111-8111-111111111111' }, { accountId: '22222222-2222-4222-8222-222222222222' }]
  it('sem parâmetro, o cliente mais caro', () => {
    expect(pickAccountId(undefined, accounts)).toBe(accounts[0].accountId)
  })
  it('vazio ou lixo também cai no mais caro', () => {
    expect(pickAccountId('', accounts)).toBe(accounts[0].accountId)
    expect(pickAccountId('abc', accounts)).toBe(accounts[0].accountId)
  })
  it('repetido na URL usa o primeiro', () => {
    expect(pickAccountId([accounts[1].accountId, 'x'], accounts)).toBe(accounts[1].accountId)
  })
  it('uuid válido fora da lista é mantido (cliente sem custo no período)', () => {
    expect(pickAccountId('33333333-3333-4333-8333-333333333333', accounts)).toBe('33333333-3333-4333-8333-333333333333')
  })
  it('sem clientes e sem parâmetro válido, null', () => {
    expect(pickAccountId('abc', [])).toBeNull()
  })
})
