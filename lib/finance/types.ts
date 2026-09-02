import type { FinanceEntryType, RevenuePaymentMethod } from '@/types/database'

export type { FinanceEntryType }

export type FinanceEntry = {
  id: string
  account_id: string
  // Unidade do lançamento. null = consolidado / account-wide (padrão para PF).
  workspace_id: string | null
  recorded_by_phone: string
  type: FinanceEntryType
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
  created_at: string
}

// O que o owner quis dizer, venha de um comando com barra (parser.ts, regex)
// ou de linguagem natural (interpret.ts, via Claude). Os dois produzem este
// mesmo tipo, então o agente executa um caminho só.
export type FinanceIntent =
  // `category` vem preenchida quando a interpretação por linguagem natural
  // já deduziu uma categoria válida; null (caminho dos atalhos) faz o agente
  // categorizar num passo à parte. `subcategory` segue a mesma lógica.
  | {
      kind: 'entry'
      type: FinanceEntryType
      description: string | null
      amount: number
      category: string | null
      // Nome da subcategoria deduzido (linguagem natural) ou null. O agente
      // resolve nome -> id contra a árvore da conta.
      subcategory: string | null
      // Trecho do nome da unidade mencionado na mensagem (PJ). O agente
      // resolve contra as unidades reais da account; null = não mencionou.
      workspaceHint: string | null
    }
  // `type: null` = PF e PJ juntos; `category: null` = todas; `month: null` = mês atual.
  // `workspace: null` = consolidado (todas as unidades).
  | { kind: 'query'; type: FinanceEntryType | null; category: string | null; subcategory: string | null; month: string | null; workspace: string | null }
  // Ciclo de receita: o médico avisa que um paciente pagou uma consulta.
  // Sempre passa por confirmação explícita antes de persistir.
  | { kind: 'confirm_payment'; patient: string | null; time: string | null; method: RevenuePaymentMethod | null }
  | { kind: 'undo' }
  | { kind: 'help' }
  // Saudação/agradecimento — responde com simpatia em vez de "não entendi".
  | { kind: 'smalltalk'; raw: string }
  | { kind: 'unknown'; raw: string }
