import type { TrafficChannelStats } from '@/lib/types'

const CHANNEL_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  google: 'Google Ads',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  outro: 'Outro',
}

export function TrafficTable({ traffic }: { traffic: Record<string, TrafficChannelStats> }) {
  const channels = Object.entries(traffic)
  const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-900">Tráfego pago do mês</h2>
      </div>

      {channels.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">Nenhuma campanha registrada este mês.</p>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-[var(--navy-06)] text-left text-xs text-gray-400">
              <th className="pb-2 font-normal">Canal</th>
              <th className="pb-2 font-normal">Investimento</th>
              <th className="pb-2 font-normal">Cliques</th>
              <th className="pb-2 font-normal">Leads</th>
              <th className="pb-2 font-normal">CPL</th>
            </tr>
          </thead>
          <tbody>
            {channels.map(([channel, stats]) => (
              <tr key={channel} className="border-b border-[var(--navy-06)] last:border-0">
                <td className="py-2.5 font-medium text-gray-900">{CHANNEL_LABEL[channel] ?? channel}</td>
                <td className="py-2.5 text-gray-600">{formatBRL(stats.spend)}</td>
                <td className="py-2.5 text-gray-600">{stats.clicks}</td>
                <td className="py-2.5 text-gray-600">{stats.leads}</td>
                <td className="py-2.5 text-gray-600">
                  {stats.leads > 0 ? formatBRL(stats.spend / stats.leads) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}
