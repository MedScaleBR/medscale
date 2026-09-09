import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { summarizeAppointmentForecast, type ForecastAppointment } from '@/lib/revenue/forecast'
import { getDashboardForecast } from '@/lib/revenue/dashboard-forecast'
import { createSupabaseMock } from '@/tests/helpers/supabase-mock'

const appointment = (overrides: Partial<ForecastAppointment> = {}): ForecastAppointment => ({
  type: 'consulta', status: 'agendado', procedure_id: 'p1', procedure_name: 'Consulta clínica',
  price: 250, health_plan: null, ...overrides,
})

describe('previsibilidade de receita', () => {
  it('multiplica consultas por preço, separando procedimentos e descontos', () => {
    const result = summarizeAppointmentForecast([
      appointment(), appointment({ status: 'confirmado' }),
      appointment({ price: 200, status: 'realizado' }),
      appointment({ procedure_id: 'p2', procedure_name: 'Exame', price: 100 }),
    ])
    expect(result.total).toBe(800)
    expect(result.appointments).toBe(4)
    expect(result.rows).toMatchObject([
      { name: 'Consulta clínica', quantity: 2, unitPrice: 250, total: 500 },
      { name: 'Consulta clínica', quantity: 1, unitPrice: 200, total: 200 },
      { name: 'Exame', quantity: 1, unitPrice: 100, total: 100 },
    ])
  })

  it('exclui cancelamentos, faltas e convênios', () => {
    const result = summarizeAppointmentForecast([
      appointment(), appointment({ status: 'cancelado' }), appointment({ status: 'no_show' }),
      appointment({ health_plan: 'Plano A' }),
    ])
    expect(result).toMatchObject({ total: 250, appointments: 1, insurance: 1, missingPrice: 0 })
  })

  it('distingue preço ausente de gratuidade e usa o tipo sem procedimento', () => {
    const result = summarizeAppointmentForecast([
      appointment({ price: null }),
      appointment({ price: 0, procedure_id: null, procedure_name: null, type: 'retorno' }),
      appointment({ price: -1 }), appointment({ price: Number.NaN }),
    ])
    expect(result).toMatchObject({ total: 0, appointments: 4, missingPrice: 3 })
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Retorno', unitPrice: 0, quantity: 1 }),
      expect.objectContaining({ unitPrice: null, quantity: 3 }),
    ]))
  })

  it('soma valores monetários em centavos', () => {
    expect(summarizeAppointmentForecast([
      appointment({ price: 0.1 }), appointment({ price: 0.2 }),
    ]).total).toBe(0.3)
  })

  it('retorna estado vazio sem consultas', () => {
    expect(summarizeAppointmentForecast([])).toEqual({ total: 0, appointments: 0, missingPrice: 0, insurance: 0, rows: [] })
  })
})

describe('busca da previsão mensal', () => {
  it('busca todas as páginas e limita unidades e mês no fuso de São Paulo', async () => {
    const mock = createSupabaseMock({ appointments: { select: [
      { data: Array.from({ length: 1000 }, () => appointment()) },
      { data: [appointment()] },
    ] } })
    const result = await getDashboardForecast(mock.client as unknown as SupabaseClient<Database>, ['w1', 'w2'], new Date('2026-10-01T01:00:00Z'))
    expect(result).toMatchObject({ total: 250250, appointments: 1001 })
    expect(mock.calls).toHaveLength(2)
    for (const call of mock.calls) {
      expect(call.filters).toEqual(expect.arrayContaining([
        ['in', 'workspace_id', ['w1', 'w2']],
        ['gte', 'scheduled_at', '2026-09-01T03:00:00.000Z'],
        ['lt', 'scheduled_at', '2026-10-01T03:00:00.000Z'],
      ]))
    }
    expect(mock.calls[1].filters).toContainEqual(['range', 1000, 1999])
  })

  it('não apresenta um total parcial quando uma página falha', async () => {
    const mock = createSupabaseMock({ appointments: { select: [
      { data: Array.from({ length: 1000 }, () => appointment()) },
      { data: null, error: { message: 'unavailable' } },
    ] } })
    expect(await getDashboardForecast(mock.client as unknown as SupabaseClient<Database>, ['w1'], new Date())).toBeNull()
  })
})
