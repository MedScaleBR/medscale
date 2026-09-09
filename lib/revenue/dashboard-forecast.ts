import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { saoPauloDateOnly, saoPauloMonthRange } from '@/lib/revenue/cycle'
import { summarizeAppointmentForecast, type ForecastAppointment, type RevenueForecast } from '@/lib/revenue/forecast'

export async function getDashboardForecast(
  supabase: SupabaseClient<Database>, workspaceIds: string[], now: Date,
): Promise<RevenueForecast | null> {
  const { startIso, endIso } = saoPauloMonthRange(saoPauloDateOnly(now.toISOString()).slice(0, 7))
  const appointments: ForecastAppointment[] = []
  if (workspaceIds.length === 0) return summarizeAppointmentForecast(appointments)
  // Paginação evita subestimar a previsão ao ultrapassar o limite do Supabase.
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('appointments')
      .select('type, status, procedure_id, procedure_name, price, health_plan')
      .in('workspace_id', workspaceIds)
      .gte('scheduled_at', startIso)
      .lt('scheduled_at', endIso)
      .not('status', 'in', '("cancelado","no_show")')
      .order('id')
      .range(offset, offset + pageSize - 1)
    if (error || !data) return null
    appointments.push(...data)
    if (data.length < pageSize) break
  }
  return summarizeAppointmentForecast(appointments)
}
