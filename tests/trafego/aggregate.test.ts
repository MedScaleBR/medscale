import { describe, it, expect } from 'vitest'
import type { CampaignRow } from '@/lib/trafego/aggregate'
import { withinPeriod, summarize, leadsByBucket, byCampaign } from '@/lib/trafego/aggregate'

const campaign = (over: Partial<CampaignRow> = {}) => ({
  channel: 'facebook',
  campaign_name: 'c',
  period_start: '2026-09-15',
  period_end: '2026-09-15',
  spend: 100,
  impressions: 1000,
  clicks: 50,
  leads: 5,
  source: 'manual',
  ...over,
})

const TODAY = new Date('2026-09-18T12:00:00Z')

describe('withinPeriod', () => {
  it('mantém o que está dentro da janela e corta o que está fora', () => {
    const rows = [
      campaign({ period_start: '2026-09-17' }),
      campaign({ period_start: '2026-08-01' }),
    ]

    expect(withinPeriod(rows, 7, TODAY)).toHaveLength(1)
    expect(withinPeriod(rows, 90, TODAY)).toHaveLength(2)
  })

  it('inclui o próprio dia de hoje', () => {
    const rows = [campaign({ period_start: '2026-09-18' })]

    expect(withinPeriod(rows, 7, TODAY)).toHaveLength(1)
  })
})

describe('summarize', () => {
  it('soma investimento e leads e calcula o CPL', () => {
    const result = summarize([
      campaign({ spend: 300, leads: 10 }),
      campaign({ spend: 200, leads: 15 }),
    ])

    expect(result).toEqual({ spend: 500, leads: 25, cpl: 20 })
  })

  it('sem lead nenhum, o CPL é nulo em vez de dividir por zero', () => {
    const result = summarize([campaign({ spend: 300, leads: 0 })])

    expect(result.cpl).toBeNull()
  })

  it('aceita spend em string, que é como o Postgres devolve numeric', () => {
    const result = summarize([campaign({ spend: '150.50' })])

    expect(result.spend).toBe(150.5)
  })

  it('sem campanha nenhuma, devolve zeros em vez de NaN', () => {
    expect(summarize([])).toEqual({ spend: 0, leads: 0, cpl: null })
  })
})

describe('leadsByBucket', () => {
  it('em 7 dias, agrupa por dia e devolve um balde por dia', () => {
    const buckets = leadsByBucket(
      [campaign({ period_start: '2026-09-18', leads: 4 }), campaign({ period_start: '2026-09-18', leads: 2 })],
      7,
      TODAY
    )

    expect(buckets).toHaveLength(7)
    expect(buckets[buckets.length - 1]).toMatchObject({ leads: 6 })
  })

  it('em 90 dias, agrupa em três meses', () => {
    const buckets = leadsByBucket([campaign({ period_start: '2026-09-18', leads: 7 })], 90, TODAY)

    expect(buckets).toHaveLength(3)
    expect(buckets.reduce((sum, b) => sum + b.leads, 0)).toBe(7)
  })

  it('um dia sem campanha vira zero, não some do eixo', () => {
    const buckets = leadsByBucket([], 7, TODAY)

    expect(buckets).toHaveLength(7)
    expect(buckets.every((b) => b.leads === 0)).toBe(true)
  })
})

describe('byCampaign', () => {
  it('junta os dias da mesma campanha numa linha só', () => {
    // O sync grava uma linha por campanha POR DIA; a tabela mostra o total do
    // período, senão a mesma campanha aparece 30 vezes numa janela de 30 dias.
    const rows = byCampaign([
      campaign({ campaign_name: 'Implantes', period_start: '2026-09-17', spend: 100, leads: 4 }),
      campaign({ campaign_name: 'Implantes', period_start: '2026-09-18', spend: 50, leads: 1 }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ campaign_name: 'Implantes', spend: 150, leads: 5, cpl: 30 })
  })

  it('separa campanhas de canais diferentes com o mesmo nome', () => {
    const rows = byCampaign([
      campaign({ campaign_name: 'Marca', channel: 'facebook' }),
      campaign({ campaign_name: 'Marca', channel: 'google' }),
    ])

    expect(rows).toHaveLength(2)
  })

  // A linha agregada some com o `source` de cada dia, mas o selo "sincronizado"
  // da tabela precisa dele: é o que diferencia campanha da Meta de lançamento
  // manual.
  it('marca como sincronizada a campanha que tem qualquer dia vindo da Meta', () => {
    const [meta] = byCampaign([
      campaign({ campaign_name: 'Meta', source: 'manual' }),
      campaign({ campaign_name: 'Meta', source: 'meta_sync' }),
    ])
    const [manual] = byCampaign([campaign({ campaign_name: 'Manual', source: 'manual' })])

    expect(meta.synced).toBe(true)
    expect(manual.synced).toBe(false)
  })

  it('ordena da que mais gastou para a que menos gastou', () => {
    const rows = byCampaign([
      campaign({ campaign_name: 'Barata', spend: 10 }),
      campaign({ campaign_name: 'Cara', spend: 900 }),
    ])

    expect(rows.map((r) => r.campaign_name)).toEqual(['Cara', 'Barata'])
  })
})

// A atribuição chega com o ID EXTERNO da campanha (é o que o mapa de anúncios
// devolve), mas a tabela de gasto agrupa por canal + nome. Sem carregar o ID
// na linha agregada, o ROI da Tarefa 7 não tem como casar as duas metades.
describe('byCampaign — id externo', () => {
  it('carrega o id externo da campanha na linha agregada', () => {
    const [row] = byCampaign([
      campaign({ campaign_name: 'Implantes', external_campaign_id: 'c1', source: 'meta_sync' }),
    ])

    expect(row.externalId).toBe('c1')
  })

  // Campanha manual não tem id externo, e o dia manual não pode apagar o id
  // que veio do sync: senão a linha perde o vínculo com o ROI.
  it('mantém o id externo quando um dia manual entra na mesma campanha', () => {
    const [row] = byCampaign([
      campaign({ campaign_name: 'Implantes', external_campaign_id: null, source: 'manual' }),
      campaign({ campaign_name: 'Implantes', external_campaign_id: 'c1', source: 'meta_sync' }),
    ])

    expect(row).toMatchObject({ externalId: 'c1', spend: 200 })
  })

  it('deixa o id nulo na campanha puramente manual', () => {
    const [row] = byCampaign([campaign({ campaign_name: 'Manual', external_campaign_id: null })])

    expect(row.externalId).toBeNull()
  })
})
