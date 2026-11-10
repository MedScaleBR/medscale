import { describe, it, expect } from 'vitest'
import {
  USD_BRL,
  claudeCostUsd,
  isKnownClaudeModel,
  toBrl,
  whatsappConversationCostBrl,
  whisperCostUsd,
} from '@/lib/costs/pricing'

// Esta tabela é a única fonte de verdade do que a MedScale acha que gasta. Um
// preço errado aqui não quebra nada em produção — só faz o painel mentir, que
// é pior, porque ninguém desconfia de um número.

describe('claudeCostUsd', () => {
  it('cobra entrada e saída com preços diferentes', () => {
    // sonnet-4-5: $3/MTok entrada, $15/MTok saída.
    expect(claudeCostUsd('claude-sonnet-4-5', 1_000_000, 0)).toBeCloseTo(3, 10)
    expect(claudeCostUsd('claude-sonnet-4-5', 0, 1_000_000)).toBeCloseTo(15, 10)
    expect(claudeCostUsd('claude-sonnet-4-5', 1000, 500)).toBeCloseTo(0.0105, 10)
  })

  it('cobra o sonnet-5-5 da Clara pela tabela dele', () => {
    // sonnet-5-5: $2/MTok entrada, $10/MTok saída.
    expect(claudeCostUsd('claude-sonnet-5-5', 1_000_000, 0)).toBeCloseTo(2, 10)
    expect(claudeCostUsd('claude-sonnet-5-5', 0, 1_000_000)).toBeCloseTo(10, 10)
  })

  // Com cache, a API separa a entrada em três: sem cache (preço cheio),
  // gravada no cache (1,25× no de 5 min, 2× no de 1 h) e lida do cache
  // (sonnet-5-5: $0,10/MTok). Somar tudo como entrada cheia faria o painel
  // mostrar a Clara mais cara do que ela é.
  it('cobra leitura e gravação de cache pelo preço de cada uma', () => {
    expect(claudeCostUsd('claude-sonnet-5-5', 0, 0, { readTokens: 1_000_000 })).toBeCloseTo(0.1, 10)
    expect(claudeCostUsd('claude-sonnet-5-5', 0, 0, { write5mTokens: 1_000_000 })).toBeCloseTo(2.5, 10)
    expect(claudeCostUsd('claude-sonnet-5-5', 0, 0, { write1hTokens: 1_000_000 })).toBeCloseTo(4, 10)
    expect(
      claudeCostUsd('claude-sonnet-5-5', 1_000_000, 1_000_000, { readTokens: 1_000_000, write1hTokens: 1_000_000 })
    ).toBeCloseTo(2 + 10 + 0.1 + 4, 10)
  })

  it('leitura de cache de modelo sem preço próprio sai a 10% da entrada', () => {
    expect(claudeCostUsd('claude-modelo-que-nao-existe', 0, 0, { readTokens: 1_000_000 })).toBeCloseTo(0.5, 10)
  })

  it('opus-5 é mais caro que sonnet-4-5 no mesmo usage', () => {
    const usage = [1000, 500] as const
    expect(claudeCostUsd('claude-opus-5', ...usage)).toBeGreaterThan(claudeCostUsd('claude-sonnet-4-5', ...usage))
  })

  // O caso que importa: modelo trocado num deploy e esquecido aqui. Zerar o
  // custo esconderia gasto real; o fallback erra para cima e aparece.
  it('modelo desconhecido cai no fallback caro, nunca em zero', () => {
    expect(isKnownClaudeModel('claude-modelo-que-nao-existe')).toBe(false)
    const unknown = claudeCostUsd('claude-modelo-que-nao-existe', 1000, 500)
    expect(unknown).toBeGreaterThan(0)
    expect(unknown).toBe(claudeCostUsd('claude-opus-5', 1000, 500))
  })

  it('reconhece os modelos realmente usados no app', () => {
    expect(isKnownClaudeModel('claude-sonnet-4-5')).toBe(true)
    expect(isKnownClaudeModel('claude-opus-5')).toBe(true)
    expect(isKnownClaudeModel('claude-sonnet-5-5')).toBe(true)
  })
})

describe('whisperCostUsd', () => {
  it('cobra por minuto de áudio, proporcional ao segundo', () => {
    expect(whisperCostUsd(60)).toBeCloseTo(0.006, 10)
    expect(whisperCostUsd(120)).toBeCloseTo(0.012, 10)
    expect(whisperCostUsd(30)).toBeCloseTo(0.003, 10)
  })

  it('duração inválida ou ausente não vira custo negativo nem NaN', () => {
    expect(whisperCostUsd(0)).toBe(0)
    expect(whisperCostUsd(-10)).toBe(0)
    expect(whisperCostUsd(NaN)).toBe(0)
    expect(whisperCostUsd(Infinity)).toBe(0)
  })
})

describe('toBrl', () => {
  it('converte pela cotação corrente', () => {
    expect(toBrl(1)).toBeCloseTo(USD_BRL, 10)
    expect(toBrl(0.0105)).toBeCloseTo(0.0105 * USD_BRL, 10)
  })

  // cost_brl é numeric(12,4) — arredondar aqui evita que o Postgres arredonde
  // de um jeito e o painel some de outro.
  it('arredonda ao décimo de milésimo, casando com numeric(12,4)', () => {
    expect(toBrl(0.000001)).toBe(0)
    expect(String(toBrl(0.0105)).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4)
  })
})

describe('whatsappConversationCostBrl', () => {
  // Já é cobrada em reais pela Meta: passar por câmbio seria converter duas vezes.
  it('devolve reais direto, dentro da faixa praticada', () => {
    const brl = whatsappConversationCostBrl()
    expect(brl).toBeGreaterThan(0)
    expect(brl).toBeLessThan(2)
  })
})
