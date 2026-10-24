import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AUTHORIZATION_STATUS_LABELS } from '@/lib/billing/authorizations/constants'
import type { AuthorizationStatus } from '@/lib/billing/authorizations/types'
import { STATUS_BADGE } from '../GuidesTable'

export const AUTHORIZATION_STATUS_BADGE: Record<AuthorizationStatus, string> = {
  draft: STATUS_BADGE.draft,
  ready: STATUS_BADGE.ready,
  sent: STATUS_BADGE.sent,
  cancelled: STATUS_BADGE.cancelled,
  under_review: 'border-none bg-amber-50 text-amber-600',
  pending_info: 'border-none bg-blue-50 text-blue-700',
  authorized: 'border-none bg-green-100 text-green-800',
  partially_authorized: 'border-none bg-green-50 text-green-600',
  denied: 'border-none bg-red-50 text-red-700',
}

export function AuthorizationStatusBadge({ status, missing = 0 }: { status: AuthorizationStatus; missing?: number }) {
  const label = missing === 1 ? 'pendência' : 'pendências'
  return (
    <span className="flex items-center gap-1.5">
      <Badge className={AUTHORIZATION_STATUS_BADGE[status]}>{AUTHORIZATION_STATUS_LABELS[status]}</Badge>
      {missing > 0 && (
        <span className="flex items-center gap-0.5 text-xs text-amber-700" title={`${missing} ${label}`}>
          <AlertTriangle className="h-3.5 w-3.5" />
          {missing} {label}
        </span>
      )}
    </span>
  )
}
