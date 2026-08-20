import { Badge } from '@/components/ui/badge'
import type { OnboardingStep } from '@/types/database'

const STEP_LABEL: Record<OnboardingStep, string> = {
  pending: 'Não configurado',
  meta_app_created: 'App Meta criado',
  number_added: 'Número adicionado',
  webhook_set: 'Webhook configurado',
  verified: 'Verificado',
  provisioning: 'Aguardando provisionamento',
  active: 'Ativo',
}

interface BotStatusBadgeProps {
  isActive: boolean
  onboardingStep: OnboardingStep
}

export function BotStatusBadge({ isActive, onboardingStep }: BotStatusBadgeProps) {
  if (isActive) {
    return <Badge className="border-none bg-green-50 text-green-700">● Bot ativo</Badge>
  }
  if (onboardingStep === 'provisioning') {
    return <Badge className="border-none bg-amber-50 text-amber-700">Em provisionamento pela MedScale</Badge>
  }
  return <Badge className="border-none bg-[var(--navy-06)] text-[var(--navy)]">{STEP_LABEL[onboardingStep]}</Badge>
}
