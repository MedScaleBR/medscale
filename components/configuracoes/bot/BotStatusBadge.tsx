import { Badge } from '@/components/ui/badge'

interface BotStatusBadgeProps {
  isActive: boolean
  whatsappNumber: string | null
}

export function BotStatusBadge({ isActive, whatsappNumber }: BotStatusBadgeProps) {
  if (isActive) {
    return (
      <Badge className="border-none bg-green-50 text-green-700">
        ● Conectado{whatsappNumber ? ` — ${whatsappNumber}` : ''}
      </Badge>
    )
  }
  return <Badge className="border-none bg-[var(--navy-06)] text-[var(--navy)]">Não configurado</Badge>
}
