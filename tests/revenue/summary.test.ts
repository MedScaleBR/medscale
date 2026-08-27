import { describe, it, expect } from 'vitest'
import { summarizeRevenueEntries, buildDailySummaryMessage } from '@/lib/revenue/summary'

const entry = (payment_status: string, amount: number) => ({ payment_status, amount }) as never

describe('summarizeRevenueEntries', () => {
  it('separa previsto / realizado / recebido / pendente e ignora cancelado', () => {
    const totals = summarizeRevenueEntries([
      entry('pending', 100),
      entry('realized', 200),
      entry('paid', 300),
      entry('cancelled', 999),
      entry('refunded', 50),
    ])
    expect(totals.projected).toBe(600) // pending + realized + paid
    expect(totals.realized).toBe(500) // realized + paid
    expect(totals.received).toBe(300) // paid
    expect(totals.pending).toBe(200) // realized só
    expect(totals.counts).toEqual({ pending: 1, realized: 1, paid: 1, cancelled: 1, refunded: 1 })
  })

  it('lida com valores em string (numeric do Postgres)', () => {
    const totals = summarizeRevenueEntries([
      { payment_status: 'paid', amount: '150.50' } as never,
      { payment_status: 'paid', amount: '49.50' } as never,
    ])
    expect(totals.received).toBe(200)
  })
})

describe('buildDailySummaryMessage', () => {
  it('monta o fechamento com pendentes listados', () => {
    const totals = summarizeRevenueEntries([
      entry('paid', 2800),
      entry('realized', 250),
      entry('realized', 150),
    ])
    const msg = buildDailySummaryMessage({
      dateLabel: '15/09/2025',
      totals,
      pendingPatients: [
        { name: 'Ana Lima', amount: 250 },
        { name: 'Carlos Mendes', amount: 150 },
      ],
    })
    expect(msg).toContain('Fechamento de hoje — 15/09/2025')
    expect(msg).toContain('✅ Realizadas: 3 consultas · R$3.200')
    expect(msg).toContain('💰 Recebido: R$2.800')
    expect(msg).toContain('⏳ Pendente: R$400 (2 consultas)')
    expect(msg).toContain('· Ana Lima — R$250')
    expect(msg).toContain('· Carlos Mendes — R$150')
  })

  it('omite a linha de pendentes e a de no-show quando não há', () => {
    const totals = summarizeRevenueEntries([entry('paid', 500)])
    const msg = buildDailySummaryMessage({ dateLabel: '01/01/2026', totals, pendingPatients: [] })
    expect(msg).not.toContain('Pendente')
    expect(msg).not.toContain('No-show')
    expect(msg).toContain('✅ Realizadas: 1 consulta · R$500')
  })

  it('inclui a linha de no-show/cancelado quando há canceladas', () => {
    const totals = summarizeRevenueEntries([entry('paid', 100), entry('cancelled', 100), entry('cancelled', 100)])
    const msg = buildDailySummaryMessage({ dateLabel: '01/01/2026', totals, pendingPatients: [] })
    expect(msg).toContain('❌ No-show/cancelado: 2 consultas')
  })
})
