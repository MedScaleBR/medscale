import type { AppointmentSource, AppointmentStatus, AppointmentType } from '@/types/database'

export interface TodayAgendaItem {
  id: string
  patient_name: string
  patient_phone: string
  scheduled_at: string
  type: AppointmentType
  source: AppointmentSource
  status: AppointmentStatus
}

export interface TrafficChannelStats {
  spend: number
  leads: number
  clicks: number
}

export interface WorkspaceBreakdown {
  workspaceId: string
  appointments: number
  revenue: number
}

export interface DashboardStats {
  appointments: { total: number; bot: number; manual: number }
  revenue: { total: number; confirmed: number; projected: number }
  noShow: { rate: number; total: number }
  todayAgenda: TodayAgendaItem[]
  traffic: Record<string, TrafficChannelStats>
  byWorkspace: WorkspaceBreakdown[]
}
