import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { CampaignsClient } from '@/components/trafego/CampaignsClient'

export default async function TrafegoPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const { data: campaigns } = await supabase
    .from('ad_campaigns')
    .select('*')
    .eq('workspace_id', session.workspaceId)
    .order('period_start', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Tráfego pago</h1>
        <p className="text-sm text-gray-400">Campanhas por canal e custo por lead</p>
      </div>
      <CampaignsClient initialCampaigns={campaigns ?? []} />
    </div>
  )
}
