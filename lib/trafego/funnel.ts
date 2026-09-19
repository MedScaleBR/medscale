import type { AttributedLead } from './attribution'

// Funil de conversão dos leads que vieram de anúncio. Puro, como o resto de
// lib/trafego — a página busca, isto conta.

export interface FunnelStep {
  label: string
  value: number
  /** Sempre sobre o total de leads, nunca sobre a etapa anterior. */
  pct: number
}

/** Consulta que chegou a existir na agenda — cancelada e no_show não contam. */
const BOOKED = new Set(['agendado', 'confirmado', 'realizado'])

export function funnelSteps(leads: AttributedLead[]): FunnelStep[] {
  const total = leads.length

  // Cada etapa conta LEADS, não consultas: um lead com três consultas
  // realizadas é um agendamento, não três.
  const booked = leads.filter((lead) => lead.appointments.some((a) => BOOKED.has(a.status))).length
  const attended = leads.filter((lead) =>
    lead.appointments.some((a) => a.status === 'realizado')
  ).length
  const recurring = leads.filter(
    (lead) => lead.appointments.filter((a) => a.status === 'realizado').length >= 2
  ).length

  const step = (label: string, value: number): FunnelStep => ({
    label,
    value,
    // Sem lead não há percentual a mostrar; 0 evita NaN na largura da barra.
    pct: total > 0 ? (value / total) * 100 : 0,
  })

  return [
    step('Leads', total),
    step('Agendamentos', booked),
    step('Consultas realizadas', attended),
    step('Pacientes recorrentes', recurring),
  ]
}
