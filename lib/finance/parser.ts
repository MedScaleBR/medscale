import type { FinanceIntent, FinanceEntryType } from './types'

// Atalhos com barra — caminho rápido, determinístico e sem custo de LLM,
// para quem já decorou os comandos. O que não casar aqui volta como
// `unknown` e é interpretado por interpret.ts (linguagem natural).
//
// Formatos aceitos:
//   /pf Netflix 35                  → entry PF despesa, desc "Netflix", valor 35
//   /pj Aluguel consultório 3500,50 → entry PJ despesa, desc, valor
//   /pf 35                          → entry PF despesa, sem desc, valor 35
//   /pf+ Aluguel recebido 3000      → entry PF receita
//   /pj+ 3000                       → entry PJ receita
//   /resumo pf                      → query PF despesa do mês atual
//   /resumo pj+                     → query PJ receita do mês atual
//   /desfazer                       → apaga o último lançamento
//   /ajuda                          → help
//
// `+` depois de pf/pj = receita (direction 'in'); sem `+` = despesa ('out'),
// igual ao comportamento histórico. Aceita vírgula ou ponto como separador
// decimal, ignora "R$" e espaços extras.
export function parseCommand(raw: string): FinanceIntent {
  const text = raw.trim()

  if (/^\/ajuda$/i.test(text)) return { kind: 'help' }
  if (/^\/desfazer$/i.test(text)) return { kind: 'undo' }

  const resumoMatch = text.match(/^\/resumo\s+(pf|pj)(\+)?$/i)
  if (resumoMatch) {
    return {
      kind: 'query',
      type: resumoMatch[1].toLowerCase() as FinanceEntryType,
      direction: resumoMatch[2] ? 'in' : 'out',
      category: null,
      subcategory: null,
      month: null,
      // Atalho é sempre consolidado; para filtrar por unidade use linguagem natural.
      workspace: null,
    }
  }

  const entryMatch = text.match(/^\/(pf|pj)(\+)?\s+(.+)$/i)
  if (entryMatch) {
    const type = entryMatch[1].toLowerCase() as FinanceEntryType
    const direction = entryMatch[2] ? 'in' : 'out'
    const rest = entryMatch[3].trim()

    const amountMatch = rest.match(/^(.*?)\s*R?\$?\s*([\d]+(?:[.,]\d{1,2})?)$/)
    if (amountMatch) {
      const descRaw = amountMatch[1].trim()
      const amountStr = amountMatch[2].replace(',', '.')
      const amount = parseFloat(amountStr)
      if (!isNaN(amount) && amount > 0) {
        return {
          kind: 'entry',
          type,
          direction,
          description: descRaw.length > 0 ? descRaw : null,
          amount,
          // Atalho não deduz categoria — quem categoriza é o agente.
          category: null,
          // Atalho não deduz subcategoria — quem categoriza é o agente.
          subcategory: null,
          // Atalho não menciona unidade; PJ multi-unidade cai na pergunta.
          workspaceHint: null,
        }
      }
    }
  }

  return { kind: 'unknown', raw: text }
}
