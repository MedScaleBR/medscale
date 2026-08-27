import type { FinanceEntryType, RevenuePaymentMethod } from '@/types/database'

export type { FinanceEntryType }

export type FinanceEntry = {
  id: string
  account_id: string
  recorded_by_phone: string
  type: FinanceEntryType
  description: string | null
  amount: number
  category: string | null
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
  // categorizar num passo à parte.
  | {
      kind: 'entry'
      type: FinanceEntryType
      description: string | null
      amount: number
      category: string | null
    }
  // `type: null` = PF e PJ juntos; `category: null` = todas; `month: null` = mês atual.
  | { kind: 'query'; type: FinanceEntryType | null; category: string | null; month: string | null }
  // Ciclo de receita: o médico avisa que um paciente pagou uma consulta.
  // Sempre passa por confirmação explícita antes de persistir.
  | { kind: 'confirm_payment'; patient: string | null; time: string | null; method: RevenuePaymentMethod | null }
  | { kind: 'undo' }
  | { kind: 'help' }
  // Saudação/agradecimento — responde com simpatia em vez de "não entendi".
  | { kind: 'smalltalk'; raw: string }
  | { kind: 'unknown'; raw: string }
