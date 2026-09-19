import { describe, it, expect, vi } from 'vitest'
import { parseReferral, recordAttribution } from '@/lib/whatsapp/referral'

// O `referral` só vem na PRIMEIRA mensagem de quem clicou num anúncio
// Click-to-WhatsApp, e não é recuperável depois: a Graph API não devolve o
// histórico de cliques. Se o parse errar ou lançar, o lead vira anônimo para
// sempre — e a esmagadora maioria das mensagens é conversa normal, sem
// referral nenhum, então o caminho do nulo é o mais percorrido.

describe('parseReferral', () => {
  it('extrai a origem de uma mensagem vinda de anúncio', () => {
    const result = parseReferral({
      from: '5511999999999',
      referral: {
        source_id: '120210000000',
        source_type: 'ad',
        source_url: 'https://fb.me/abc',
        headline: 'Consulta de rotina',
        body: 'Agende hoje',
        ctwa_clid: 'ARBx123',
      },
    })

    expect(result).toEqual({
      sourceId: '120210000000',
      sourceType: 'ad',
      sourceUrl: 'https://fb.me/abc',
      headline: 'Consulta de rotina',
      body: 'Agende hoje',
      ctwaClid: 'ARBx123',
    })
  })

  it('devolve nulo para mensagem comum, sem referral', () => {
    expect(parseReferral({ from: '5511999999999', text: { body: 'oi' } })).toBeNull()
  })

  it('devolve nulo quando o referral vem sem source_id', () => {
    expect(parseReferral({ referral: { source_type: 'ad' } })).toBeNull()
  })

  it('aceita referral sem ctwa_clid, que é o caso de anúncio antigo', () => {
    const result = parseReferral({ referral: { source_id: '1', source_type: 'ad' } })

    expect(result?.sourceId).toBe('1')
    expect(result?.ctwaClid).toBeNull()
  })

  it('não quebra com mensagem nula ou de formato inesperado', () => {
    expect(parseReferral(null)).toBeNull()
    expect(parseReferral(undefined)).toBeNull()
    expect(parseReferral('oi')).toBeNull()
  })
})

describe('recordAttribution', () => {
  it('grava a origem ignorando conflito, porque a Meta reenvia o webhook', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const client = { from: vi.fn().mockReturnValue({ upsert }) }

    await recordAttribution(
      {
        accountId: 'acc1',
        patientPhone: '+5511999999999',
        referral: {
          sourceId: '1',
          sourceType: 'ad',
          sourceUrl: null,
          headline: null,
          body: null,
          ctwaClid: 'X',
        },
      },
      client as never
    )

    expect(client.from).toHaveBeenCalledWith('lead_attributions')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: 'acc1', source_id: '1', ctwa_clid: 'X' }),
      { onConflict: 'account_id,ctwa_clid', ignoreDuplicates: true }
    )
  })

  // Perder uma atribuição é ruim; perder a resposta ao paciente é pior. A Meta
  // exige 200 em menos de 20s, então um erro aqui não pode subir.
  it('não lança quando o banco recusa a gravação', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: { message: 'boom' } })
    const client = { from: vi.fn().mockReturnValue({ upsert }) }

    await expect(
      recordAttribution(
        {
          accountId: 'acc1',
          patientPhone: '+5511999999999',
          referral: {
            sourceId: '1',
            sourceType: 'ad',
            sourceUrl: null,
            headline: null,
            body: null,
            ctwaClid: null,
          },
        },
        client as never
      )
    ).resolves.toBeUndefined()
  })
})
