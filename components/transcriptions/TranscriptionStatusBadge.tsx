import { Badge } from '@/components/ui/badge'
import type { TranscriptionStatus } from '@/types/database'

const STATUS_LABEL: Record<TranscriptionStatus, string> = {
  pending: 'Na fila',
  transcribing: 'Transcrevendo',
  transcribed: 'Transcrito',
  generating: 'Gerando prontuário',
  draft_ready: 'Aguardando revisão',
  signed: 'Assinado',
  error: 'Erro',
}

const STATUS_CLASS: Record<TranscriptionStatus, string> = {
  pending: 'border-none bg-[var(--navy-06)] text-[var(--navy)]',
  transcribing: 'border-none bg-[var(--cyan-10)] text-[var(--cyan-dark)]',
  transcribed: 'border-none bg-[var(--cyan-10)] text-[var(--cyan-dark)]',
  generating: 'border-none bg-[var(--cyan-10)] text-[var(--cyan-dark)]',
  draft_ready: 'border-none bg-amber-100 text-amber-800',
  signed: 'border-none bg-emerald-100 text-emerald-800',
  error: 'border-none bg-red-100 text-red-800',
}

export function TranscriptionStatusBadge({ status }: { status: TranscriptionStatus }) {
  return <Badge className={STATUS_CLASS[status]}>{STATUS_LABEL[status]}</Badge>
}
