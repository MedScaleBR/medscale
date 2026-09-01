import Anthropic from '@anthropic-ai/sdk'
import type { FinanceEntryType } from './types'
import type { FinanceCategoryTree } from './categories'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Opções que o modelo pode escolher, a partir da árvore da conta (só
// não-arquivadas). Cada linha é "Raiz" ou "Raiz > Subcategoria".
export function buildCategorizePrompt(type: FinanceEntryType, tree: FinanceCategoryTree): string {
  const roots = (type === 'pf' ? tree.pf : tree.pj).filter((c) => !c.isArchived)
  const lines: string[] = []
  for (const root of roots) {
    lines.push(root.name)
    for (const sub of root.children.filter((s) => !s.isArchived)) {
      lines.push(`${root.name} > ${sub.name}`)
    }
  }
  return lines.join('\n')
}

// Categorização automática via Claude quando o lançamento tem descrição mas o
// caminho de linguagem natural não deduziu categoria. Devolve os NOMES; quem
// resolve para id (e valida) é o agente, via resolveCategoryPair.
export async function categorizeEntry(
  description: string,
  type: FinanceEntryType,
  tree: FinanceCategoryTree
): Promise<{ categoryName: string | null; subcategoryName: string | null }> {
  const options = buildCategorizePrompt(type, tree)
  if (!options) return { categoryName: null, subcategoryName: null }

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 30,
    system:
      `Você categoriza lançamentos financeiros. Responda APENAS com uma linha EXATA da lista, ` +
      `sem pontuação extra. Se for uma subcategoria, use o formato "Categoria > Subcategoria".\n` +
      `Opções:\n${options}`,
    messages: [{ role: 'user', content: description }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
  const [cat, sub] = raw.split('>').map((s) => s.trim())
  const valid = new Set(options.split('\n'))
  if (!valid.has(raw)) {
    // modelo saiu do script — tenta só a raiz
    const rootOnly = (type === 'pf' ? tree.pf : tree.pj).find(
      (c) => !c.isArchived && c.name.toLowerCase() === (cat ?? '').toLowerCase()
    )
    return { categoryName: rootOnly?.name ?? null, subcategoryName: null }
  }
  return { categoryName: cat ?? null, subcategoryName: sub ?? null }
}
