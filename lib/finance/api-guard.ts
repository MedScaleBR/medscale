import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceSession, requireModule, requireRole, type ApiSession } from '@/lib/session/api'
import type { InvestmentKind, InvestmentRateType } from '@/lib/finance/types'

// Guarda comum das rotas do financeiro. As três checagens são independentes e
// todas obrigatórias: o módulo pode estar ativo na account e mesmo assim o
// usuário não ser owner (financeiro não é estendido a admin/member, nem via
// module_overrides). Extraído porque as rotas de patrimônio repetiriam o mesmo
// bloco oito vezes.
export type FinanceGuard =
  | { error: NextResponse; session?: never }
  | { error?: never; session: ApiSession }

export async function guardFinanceOwner(req: NextRequest): Promise<FinanceGuard> {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return { error: result.error }
  const mod = requireModule(result.session, 'finance')
  if (mod) return { error: mod }
  const role = requireRole(result.session, ['owner'])
  if (role) return { error: role }
  return { session: result.session }
}

// Valor monetário vindo do corpo da requisição. Devolve null quando não é um
// número positivo finito — o chamador transforma isso em 400, em vez de deixar
// um NaN chegar ao banco.
export function readAmount(value: unknown): number | null {
  const n = Number(value)
  return isFinite(n) && n > 0 ? n : null
}

// 'YYYY-MM' ou 'YYYY-MM-DD' -> primeiro dia do mês ('YYYY-MM-01'), que é o
// formato de period_month. A trigger do banco normaliza de novo, mas validar
// aqui devolve um 400 legível em vez de um erro de constraint.
export function readPeriodMonth(value: unknown): string | null {
  const raw = String(value ?? '')
  const match = /^(\d{4})-(\d{2})/.exec(raw)
  if (!match) return null
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return `${match[1]}-${match[2]}-01`
}

// Enums de investimento vindos do corpo. Ficam aqui, e não no route.ts, porque
// Next.js só aceita os handlers HTTP como export de uma rota.
const INVESTMENT_TYPES: InvestmentKind[] = ['renda_fixa', 'renda_variavel', 'cripto', 'outro']
const RATE_TYPES: InvestmentRateType[] = ['fixed_annual', 'pct_cdi', 'ipca_plus']

export function readInvestmentType(value: unknown): InvestmentKind | null {
  const v = String(value ?? '')
  return (INVESTMENT_TYPES as string[]).includes(v) ? (v as InvestmentKind) : null
}

export function readRateType(value: unknown): InvestmentRateType | null {
  const v = String(value ?? '')
  return (RATE_TYPES as string[]).includes(v) ? (v as InvestmentRateType) : null
}
