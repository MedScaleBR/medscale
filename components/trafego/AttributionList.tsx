import type { AttributedLead } from '@/lib/trafego/attribution'
import { channelLabel } from '@/lib/trafego/channels'

// Atribuição por CAMPANHA, não por origem. A origem de todo lead desta lista é
// a mesma — anúncio que abre o WhatsApp — e o que a clínica precisa saber é
// qual campanha pagou por ele.

interface Line {
  key: string
  label: string
  leads: number
  pct: number
}

function group(leads: AttributedLead[]): Line[] {
  const lines = new Map<string, Line>()

  for (const lead of leads) {
    // Anúncio fora do mapa ainda não tem campanha; vira uma linha própria em
    // vez de sumir, senão a soma da lista não bateria com o total de leads.
    const key = lead.campaignId ?? 'sem-campanha'
    const canal = channelLabel(lead.channel)
    const label = lead.campaignName
      ? `${canal ? `${canal} · ` : ''}${lead.campaignName}`
      : 'Campanha não identificada'
    const line = lines.get(key) ?? { key, label, leads: 0, pct: 0 }
    line.leads += 1
    lines.set(key, line)
  }

  const list = [...lines.values()]
  for (const line of list) {
    line.pct = leads.length > 0 ? (line.leads / leads.length) * 100 : 0
  }

  return list.sort((a, b) => b.leads - a.leads)
}

export function AttributionList({ leads }: { leads: AttributedLead[] }) {
  const lines = group(leads)

  return (
    <div className="rounded-[14px] border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--text-strong)]">Atribuição por campanha</h2>
        <span className="text-xs text-[var(--text-muted)]">{leads.length} leads</span>
      </div>

      {lines.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">
          Nenhum lead chegou por anúncio neste período.
        </p>
      ) : (
        <ul className="space-y-3">
          {lines.map((line) => (
            <li key={line.key} className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm text-[var(--text-body)]" title={line.label}>
                {line.label}
              </span>
              <span className="shrink-0 text-sm font-medium text-[var(--text-strong)]">
                {line.leads}
                <span className="ml-1.5 text-xs font-normal text-[var(--text-muted)]">
                  {Math.round(line.pct)}%
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
