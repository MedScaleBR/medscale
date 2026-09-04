export interface DefaultCategoryNode {
  name: string
  children: string[]
}
export interface DefaultCategoryTree {
  pf: DefaultCategoryNode[]
  pj: DefaultCategoryNode[]
}

// Árvore curada criada na primeira vez que a conta abre /finance (ver
// lib/finance/provision.ts). Editável pelo owner depois de criada. Os nomes
// de raiz reaproveitam os das constantes antigas (PF_CATEGORIES/PJ_CATEGORIES,
// removidas) para o backfill dos lançamentos antigos casar por nome.
//
// Só categorias de DESPESA (direction 'out'). As categorias de RECEITA
// (direction 'in') não ficam aqui — são semeadas pela função SQL
// public.ensure_finance_income_seed (supabase/migration_receita_financeiro.sql),
// chamada via RPC por ensureFinanceCategories (lib/finance/provision.ts):
//   PJ: Consultas particulares, Procedimentos, Convênios, Outras receitas
//   PF: Salário / Pró-labore, Aluguéis recebidos, Investimentos, Outras receitas
export const DEFAULT_FINANCE_CATEGORIES: DefaultCategoryTree = {
  pf: [
    { name: 'Alimentação', children: ['Mercado', 'Restaurante', 'Delivery'] },
    { name: 'Moradia', children: ['Aluguel', 'Condomínio', 'Contas (luz/água/gás)', 'Internet'] },
    { name: 'Filhos', children: ['Escola', 'Saúde', 'Atividades'] },
    { name: 'Saúde', children: ['Plano', 'Farmácia', 'Consultas'] },
    { name: 'Transporte', children: ['Combustível', 'App/Táxi', 'Manutenção'] },
    { name: 'Lazer', children: ['Viagem', 'Streaming', 'Restaurantes'] },
    { name: 'Vestuário', children: [] },
    { name: 'Assinaturas', children: [] },
    { name: 'Investimentos', children: [] },
    { name: 'Impostos e taxas', children: [] },
    { name: 'Outros', children: [] },
  ],
  pj: [
    { name: 'Aluguel', children: [] },
    { name: 'Salários e encargos', children: [] },
    { name: 'Marketing', children: [] },
    { name: 'Software e assinaturas', children: [] },
    { name: 'Equipamentos', children: [] },
    { name: 'Materiais médicos', children: [] },
    { name: 'Contabilidade', children: [] },
    { name: 'Impostos', children: [] },
    { name: 'Manutenção', children: [] },
    { name: 'Outros', children: [] },
  ],
}

// Espelha public.normalize_category_name no Postgres (migration_finance_categories.sql).
// Se mudar aqui, mude lá — o índice único da tabela usa a versão SQL.
export function normalizeCategoryName(name: string): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

export function buildProvisionPayload(): DefaultCategoryTree {
  const norm = (nodes: DefaultCategoryNode[]) =>
    nodes.map((n) => ({ name: n.name, children: n.children ?? [] }))
  return { pf: norm(DEFAULT_FINANCE_CATEGORIES.pf), pj: norm(DEFAULT_FINANCE_CATEGORIES.pj) }
}
