import { Separator } from '@/components/ui/separator'
import { WhatsAppConnectButton } from './WhatsAppConnectButton'
import { FacebookConnectButton } from './FacebookConnectButton'
import { AdAccountMap, type AdAccountMapRow } from './AdAccountMap'

interface MetaIntegrationsCardProps {
  whatsapp: {
    connected: boolean
    number: string | null
    /** false quando faltam NEXT_PUBLIC_META_APP_ID / config do Embedded Signup */
    configured: boolean
    appId: string
    configId: string
  }
  ads: {
    connected: boolean
    /** false quando o token expirou/foi revogado (Meta respondeu 190). */
    isValid: boolean
    workspaces: AdAccountMapRow[]
  }
}

export function MetaIntegrationsCard({ whatsapp, ads }: MetaIntegrationsCardProps) {
  const mappedCount = ads.workspaces.filter((w) => w.adAccountId).length
  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
      <h2 className="text-sm font-medium text-gray-900">Integrações Meta</h2>
      <p className="mt-0.5 text-xs text-gray-400">
        Conexões com a Meta para toda a conta — WhatsApp da Clara e anúncios do Facebook.
      </p>
      <Separator className="my-4" />

      <div>
        <h3 className="text-sm font-medium text-gray-900">WhatsApp da Clara</h3>
        <p className="mt-0.5 text-xs text-gray-400">
          Uma conexão para toda a conta — a Clara atende pelo número conectado aqui.
        </p>
        <div className="mt-3">
          <WhatsAppConnectButton
            isConnected={whatsapp.connected}
            whatsappNumber={whatsapp.number}
            isConfigured={whatsapp.configured}
            appId={whatsapp.appId}
            configId={whatsapp.configId}
          />
        </div>
      </div>

      <Separator className="my-4" />

      <div>
        <h3 className="text-sm font-medium text-gray-900">Anúncios do Facebook</h3>
        <p className="mt-0.5 text-xs text-gray-400">
          Uma conexão para toda a conta — as métricas de campanha de cada unidade vêm da conta de
          anúncio mapeada aqui.
        </p>
        <div className="mt-3">
          <FacebookConnectButton
            isConnected={ads.connected}
            isValid={ads.isValid}
            mappedCount={mappedCount}
            totalWorkspaces={ads.workspaces.length}
          />
        </div>

        {ads.connected && ads.isValid && ads.workspaces.length > 0 && (
          <>
            <Separator className="my-4" />
            <AdAccountMap workspaces={ads.workspaces} />
          </>
        )}
      </div>
    </div>
  )
}
