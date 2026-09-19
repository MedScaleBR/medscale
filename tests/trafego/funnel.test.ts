import { describe, it, expect } from 'vitest'
import { funnelSteps } from '@/lib/trafego/funnel'
import type { AttributedLead } from '@/lib/trafego/attribution'

const lead = (statuses: string[]): AttributedLead => ({
  campaignId: 'c1',
  campaignName: 'x',
  channel: 'facebook',
  patientPhone: '+551199',
  leadAt: '2026-09-01T10:00:00Z',
  appointments: statuses.map((status) => ({ status, scheduledAt: '2026-09-05T10:00:00Z' })),
  paidRevenue: 0,
  forecastRevenue: 0,
})

describe('funnelSteps', () => {
  it('conta cada etapa uma vez por lead, não por consulta', () => {
    // Um lead com três consultas realizadas não são três agendamentos.
    const steps = funnelSteps([lead(['realizado', 'realizado', 'realizado'])])

    expect(steps.map((s) => s.value)).toEqual([1, 1, 1, 1])
  })

  it('cancelada e no_show não contam como agendamento', () => {
    const steps = funnelSteps([lead(['cancelado']), lead(['no_show'])])

    expect(steps[1].value).toBe(0)
  })

  it('recorrente exige duas consultas realizadas', () => {
    const steps = funnelSteps([lead(['realizado'])])

    expect(steps[3].value).toBe(0)
  })

  it('o percentual é sempre sobre o total de leads, não sobre a etapa anterior', () => {
    const steps = funnelSteps([lead(['realizado']), lead([]), lead([]), lead([])])

    expect(steps[2].pct).toBe(25)
  })

  it('sem lead nenhum devolve quatro etapas zeradas, não uma lista vazia', () => {
    expect(funnelSteps([])).toHaveLength(4)
    expect(funnelSteps([])[0].pct).toBe(0)
  })

  it('agendado e confirmado contam como agendamento', () => {
    const steps = funnelSteps([lead(['agendado']), lead(['confirmado'])])

    expect(steps[1].value).toBe(2)
    // Nenhuma aconteceu ainda.
    expect(steps[2].value).toBe(0)
  })

  it('rotula as quatro etapas na ordem do funil', () => {
    expect(funnelSteps([]).map((s) => s.label)).toEqual([
      'Leads',
      'Agendamentos',
      'Consultas realizadas',
      'Pacientes recorrentes',
    ])
  })
})
