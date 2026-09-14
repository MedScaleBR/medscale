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
