import Anthropic from '@anthropic-ai/sdk'
import type { FinanceEntry, FinanceEntryType } from './types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM = `Você é um assistente financeiro pessoal para médicos, integrado via WhatsApp.
Tom: direto, amigável, profissional. Sem markdown. Máximo 1 emoji por mensagem.
Sempre confirme o que foi registrado e mostre o total do mês na mesma resposta.
Use "R$ X.XXX,XX" como formato de valor (padrão brasileiro).`

export async function buildConfirmationMessage(entry: FinanceEntry, monthTotal: number): Promise<string> {
  const typeLabel = entry.type === 'pf' ? 'Pessoal (PF)' : 'Clínica (PJ)'
  const desc = entry.description ?? 'Sem descrição'
  const cat = entry.category ?? 'Outros'
  const valor = formatBRL(entry.amount)
  const total = formatBRL(monthTotal)
  const mes = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  const prompt = `Confirme este registro de forma curta:
Tipo: ${typeLabel}
Descrição: ${desc}
Categoria: ${cat}
Valor: ${valor}
Total ${typeLabel} em ${mes}: ${total}`

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 120,
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  })

  return msg.content[0].type === 'text' ? msg.content[0].text : `✅ ${desc} ${valor} registrado.`
}

export interface QueryFilters {
  type: FinanceEntryType | null
  category: string | null
  month: string | null
}

// Resposta de consulta. Cobre desde "/resumo pf" (sem filtros) até
// "me liste meus gastos em assinatura nesse mês" (categoria + período).
export async function buildQueryMessage(entries: FinanceEntry[], filters: QueryFilters): Promise<string> {
  const escopo = describeScope(filters)

  // Sem resultado não há nada para o modelo redigir — resposta determinística
  // economiza uma chamada e evita que ele invente números.
  if (entries.length === 0) {
    return `Não encontrei ${escopo}.`
  }

  const total = entries.reduce((s, e) => s + e.amount, 0)

  // Com filtro de categoria o médico quer ver os lançamentos em si
  // ("me liste"); sem filtro, o agrupamento por categoria é mais útil.
  const detalhe = filters.category ? listEntries(entries) : groupByCategory(entries)

  const prompt = `Responda a uma consulta financeira de forma curta, para WhatsApp:
Consulta: ${escopo}
${detalhe}
Total: ${formatBRL(total)}
Quantidade de lançamentos: ${entries.length}`

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  })

  return msg.content[0].type === 'text' ? msg.content[0].text : `${escopo}: ${formatBRL(total)}`
}

export function buildUndoMessage(entry: FinanceEntry): string {
  const desc = entry.description ?? 'lançamento sem descrição'
  return `Pronto, apaguei: ${desc} — ${formatBRL(entry.amount)} (${entry.type === 'pf' ? 'PF' : 'PJ'}).`
}

export function buildNothingToUndoMessage(): string {
  return `Não há nenhum lançamento recente para apagar.`
}

export async function buildSmalltalkMessage(raw: string): Promise<string> {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 100,
    system: `${SYSTEM}
Responda à saudação de forma breve e calorosa e lembre, em uma frase, que você registra gastos e responde quanto ele gastou.`,
    messages: [{ role: 'user', content: raw }],
  })

  return msg.content[0].type === 'text'
    ? msg.content[0].text
    : `Olá! Posso registrar seus gastos e te dizer quanto você gastou. 😊`
}

export function buildHelpMessage(): string {
  return `Olá! Sou seu assistente financeiro. Pode falar comigo normalmente, do seu jeito:

➕ Registrar um gasto:
"gastei 35 na Netflix"
"paguei 3500 de aluguel do consultório"

📊 Consultar:
"quanto gastei esse mês?"
"me liste meus gastos em assinaturas"
"quanto a clínica gastou em março?"

↩️ Errei um lançamento:
"apaga o último"

Se preferir atalhos, também funcionam:
/pf Netflix 35
/pj Aluguel 3500
/resumo pf
/desfazer

Os gastos são registrados na data de hoje. Dúvidas? Fale com o suporte MedScale.`
}

export function buildUnknownMessage(): string {
  return `Não consegui entender. Você pode me dizer algo como "gastei 50 no almoço" ou "quanto gastei esse mês?". Digite /ajuda para ver mais exemplos.`
}

export function buildUnregisteredMessage(): string {
  return `Número não encontrado na MedScale. Certifique-se de que sua conta está ativa e tente novamente.`
}

export function buildUnsupportedTypeMessage(): string {
  return `Por favor, envie apenas mensagens de texto. Digite /ajuda para ver os comandos.`
}

// "gastos pessoais (PF) em Assinaturas em agosto de 2026" — usado tanto no
// prompt do modelo quanto na resposta de "nenhum resultado".
function describeScope(filters: QueryFilters): string {
  const tipo =
    filters.type === 'pf' ? 'gastos pessoais (PF)' : filters.type === 'pj' ? 'gastos da clínica (PJ)' : 'gastos'
  const categoria = filters.category ? ` em ${filters.category}` : ''
  return `${tipo}${categoria} em ${monthLabel(filters.month)}`
}

function monthLabel(month: string | null): string {
  const date = month ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1) : new Date()
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function groupByCategory(entries: FinanceEntry[]): string {
  const byCategory: Record<string, number> = {}
  for (const e of entries) {
    const cat = e.category ?? 'Outros'
    byCategory[cat] = (byCategory[cat] ?? 0) + e.amount
  }

  const lines = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, val]) => `${cat}: ${formatBRL(val)}`)
    .join('\n')

  return `Por categoria:\n${lines}`
}

function listEntries(entries: FinanceEntry[]): string {
  const lines = entries
    .map((e) => {
      const dia = new Date(e.entry_date + 'T00:00:00').toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
      })
      return `${dia} ${e.description ?? 'sem descrição'}: ${formatBRL(e.amount)}`
    })
    .join('\n')

  return `Lançamentos:\n${lines}`
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
