import { TZDate } from '@date-fns/tz'
import type { FinanceInvestment } from './types'

// Todo cálculo de data do módulo acontece na wall-clock de São Paulo — ver
// lib/google/availability.ts, mesmo padrão.
const TZ = 'America/Sao_Paulo'

// Índices de referência, congelados aqui em vez de buscados numa API externa.
// Trocar à mão quando o cenário mudar — um número desatualizado numa projeção
// é um erro pequeno e visível; uma dependência de rede no caminho de leitura
// do painel é um problema grande e invisível.
// Referência: setembro de 2026.
export const CDI_ANNUAL_PCT = 10.4
export const IPCA_ANNUAL_PCT = 4.2

const DIAS_POR_ANO = 365

export type InvestmentProjection = {
  // Quanto o investimento vale hoje, pela taxa informada.
  estimatedCurrentValue: number
  // Quanto valerá no vencimento. null quando não há maturity_date.
  projectedAtMaturity: number | null
  // Taxa anual efetiva usada no cálculo, já resolvida a partir de rate_type.
  // Exposta para a tela poder mostrar "≈ 11,4% a.a." em vez de só "110% do CDI".
  annualRatePct: number
}

// Taxa anual efetiva a partir do par (rate_type, rate_value). null quando
// falta informação — nunca uma taxa estimada por conta própria.
function annualRate(investment: FinanceInvestment): number | null {
  const { rate_type, rate_value } = investment
  if (!rate_type || rate_value == null || !isFinite(rate_value) || rate_value <= 0) return null
  switch (rate_type) {
    case 'fixed_annual':
      return rate_value
    // "110% do CDI" = 110% de CDI_ANNUAL_PCT, não CDI + 110.
    case 'pct_cdi':
      return (CDI_ANNUAL_PCT * rate_value) / 100
    // "IPCA + 6" soma, não multiplica.
    case 'ipca_plus':
      return IPCA_ANNUAL_PCT + rate_value
    default:
      return null
  }
}

// Anos decorridos entre duas datas ISO (yyyy-mm-dd), na wall-clock de SP.
// null quando alguma data não parseia — o chamador decide o que fazer, mas
// nunca recebe NaN.
function yearsBetween(fromISO: string, to: Date): number | null {
  const from = new TZDate(`${fromISO}T12:00:00`, TZ)
  if (isNaN(from.getTime())) return null
  const target = new TZDate(to, TZ)
  if (isNaN(target.getTime())) return null
  const days = (target.getTime() - from.getTime()) / 86_400_000
  return days / DIAS_POR_ANO
}

// Juros compostos. MVP: capitalização contínua sobre a fração de ano, sem
// distinguir dia útil de dia corrido. Melhoria futura: CDI real acumulado dia
// a dia a partir de uma série histórica, que muda o resultado em alguns
// décimos e exige a série no banco.
function compound(principal: number, annualPct: number, years: number): number {
  return principal * Math.pow(1 + annualPct / 100, years)
}

// Rendimento estimado e projeção no vencimento. Devolve null — sem exceção,
// sem chute — quando falta taxa ou a data de início é futura. A tela mostra
// "dados insuficientes" nesse caso; nunca um valor sem base.
export function calculateInvestmentProjection(
  investment: FinanceInvestment,
  today: Date = new Date()
): InvestmentProjection | null {
  const rate = annualRate(investment)
  if (rate == null) return null

  const elapsed = yearsBetween(investment.start_date, today)
  // elapsed negativo = aplicação que ainda não começou; renderia menos que o
  // principal, o que seria pior que não mostrar nada.
  if (elapsed == null || elapsed < 0) return null

  const maturityYears = investment.maturity_date
    ? yearsBetween(investment.start_date, new TZDate(`${investment.maturity_date}T12:00:00`, TZ))
    : null

  // Depois do vencimento o papel para de render: o valor de hoje congela no
  // do vencimento, em vez de seguir capitalizando indefinidamente.
  const effective = maturityYears != null ? Math.min(elapsed, maturityYears) : elapsed

  return {
    estimatedCurrentValue: compound(investment.invested_amount, rate, effective),
    projectedAtMaturity:
      maturityYears == null ? null : compound(investment.invested_amount, rate, maturityYears),
    annualRatePct: rate,
  }
}

// Quanto o investimento vale hoje, para somar no patrimônio (ver goals.ts).
// Ordem: valor informado à mão pelo owner > estimado pela taxa > valor
// investido. Renda variável e cripto caem no primeiro ou no terceiro, já que
// não têm taxa a projetar.
export function investmentCurrentValue(
  investment: FinanceInvestment,
  today: Date = new Date()
): number {
  if (investment.current_value != null) return investment.current_value
  const projection = calculateInvestmentProjection(investment, today)
  return projection?.estimatedCurrentValue ?? investment.invested_amount
}
