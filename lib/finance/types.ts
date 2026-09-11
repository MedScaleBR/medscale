import type { Database, FinanceEntryType, RevenuePaymentMethod } from '@/types/database'

export type { FinanceEntryType }

// --- Patrimônio (schema.sql seção 7C) -------------------------------------
// Aliases das linhas do banco. Os módulos de lógica pura (investments.ts,
// goals.ts, suggestions.ts) trabalham em cima destes tipos e nunca tocam o
// Supabase, o que os deixa testáveis sem mock de banco.
type T = Database['public']['Tables']

export type FinanceReserve = T['finance_reserves']['Row']
export type FinanceReserveMovement = T['finance_reserve_movements']['Row']
export type FinanceInvestment = T['finance_investments']['Row']
export type FinanceProjection = T['finance_projections']['Row']
export type FinanceGoal = T['finance_goals']['Row']
export type FinanceSuggestionDismissal = T['finance_suggestion_dismissals']['Row']
export type FinanceSuggestionSettings = T['finance_suggestion_settings']['Row']

export type InvestmentKind = FinanceInvestment['type']
export type InvestmentRateType = NonNullable<FinanceInvestment['rate_type']>
export type ReserveMovementType = FinanceReserveMovement['type']
export type GoalMode = FinanceGoal['mode']

// Reserva com o saldo já somado dos movimentos. O saldo nunca é coluna: é
// derivado, para o histórico não poder divergir do total.
export type ReserveWithBalance = FinanceReserve & {
  balance: number
  movements: FinanceReserveMovement[]
}

export type FinanceEntry = {
  id: string
  account_id: string
  // Unidade do lançamento. null = consolidado / account-wide (padrão para PF).
  workspace_id: string | null
  recorded_by_phone: string
  type: FinanceEntryType
  // Entrada (receita) ou saída (despesa). O agente produz as duas ("gastei 35"
  // → 'out', "recebi 3000" / `/pf+` → 'in'), assim como a tela; 'in' também vem
  // do espelho do ciclo de receita (ver revenue_entry_id).
  direction: 'in' | 'out'
  description: string | null
  amount: number
  category: string | null
  // Vínculo com a árvore finance_categories. null = "Sem categoria" na tela
  // (lançamento antigo sem match, ou lançado sem categoria). `category` (texto)
  // segue preenchido como snapshot do nome resolvido.
  category_id: string | null
  subcategory_id: string | null
  raw_message: string
  entry_date: string
  // Preenchido quando o lançamento é o espelho de um pagamento confirmado do
  // ciclo de receita (revenue_entries.id, ver lib/revenue/finance-mirror.ts).
  // Linha read-only na tela e na API — ver /api/finance/entries/[id].
  revenue_entry_id: string | null
  created_at: string
}

// Um lançamento (gasto ou receita) extraído de uma mensagem. Uma mensagem pode
// citar mais de um, e o agente drena todos: o que está completo é gravado, o
// primeiro incompleto estaciona o resto numa pergunta ao owner.
export interface EntryDraft {
  // null quando a mensagem não deixa claro PF ou PJ. O agente nunca chuta:
  // com type null ele pergunta "pessoal (PF) ou da clínica (PJ)?" e só grava
  // depois da resposta.
  type: FinanceEntryType | null
  // Entrada (receita) ou saída (despesa). Atalho `/pf`/`/pj` e "gastei X" →
  // 'out'; `/pf+`/`/pj+` e "recebi X" → 'in'.
  direction: 'in' | 'out'
  // O que foi comprado/recebido, curto (ex: "Netflix", "Aluguel"). null se não der.
  description: string | null
  // Valor em reais, positivo. null quando a mensagem não traz um número claro.
  amount: number | null
  // Nome da categoria deduzido (linguagem natural) ou null (atalhos). O agente
  // resolve nome -> id contra a árvore da conta.
  category: string | null
  // Nome da subcategoria deduzido (linguagem natural) ou null. Mesma lógica.
  subcategory: string | null
  // Trecho do nome da unidade mencionado na mensagem (PJ). O agente resolve
  // contra as unidades reais da account; null = não mencionou.
  workspaceHint: string | null
}

// O que o owner quis dizer, venha de um comando com barra (parser.ts, regex)
// ou de linguagem natural (interpret.ts, via Claude). Os dois produzem este
// mesmo tipo, então o agente executa um caminho só.
export type FinanceIntent =
  // `entries` sempre tem ≥ 1 item quando `kind === 'entry'` e pode ter vários
  // (uma mensagem citando dois gastos). O agente drena a lista inteira.
  | { kind: 'entry'; entries: EntryDraft[] }
  // `type: null` = PF e PJ juntos; `category: null` = todas; `month: null` = mês atual.
  // `workspace: null` = consolidado (todas as unidades). `direction` segue a
  // mesma lógica do `entry`: sem menção clara na mensagem, 'out' (mantém o
  // comportamento de "quanto gastei" como pergunta padrão).
  | { kind: 'query'; type: FinanceEntryType | null; direction: 'in' | 'out'; category: string | null; subcategory: string | null; month: string | null; workspace: string | null }
  // Ciclo de receita: o médico avisa que um paciente pagou uma consulta.
  // Sempre passa por confirmação explícita antes de persistir.
  | { kind: 'confirm_payment'; patient: string | null; time: string | null; method: RevenuePaymentMethod | null }
  | { kind: 'undo' }
  | { kind: 'help' }
  // Saudação/agradecimento — responde com simpatia em vez de "não entendi".
  | { kind: 'smalltalk'; raw: string }
  | { kind: 'unknown'; raw: string }
