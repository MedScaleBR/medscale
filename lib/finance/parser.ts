import type { FinanceIntent, FinanceEntryType } from './types'

// Atalhos com barra — caminho rápido, determinístico e sem custo de LLM,
// para quem já decorou os comandos. O que não casar aqui volta como
// `unknown` e é interpretado por interpret.ts (linguagem natural).
//
// Formatos aceitos:
//   /pf Netflix 35                  → entry PF, desc "Netflix", valor 35
//   /pj Aluguel consultório 3500,50 → entry PJ, desc, valor
//   /pf 35                          → entry PF, sem desc, valor 35
//   /resumo pf                      → query PF do mês atual
//   /resumo pj                      → query PJ do mês atual
//   /desfazer                       → apaga o último lançamento
//   /ajuda                          → help
//
// Aceita vírgula ou ponto como separador decimal, ignora "R$" e espaços extras.
export function parseCommand(raw: string): FinanceIntent {
  const text = raw.trim()

  if (/^\/ajuda$/i.test(text)) return { kind: 'help' }
  if (/^\/desfazer$/i.test(text)) return { kind: 'undo' }

  const resumoMatch = text.match(/^\/resumo\s+(pf|pj)$/i)
  if (resumoMatch) {
    return {
      kind: 'query',
      type: resumoMatch[1].toLowerCase() as FinanceEntryType,
      category: null,
      month: null,
    }
  }

  const entryMatch = text.match(/^\/(pf|pj)\s+(.+)$/i)
  if (entryMatch) {
    const type = entryMatch[1].toLowerCase() as FinanceEntryType
    const rest = entryMatch[2].trim()

    const amountMatch = rest.match(/^(.*?)\s*R?\$?\s*([\d]+(?:[.,]\d{1,2})?)$/)
    if (amountMatch) {
      const descRaw = amountMatch[1].trim()
      const amountStr = amountMatch[2].replace(',', '.')
      const amount = parseFloat(amountStr)
      if (!isNaN(amount) && amount > 0) {
        return {
          kind: 'entry',
          type,
          description: descRaw.length > 0 ? descRaw : null,
          amount,
          // Atalho não deduz categoria — quem categoriza é o agente.
          category: null,
        }
      }
    }
  }

  return { kind: 'unknown', raw: text }
}
