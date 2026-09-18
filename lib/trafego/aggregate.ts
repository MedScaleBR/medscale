// Agregações da /trafego. Ficam fora do componente porque são a parte com
// regra de negócio (janela, CPL, baldes do gráfico) e a parte que vale testar;
// o componente só desenha o que sai daqui.

const DAY_MS = 86_400_000

/** O que a página precisa de uma linha de `ad_campaigns` — nada além disso. */
export interface CampaignLike {
  channel: string
  period_start: string
  spend: number | string
  leads: number | null
}

/** `numeric` do Postgres chega como string no supabase-js; `int` nulo chega nulo. */
function toNumber(value: number | string | null | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function utcMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function daysAgo(isoDate: string, today: Date): number {
  return Math.floor((utcMidnight(today) - Date.parse(isoDate)) / DAY_MS)
}

/**
 * A janela inclui hoje, então `days = 7` vai de hoje até seis dias atrás.
 * Filtrar aqui e não no SQL mantém uma única busca no servidor: a troca de
 * período no seletor é instantânea enquanto o sync roda em segundo plano.
 */
export function withinPeriod<T extends CampaignLike>(rows: T[], days: number, today: Date): T[] {
  return rows.filter((row) => {
    const age = daysAgo(row.period_start, today)
    return age >= 0 && age < days
  })
}

export interface Summary {
  spend: number
  leads: number
  /** Nulo, não zero: "sem lead" e "custo zero por lead" são coisas diferentes. */
  cpl: number | null
}

export function summarize(rows: CampaignLike[]): Summary {
  const spend = rows.reduce((sum, row) => sum + toNumber(row.spend), 0)
  const leads = rows.reduce((sum, row) => sum + toNumber(row.leads), 0)
  return { spend, leads, cpl: leads > 0 ? spend / leads : null }
}

/** O que a tabela precisa além do resumo: quem é a campanha e quantos cliques. */
export interface CampaignRow extends CampaignLike {
  campaign_name: string | null
  clicks: number | null
  source: string
}

export interface CampaignTotal extends Summary {
  channel: string
  campaign_name: string | null
  clicks: number
  /** Veio do sync da Meta em algum dia do período — vale o selo na tabela. */
  synced: boolean
}

/**
 * O sync grava uma linha por campanha POR DIA. A tabela mostra o total do
 * período, senão a mesma campanha apareceria trinta vezes numa janela de 30
 * dias. Nome sozinho não identifica: duas contas podem ter "Marca" em canais
 * diferentes, então a chave é canal + nome.
 */
export function byCampaign(rows: CampaignRow[]): CampaignTotal[] {
  const totals = new Map<string, CampaignTotal>()

  for (const row of rows) {
    const key = `${row.channel}::${row.campaign_name}`
    const total = totals.get(key) ?? {
      channel: row.channel,
      campaign_name: row.campaign_name,
      spend: 0,
      clicks: 0,
      leads: 0,
      cpl: null,
      synced: false,
    }
    total.spend += toNumber(row.spend)
    total.clicks += toNumber(row.clicks)
    total.leads += toNumber(row.leads)
    total.synced ||= row.source === 'meta_sync'
    totals.set(key, total)
  }

  // CPL só depois de somar tudo: média de CPL diário não é o CPL do período.
  const list = [...totals.values()]
  for (const total of list) {
    total.cpl = total.leads > 0 ? total.spend / total.leads : null
  }

  return list.sort((a, b) => b.spend - a.spend)
}

export interface Bucket {
  label: string
  leads: number
}

// Cada janela tem a granularidade que cabe no eixo: 7 barras de dia, 4 de
// semana, 3 de mês. Mais que isso vira listra ilegível.
const BUCKETS: Record<number, { count: number; sizeDays: number }> = {
  7: { count: 7, sizeDays: 1 },
  30: { count: 4, sizeDays: 7 },
  90: { count: 3, sizeDays: 30 },
}

const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function bucketLabel(index: number, count: number, sizeDays: number, today: Date): string {
  if (sizeDays === 1) {
    const date = new Date(utcMidnight(today) - (count - 1 - index) * DAY_MS)
    return WEEKDAY[date.getUTCDay()]
  }
  return sizeDays === 7 ? `Sem ${index + 1}` : `Mês ${index + 1}`
}

/**
 * Baldes do mais antigo para o mais recente, sempre completos: um período sem
 * campanha vira uma barra zerada em vez de sumir e encurtar o eixo.
 */
export function leadsByBucket(rows: CampaignLike[], days: number, today: Date): Bucket[] {
  const { count, sizeDays } = BUCKETS[days] ?? BUCKETS[7]

  const buckets: Bucket[] = Array.from({ length: count }, (_, index) => ({
    label: bucketLabel(index, count, sizeDays, today),
    leads: 0,
  }))

  for (const row of rows) {
    const age = daysAgo(row.period_start, today)
    if (age < 0) continue
    // `count - 1` no fim: os dias que sobram de uma janela que não divide
    // certo (30 em baldes de 7) caem no balde mais antigo em vez de sumirem.
    const fromEnd = Math.min(Math.floor(age / sizeDays), count - 1)
    buckets[count - 1 - fromEnd].leads += toNumber(row.leads)
  }

  return buckets
}
