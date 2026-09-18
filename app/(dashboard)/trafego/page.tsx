import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { CampaignsClient } from '@/components/trafego/CampaignsClient'

// A janela mais larga do seletor. Buscar só isso evita trazer o histórico
// inteiro (uma linha por campanha por dia) para uma tela que não o mostra.
const MAX_WINDOW_DAYS = 90

export default async function TrafegoPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  const today = new Date()
  const since = new Date(today.getTime() - MAX_WINDOW_DAYS * 86_400_000)

  const supabase = await createClient()
  const { data: campaigns } = await supabase
    .from('ad_campaigns')
    .select('*')
    .eq('workspace_id', session.workspaceId)
    .gte('period_start', since.toISOString().slice(0, 10))
    .order('period_start', { ascending: false })

  return <CampaignsClient initialCampaigns={campaigns ?? []} today={today.toISOString()} />
}
