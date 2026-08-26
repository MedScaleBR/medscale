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

export async function buildSummaryMessage(entries: FinanceEntry[], type: FinanceEntryType): Promise<string> {
  const typeLabel = type === 'pf' ? 'Pessoal (PF)' : 'Clínica (PJ)'
  const mes = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  if (entries.length === 0) {
    return `Nenhum lançamento ${typeLabel} em ${mes} ainda.`
  }

  const byCategory: Record<string, number> = {}
  for (const e of entries) {
    const cat = e.category ?? 'Outros'
    byCategory[cat] = (byCategory[cat] ?? 0) + e.amount
  }

  const lines = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, val]) => `${cat}: ${formatBRL(val)}`)
    .join('\n')

  const total = entries.reduce((s, e) => s + e.amount, 0)

  const prompt = `Monte um resumo financeiro curto para WhatsApp:
Tipo: ${typeLabel}
Mês: ${mes}
Por categoria:
${lines}
Total: ${formatBRL(total)}`

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 200,
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  })

  return msg.content[0].type === 'text' ? msg.content[0].text : `📊 ${typeLabel} ${mes}\nTotal: ${formatBRL(total)}`
}

export function buildHelpMessage(): string {
  return `Olá! Veja como usar o assistente financeiro:

➕ Registrar gasto pessoal:
/pf Netflix 35
/pf Mercado 450,90

➕ Registrar gasto da clínica:
/pj Aluguel consultório 3500
/pj Software de gestão 199

📊 Ver resumo do mês:
/resumo pf
/resumo pj

Os valores são registrados na data de hoje. Dúvidas? Fale com o suporte MedScale.`
}

export function buildUnknownMessage(): string {
  return `Não entendi o comando. Digite /ajuda para ver como registrar seus gastos.`
}

export function buildUnregisteredMessage(): string {
  return `Número não encontrado na MedScale. Certifique-se de que sua conta está ativa e tente novamente.`
}

export function buildUnsupportedTypeMessage(): string {
  return `Por favor, envie apenas mensagens de texto. Digite /ajuda para ver os comandos.`
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
