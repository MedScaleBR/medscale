import type { AppointmentType, Database } from '@/types/database'

export type ForecastAppointment = Pick<Database['public']['Tables']['appointments']['Row'],
  'type' | 'status' | 'procedure_id' | 'procedure_name' | 'price' | 'health_plan'>

export interface RevenueForecast {
  total: number
  appointments: number
  missingPrice: number
  insurance: number
  rows: { key: string; name: string; quantity: number; unitPrice: number | null; total: number }[]
}

const TYPE_LABELS: Record<AppointmentType, string> = {
  consulta: 'Consulta', retorno: 'Retorno', avaliacao: 'Avaliação',
  procedimento: 'Procedimento', outro: 'Outro',
}

// Usa o preço combinado na consulta, preservando descontos e preços históricos.
// Valores diferentes do mesmo procedimento aparecem em linhas separadas.
export function summarizeAppointmentForecast(appointments: ForecastAppointment[]): RevenueForecast {
  const groups = new Map<string, RevenueForecast['rows'][number]>()
  let missingPrice = 0
  let insurance = 0
  let quantity = 0
  for (const appointment of appointments) {
    if (appointment.status === 'cancelado' || appointment.status === 'no_show') continue
    if (appointment.health_plan?.trim()) {
      insurance++
      continue
    }
    const price = appointment.price == null ? null : Number(appointment.price)
    const cents = price != null && Number.isFinite(price) && price >= 0 ? Math.round(price * 100) : null
    if (cents == null) missingPrice++
    quantity++
    const name = appointment.procedure_name?.trim() || TYPE_LABELS[appointment.type]
    const key = JSON.stringify([appointment.procedure_id, name, cents])
    const row = groups.get(key) ?? { key, name, quantity: 0, unitPrice: cents == null ? null : cents / 100, total: 0 }
    row.quantity++
    // Soma em centavos para evitar erro de ponto flutuante.
    row.total = (row.quantity * (cents ?? 0)) / 100
    groups.set(key, row)
  }
  const rows = [...groups.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'pt-BR'))
  return {
    total: rows.reduce((sum, row) => sum + Math.round(row.total * 100), 0) / 100,
    appointments: quantity, missingPrice, insurance, rows,
  }
}
