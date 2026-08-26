import type { ParsedCommand, FinanceEntryType } from './types'

// Interpreta a mensagem do owner. Roda antes do LLM — o Claude só entra
// para categorizar e redigir respostas, nunca para parsing de comandos.
//
// Formatos aceitos:
//   /pf Netflix 35                  → entry PF, desc "Netflix", valor 35
//   /pj Aluguel consultório 3500,50 → entry PJ, desc, valor
//   /pf 35                          → entry PF, sem desc, valor 35
//   /resumo pf                      → summary PF
//   /resumo pj                      → summary PJ
//   /ajuda                          → help
//   qualquer outra coisa            → unknown
//
// Aceita vírgula ou ponto como separador decimal, ignora "R$" e espaços extras.
export function parseCommand(raw: string): ParsedCommand {
  const text = raw.trim()

  if (/^\/ajuda$/i.test(text)) return { kind: 'help' }

  const resumoMatch = text.match(/^\/resumo\s+(pf|pj)$/i)
  if (resumoMatch) {
    return { kind: 'summary', type: resumoMatch[1].toLowerCase() as FinanceEntryType }
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
        }
      }
    }
  }

  return { kind: 'unknown', raw: text }
}
