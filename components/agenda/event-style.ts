import type { CSSProperties } from 'react'
import { PENDING_EXTERNAL_STATUS, type AppointmentSource, type AppointmentStatus } from '@/types/database'

export const PENDING_LEGEND_LABEL = 'Aguardando clínica'

// Pendente de confirmação da clínica parceira: laranja tracejado, igual em
// qualquer unidade/origem, para não se confundir com consulta confirmada.
export const PENDING_EVENT_STYLE: CSSProperties = {
  backgroundColor: '#fff7ed',
  color: '#9a3412',
  border: '1px dashed #f97316',
  borderRadius: 6,
}

export function appointmentEventStyle(
  a: { status: AppointmentStatus; source: AppointmentSource; workspace_id: string | null },
  opts: { multiUnit: boolean; unitColor?: string }
): CSSProperties {
  if (a.status === PENDING_EXTERNAL_STATUS) return { ...PENDING_EVENT_STYLE }
  // Cor por unidade quando há mais de uma; senão, o realce bot/manual.
  const bg = opts.multiUnit && opts.unitColor ? opts.unitColor : a.source === 'bot' ? 'var(--cyan)' : 'var(--navy)'
  return {
    backgroundColor: bg,
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    // realce sutil para consultas marcadas pela Clara
    boxShadow: a.source === 'bot' ? 'inset 3px 0 0 rgba(255,255,255,0.7)' : undefined,
  }
}
