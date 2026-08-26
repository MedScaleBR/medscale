import Anthropic from '@anthropic-ai/sdk'
import type { FinanceEntryType } from './types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PF_CATEGORIES = [
  'Alimentação', 'Moradia', 'Saúde', 'Educação', 'Lazer',
  'Transporte', 'Vestuário', 'Assinaturas', 'Investimentos', 'Outros',
]

const PJ_CATEGORIES = [
  'Aluguel', 'Equipamentos', 'Salários', 'Marketing', 'Software',
  'Impostos', 'Contabilidade', 'Materiais médicos', 'Manutenção', 'Outros',
]

// Categorização automática via Claude — chamada apenas quando o
// lançamento tem descrição (sem descrição, cai direto em "Outros").
export async function categorizeEntry(description: string, type: FinanceEntryType): Promise<string> {
  const categories = type === 'pf' ? PF_CATEGORIES : PJ_CATEGORIES

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 20,
    system: `Você categoriza lançamentos financeiros. Responda APENAS com o nome exato de uma das categorias listadas, sem pontuação, sem explicação.
Categorias disponíveis: ${categories.join(', ')}`,
    messages: [{ role: 'user', content: description }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
  return categories.includes(raw) ? raw : 'Outros'
}
