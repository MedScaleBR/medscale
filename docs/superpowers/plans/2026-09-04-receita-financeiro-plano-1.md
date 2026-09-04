# Receita no financeiro — Plano 1 (dados + tela + espelho)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todo pagamento de consulta confirmado no ciclo de receita vira um lançamento de entrada PJ no `/finance`, e o `/finance` passa a distinguir receita de despesa (PF e PJ) com cadastro manual de receita pela tela.

**Architecture:** `finance_entries` e `finance_categories` ganham `direction ('in'|'out')`; `finance_entries` ganha `revenue_entry_id` (FK única, `on delete cascade`). O espelho do pagamento é um helper TS (`lib/revenue/finance-mirror.ts`) chamado nos 3 pontos que marcam `payment_status = 'paid'` — não há trigger, porque o repo não tem harness de teste com Postgres real. A árvore de categorias mantém a forma `{ pf: CategoryNode[]; pj: CategoryNode[] }`; o `direction` vai no nó. Categorias de receita são semeadas por uma função SQL idempotente (`ensure_finance_income_seed`).

**Tech Stack:** Next.js (app router, versão interna — ver `AGENTS.md`), TypeScript, Supabase (Postgres + RLS), Vitest, React 19, Tailwind, Recharts.

**Spec:** `docs/superpowers/specs/2026-09-04-receita-espelho-financeiro-design.md`

## Global Constraints

- **Migrations incrementais:** mudanças de banco vão em `supabase/migration_receita_financeiro.sql` (só ADD, roda no SQL Editor). `supabase/schema.sql` é a fonte de verdade para reconstrução e recebe as MESMAS mudanças, mas nunca é reexecutado em produção.
- **`AGENTS.md`:** antes de escrever código de rota/página, conferir o guia relevante em `node_modules/next/dist/docs/` — esta versão do Next tem breaking changes. O bloco gerado no topo de `AGENTS.md` é recriado por `next dev`; commitar junto se aparecer no diff.
- **`revenue_entries` / `finance_entries` são owner-only (RLS):** todo acesso de servidor a `revenue_entries` usa `createAdminClient()`. `finance_entries` nas rotas usa `createClient()` (a policy owner-only é o guarda); o helper de espelho usa `createAdminClient()`.
- **Fuso:** datas "do dia" no fuso `America/Sao_Paulo` via `saoPauloDateOnly()` de `lib/revenue/cycle.ts`. Nunca `.slice(0,10)` de ISO UTC.
- **`direction` default `'out'`** na coluna e em todo reader de body/input — mantém compatibilidade com lançamentos e chamadas existentes.
- **Categoria-raiz do espelho:** `'Consultas particulares'` (constante `REVENUE_MIRROR_CATEGORY`), `kind = 'pj'`, `direction = 'in'`.
- **Testes:** `npm run test` (vitest run). Mock de Supabase: `tests/helpers/supabase-mock.ts` (`createSupabaseMock`, `callsTo`, `filterValue`). Não há teste de componente React no projeto — tarefas de UI são verificadas por `npm run build` + preview.
- **Seed de receita (nomes, verbatim):**
  - PJ: `Consultas particulares`, `Procedimentos`, `Convênios`, `Outras receitas`
  - PF: `Salário / Pró-labore`, `Aluguéis recebidos`, `Investimentos`, `Outras receitas`

---

## File Structure

**Banco / tipos**
- `supabase/migration_receita_financeiro.sql` (criar) — todas as mudanças de schema.
- `supabase/schema.sql` (modificar) — espelhar as mudanças nas seções de `finance_categories`, `finance_entries`, índices e triggers.
- `types/database.ts` (modificar) — `direction` e `revenue_entry_id` nos Row de `finance_entries` e `finance_categories`.

**Lib**
- `lib/finance/categories.ts` (modificar) — `direction` em `CategoryNode`, `buildTree`, `getFinanceCategoryTree`, `resolveCategoryPair`.
- `lib/finance/entry-validation.ts` (modificar) — `direction` em `EntryInput`, novo erro.
- `lib/finance/category-validation.ts` (modificar) — `direction` na forma da categoria.
- `lib/finance/provision.ts` (modificar) — chamar `ensure_finance_income_seed`.
- `lib/finance/default-categories.ts` (modificar) — comentário-âncora com os nomes do seed de receita.
- `lib/finance/types.ts` (modificar) — `direction` e `revenue_entry_id` em `FinanceEntry`.
- `lib/revenue/finance-mirror.ts` (criar) — helper do espelho.

**Rotas**
- `app/api/finance/entries/route.ts` (modificar) — POST aceita `direction`.
- `app/api/finance/entries/[id]/route.ts` (modificar) — PATCH/DELETE bloqueiam espelho; PATCH revalida `direction`.
- `app/api/finance/categories/route.ts` (modificar) — POST/GET com `direction`.
- `app/api/revenue-entries/[id]/confirm/route.ts` (modificar) — chama o espelho.
- `app/api/revenue/route.ts` (modificar) — chama o espelho quando nasce `paid`.
- `lib/finance/appointment-payment.ts` (modificar) — `confirmAppointmentPayment` chama o espelho.
- `lib/finance/agent.ts` (modificar) — `getEntries` filtra `direction = 'out'` (anti-regressão; resto do agente é o Plano 2).

**Tela**
- `components/finance/FinanceEntryForm.tsx` (modificar) — toggle Receita/Despesa.
- `components/finance/FinanceCategoryPicker.tsx` (modificar) — prop `direction`.
- `components/finance/FinanceClient.tsx` (modificar) — split receita/despesa, segmento do gráfico.
- `components/finance/FinanceSummaryCards.tsx` (modificar) — 3 cards.
- `components/finance/FinanceCategoryChart.tsx` (modificar) — recebe dados do lado escolhido (sem mudança estrutural).
- `components/finance/FinanceEntryTable.tsx` (modificar) — badge de direção, esconde ações do espelho.
- `components/finance/FinanceCategoryManager.tsx` (modificar) — prop `direction`.

**Testes**
- `tests/finance/categories-tree.test.ts` (modificar)
- `tests/finance/entry-validation.test.ts` (modificar)
- `tests/finance/category-validation.test.ts` (modificar)
- `tests/finance/provision.test.ts` (modificar)
- `tests/finance/api-entries.test.ts` (modificar)
- `tests/finance/api-categories.test.ts` (modificar)
- `tests/revenue/finance-mirror.test.ts` (criar)
- `tests/revenue/cycle.test.ts` ou `tests/finance/appointment-payment.test.ts` (modificar/criar) — sites de chamada
- Vários `tests/finance/*.test.ts` — acrescentar `direction: 'out'` aos fixtures de `CategoryNode`.

---

## Task 1: Migration de banco + `schema.sql` + tipos

**Files:**
- Create: `supabase/migration_receita_financeiro.sql`
- Modify: `supabase/schema.sql` (seções de `finance_categories` ~244-256, `finance_entries` ~274-294, índices ~727-730, triggers ~835-896)
- Modify: `types/database.ts:855-948`

**Interfaces:**
- Produces: colunas `finance_categories.direction text not null default 'out'`, `finance_entries.direction text not null default 'out'`, `finance_entries.revenue_entry_id uuid unique references revenue_entries(id) on delete cascade`. Função SQL `public.ensure_finance_income_seed(p_account_id uuid) returns void`.
- Produces (tipos): `Database['public']['Tables']['finance_entries']['Row']` ganha `direction: 'in' | 'out'` e `revenue_entry_id: string | null`; `finance_categories` Row ganha `direction: 'in' | 'out'`.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migration_receita_financeiro.sql`:

```sql
-- Migração incremental: receita no financeiro (direction + espelho do ciclo).
-- Rode no SQL Editor do Supabase. NÃO rode supabase/schema.sql inteiro.
-- Só ADICIONA. O conteúdo também está em supabase/schema.sql (fonte de verdade).

-- 1. finance_categories.direction
alter table public.finance_categories
  add column if not exists direction text not null default 'out'
    check (direction in ('in','out'));

-- 2. finance_entries.direction + vínculo com o ciclo de receita
alter table public.finance_entries
  add column if not exists direction text not null default 'out'
    check (direction in ('in','out')),
  add column if not exists revenue_entry_id uuid unique
    references public.revenue_entries(id) on delete cascade;

-- 3. índices
drop index if exists public.idx_finance_categories_unique_sibling;
create unique index idx_finance_categories_unique_sibling
  on public.finance_categories(
    account_id, kind, direction,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    public.normalize_category_name(name)
  );

create index if not exists idx_finance_categories_tree_dir
  on public.finance_categories(account_id, kind, direction, parent_id, sort_order);

create index if not exists idx_finance_entries_direction
  on public.finance_entries(account_id, type, direction, entry_date desc);

-- 4. trigger: profundidade/coerência da árvore — pai tem que ter o mesmo direction
create or replace function public.enforce_finance_category_depth()
returns trigger language plpgsql as $$
declare v_parent record;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'finance_categories: categoria não pode ser pai de si mesma';
    end if;
    select account_id, kind, direction, parent_id into v_parent
      from public.finance_categories where id = new.parent_id;
    if not found then
      raise exception 'finance_categories: parent_id % inexistente', new.parent_id;
    end if;
    if v_parent.parent_id is not null then
      raise exception 'finance_categories: profundidade máxima é 2 níveis';
    end if;
    if v_parent.account_id <> new.account_id
       or v_parent.kind <> new.kind
       or v_parent.direction <> new.direction then
      raise exception 'finance_categories: parent_id de outra conta, kind ou direction';
    end if;
    if exists (select 1 from public.finance_categories where parent_id = new.id) then
      raise exception 'finance_categories: categoria com subcategorias não pode virar subcategoria';
    end if;
  end if;
  return new;
end;
$$;

-- 5. trigger: lançamento vs categoria — kind = type E direction = direction
create or replace function public.enforce_finance_entry_category()
returns trigger language plpgsql as $$
declare v_cat record; v_sub_parent uuid;
begin
  if new.category_id is not null then
    select kind, direction, parent_id into v_cat
      from public.finance_categories where id = new.category_id;
    if not found then raise exception 'finance_entries: category_id inexistente'; end if;
    if v_cat.kind <> new.type then
      raise exception 'finance_entries: kind da categoria difere do type do lançamento';
    end if;
    if v_cat.direction <> new.direction then
      raise exception 'finance_entries: direction da categoria difere do lançamento';
    end if;
  end if;
  if new.subcategory_id is not null then
    if new.category_id is null then
      raise exception 'finance_entries: subcategory_id sem category_id';
    end if;
    select parent_id into v_sub_parent
      from public.finance_categories where id = new.subcategory_id;
    if not found then raise exception 'finance_entries: subcategory_id inexistente'; end if;
    if v_sub_parent is distinct from new.category_id then
      raise exception 'finance_entries: subcategory_id não é filha de category_id';
    end if;
  end if;
  return new;
end;
$$;

-- 6. seed idempotente de categorias de receita (por conta)
create or replace function public.ensure_finance_income_seed(p_account_id uuid)
returns void language plpgsql as $$
declare v_name text; v_order int;
begin
  perform pg_advisory_xact_lock(hashtext('income-seed:' || p_account_id::text));
  if exists (select 1 from public.finance_categories
             where account_id = p_account_id and direction = 'in') then
    return;
  end if;
  v_order := 0;
  foreach v_name in array array[
    'Consultas particulares','Procedimentos','Convênios','Outras receitas'
  ] loop
    insert into public.finance_categories
      (account_id, kind, direction, parent_id, name, sort_order)
    values (p_account_id, 'pj', 'in', null, v_name, v_order);
    v_order := v_order + 1;
  end loop;
  v_order := 0;
  foreach v_name in array array[
    'Salário / Pró-labore','Aluguéis recebidos','Investimentos','Outras receitas'
  ] loop
    insert into public.finance_categories
      (account_id, kind, direction, parent_id, name, sort_order)
    values (p_account_id, 'pf', 'in', null, v_name, v_order);
    v_order := v_order + 1;
  end loop;
end;
$$;
grant execute on function public.ensure_finance_income_seed(uuid)
  to authenticated, service_role;

-- 7. semeia receita nas contas existentes (uma vez)
select public.ensure_finance_income_seed(id) from public.accounts;
```

- [ ] **Step 2: Espelhar em `schema.sql`**

Em `supabase/schema.sql`, aplicar as mudanças equivalentes **na definição das tabelas** (não como `alter`):
- `finance_categories`: adicionar `direction text not null default 'out' check (direction in ('in','out'))` após `kind`.
- `finance_entries`: adicionar `direction text not null default 'out' check (direction in ('in','out'))` após `type`; adicionar a coluna `revenue_entry_id uuid` (sem FK) na definição — **atenção:** em `schema.sql`, `finance_entries` é criada ANTES de `revenue_entries`, então a FK não pode ficar na definição da tabela. Criar a FK (`on delete cascade`) + o índice único logo após a criação de `revenue_entries` (seção 8), assim:

```sql
alter table public.finance_entries
  add constraint finance_entries_revenue_entry_id_fkey
  foreign key (revenue_entry_id) references public.revenue_entries(id) on delete cascade;
create unique index idx_finance_entries_revenue_entry
  on public.finance_entries(revenue_entry_id);
```

- Substituir o `create unique index idx_finance_categories_unique_sibling` pela versão com `direction`.
- Adicionar `idx_finance_categories_tree_dir` e `idx_finance_entries_direction` na seção 9 de índices.
- Substituir os corpos de `enforce_finance_category_depth` e `enforce_finance_entry_category` pelos da migration.
- Adicionar a função `ensure_finance_income_seed` na seção de funções do financeiro (perto de `provision_finance_categories`), com o `grant`.

- [ ] **Step 3: Atualizar `types/database.ts`**

Em `finance_entries.Row` (após `type: FinanceEntryType`):

```ts
          direction: 'in' | 'out'
```

e após `subcategory_id: string | null`:

```ts
          revenue_entry_id: string | null
```

Em `finance_categories.Row`, após `kind: FinanceEntryType`:

```ts
          direction: 'in' | 'out'
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS (podem surgir erros em arquivos que constroem `CategoryNode`/`FinanceEntry` sem `direction` — anotar; serão resolvidos nas Tasks 2 e 9. Se aparecerem só nesses arquivos, seguir).

- [ ] **Step 5: Commit**

```bash
git add supabase/migration_receita_financeiro.sql supabase/schema.sql types/database.ts
git commit -m "feat(finance): schema — direction em finance_entries/categories + vínculo com revenue_entries"
```

---

## Task 2: `direction` no nó da árvore de categorias

**Files:**
- Modify: `lib/finance/categories.ts`
- Modify: `tests/finance/categories-tree.test.ts`
- Modify (fixtures): qualquer `tests/finance/*.test.ts` que construa `CategoryNode` literal sem `direction` (identificados no Step 4).

**Interfaces:**
- Consumes: `Database[...]['finance_categories']['Row'].direction` (Task 1).
- Produces:
  - `CategoryNode` ganha `direction: 'in' | 'out'`.
  - `FinanceCategoryTree` **inalterada**: `{ pf: CategoryNode[]; pj: CategoryNode[] }`.
  - `resolveCategoryPair(tree, type, categoryName, subcategoryName, direction?: 'in' | 'out')` — 5º parâmetro opcional, default `'out'`.

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/finance/categories-tree.test.ts`, adicionar (ajustar imports/fixtures existentes conforme o arquivo):

```ts
it('cada nó carrega o direction da linha', async () => {
  const rows = [
    { id: 'd', account_id: 'a1', kind: 'pj', direction: 'out', parent_id: null, name: 'Aluguel', sort_order: 0, is_archived: false, created_at: '' },
    { id: 'r', account_id: 'a1', kind: 'pj', direction: 'in', parent_id: null, name: 'Consultas particulares', sort_order: 0, is_archived: false, created_at: '' },
  ]
  const supabase = createSupabaseMock({ finance_categories: { select: { data: rows } } })
  const tree = await getFinanceCategoryTree(supabase.client as never, 'a1')
  expect(tree.pj.find((c) => c.id === 'd')!.direction).toBe('out')
  expect(tree.pj.find((c) => c.id === 'r')!.direction).toBe('in')
})

it('resolveCategoryPair filtra pela direção', () => {
  const tree = {
    pf: [], pj: [
      { id: 'r', name: 'Outras receitas', direction: 'in' as const, sortOrder: 0, isArchived: false, children: [] },
      { id: 'd', name: 'Outras receitas', direction: 'out' as const, sortOrder: 0, isArchived: false, children: [] },
    ],
  }
  expect(resolveCategoryPair(tree, 'pj', 'Outras receitas', null, 'in').categoryId).toBe('r')
  expect(resolveCategoryPair(tree, 'pj', 'Outras receitas', null, 'out').categoryId).toBe('d')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- tests/finance/categories-tree.test.ts`
Expected: FAIL (`direction` ausente / assinatura de `resolveCategoryPair`).

- [ ] **Step 3: Implementar**

Em `lib/finance/categories.ts`:

```ts
export interface CategoryNode {
  id: string
  name: string
  direction: 'in' | 'out'
  sortOrder: number
  isArchived: boolean
  children: CategoryNode[]
}
```

No `select` de `getFinanceCategoryTree`, incluir `direction`:

```ts
    .select('id, account_id, kind, direction, parent_id, name, sort_order, is_archived, created_at')
```

Em `buildTree`, no `node()`:

```ts
  const node = (r: Row): CategoryNode => ({
    id: r.id, name: r.name, direction: r.direction, sortOrder: r.sort_order,
    isArchived: r.is_archived, children: [],
  })
```

`resolveCategoryPair` — novo parâmetro e filtro:

```ts
export function resolveCategoryPair(
  tree: FinanceCategoryTree,
  type: FinanceEntryType | null,
  categoryName: string | null,
  subcategoryName: string | null,
  direction: 'in' | 'out' = 'out'
): ResolvedCategoryPair {
  if (!categoryName) return EMPTY
  const kinds: FinanceEntryType[] = type ? [type] : ['pf', 'pj']
  const target = normalizeCategoryName(categoryName)
  for (const kind of kinds) {
    const cat = tree[kind].find(
      (c) => c.direction === direction && normalizeCategoryName(c.name) === target
    )
    if (!cat) continue
    // ...resto inalterado
  }
  return EMPTY
}
```

- [ ] **Step 4: Corrigir fixtures quebrados**

Run: `npm run test`
Para cada falha de tipo/asserção causada por `CategoryNode` sem `direction`, adicionar `direction: 'out'` ao literal (é o default de despesa). Arquivos prováveis: `tests/finance/entry-validation.test.ts`, `tests/finance/category-validation.test.ts`, `tests/finance/api-entries.test.ts`, `tests/finance/api-categories.test.ts`, `tests/finance/resolve-unit.test.ts`, `tests/finance/agent-category.test.ts`. Nas linhas de mock que passam **linhas cruas** de `finance_categories` (com `kind`, `parent_id`…), adicionar `direction: 'out'`.

- [ ] **Step 5: Rodar tudo**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/finance/categories.ts tests/
git commit -m "feat(finance): direction no nó da árvore de categorias"
```

---

## Task 3: Validação de lançamento e de categoria com `direction`

**Files:**
- Modify: `lib/finance/entry-validation.ts`
- Modify: `lib/finance/category-validation.ts`
- Modify: `tests/finance/entry-validation.test.ts`
- Modify: `tests/finance/category-validation.test.ts`

**Interfaces:**
- Consumes: `CategoryNode.direction` (Task 2).
- Produces:
  - `EntryInput` ganha `direction: 'in' | 'out'`.
  - `EntryValidationError` ganha `{ code: 'category_direction_mismatch' }`.
  - `validateCategoryShape` input ganha `direction: 'in' | 'out'`; `CategoryValidationError` ganha `{ code: 'parent_direction_mismatch' }`.

- [ ] **Step 1: Testes que falham**

`tests/finance/entry-validation.test.ts` — atualizar `base` e `TREE`:

```ts
const TREE: FinanceCategoryTree = {
  pf: [{ id: 'fil', name: 'Filhos', direction: 'out', sortOrder: 0, isArchived: false, children: [
        { id: 'esc', name: 'Escola', direction: 'out', sortOrder: 0, isArchived: false, children: [] }] }],
  pj: [
    { id: 'alu', name: 'Aluguel', direction: 'out', sortOrder: 0, isArchived: false, children: [] },
    { id: 'rec', name: 'Consultas particulares', direction: 'in', sortOrder: 0, isArchived: false, children: [] },
  ],
}
const base = { type: 'pf' as const, entryDate: '2026-09-01', amount: 100, categoryId: null, subcategoryId: null, direction: 'out' as const }
```

Novos casos:

```ts
it('rejeita categoria de direção diferente do lançamento', () => {
  expect(validateEntryInput(TREE, { ...base, type: 'pj', direction: 'out', categoryId: 'rec' }))
    .toEqual({ code: 'category_direction_mismatch' })
})
it('aceita categoria de receita num lançamento de entrada', () => {
  expect(validateEntryInput(TREE, { ...base, type: 'pj', direction: 'in', categoryId: 'rec' })).toBeNull()
})
```

`tests/finance/category-validation.test.ts` — passar `direction: 'out'` no input base dos casos existentes e adicionar:

```ts
it('rejeita subcategoria cujo pai tem outra direção', () => {
  // árvore com raiz 'in' e tentativa de pendurar sub 'out'
  const tree = { pf: [], pj: [
    { id: 'r', name: 'Receitas', direction: 'in' as const, sortOrder: 0, isArchived: false, children: [] },
  ] }
  expect(validateCategoryShape(tree, { kind: 'pj', direction: 'out', name: 'X', parentId: 'r' }))
    .toEqual({ code: 'parent_direction_mismatch' })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- tests/finance/entry-validation.test.ts tests/finance/category-validation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `entry-validation.ts`**

```ts
export type EntryValidationError =
  | { code: 'amount_invalid' }
  | { code: 'date_invalid' }
  | { code: 'category_not_found' }
  | { code: 'subcategory_not_found' }
  | { code: 'category_kind_mismatch' }
  | { code: 'category_direction_mismatch' }
  | { code: 'subcategory_not_child' }

export interface EntryInput {
  type: FinanceEntryType
  entryDate: string
  amount: number
  categoryId: string | null
  subcategoryId: string | null
  direction: 'in' | 'out'
}
```

`findRoot` — devolver o nó cru e deixar a checagem no chamador, ou já filtrar. Manter simples: em `validateEntryInput`, após achar `root`:

```ts
  if (input.categoryId) {
    root = findRoot(tree, input.categoryId)
    if (!root) return { code: 'category_not_found' }
    if (root.kind !== input.type) return { code: 'category_kind_mismatch' }
    if (root.node.direction !== input.direction) return { code: 'category_direction_mismatch' }
  }
```

- [ ] **Step 4: Implementar `category-validation.ts`**

Adicionar `{ code: 'parent_direction_mismatch' }` a `CategoryValidationError`. Em `validateCategoryShape`, o input passa a ter `direction: 'in' | 'out'`. Na checagem de pai:

```ts
  if (input.parentId) {
    const parent = flat.find((f) => f.node.id === input.parentId)
    if (!parent) return { code: 'parent_not_found' }
    if (parent.parentId !== null) return { code: 'parent_not_root' }
    if (parent.kind !== input.kind) return { code: 'parent_kind_mismatch' }
    if (parent.node.direction !== input.direction) return { code: 'parent_direction_mismatch' }
  }
```

E o `siblingClash` passa a exigir também `f.node.direction === input.direction`.

- [ ] **Step 5: Rodar**

Run: `npm run test -- tests/finance/entry-validation.test.ts tests/finance/category-validation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/finance/entry-validation.ts lib/finance/category-validation.ts tests/
git commit -m "feat(finance): validação de direction em lançamento e categoria"
```

---

## Task 4: Semear categorias de receita no provisionamento

**Files:**
- Modify: `lib/finance/provision.ts`
- Modify: `lib/finance/default-categories.ts`
- Modify: `tests/finance/provision.test.ts`

**Interfaces:**
- Consumes: RPC `ensure_finance_income_seed(p_account_id uuid)` (Task 1).
- Produces: `ensureFinanceCategories` passa a garantir também o seed de receita (idempotente, degradação graciosa se a função não existir).

- [ ] **Step 1: Teste que falha**

Em `tests/finance/provision.test.ts`:

```ts
it('também chama ensure_finance_income_seed', async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null })
  const client = { rpc } as unknown as SupabaseClient<Database>
  await ensureFinanceCategories(client, 'a1')
  expect(rpc).toHaveBeenCalledWith('provision_finance_categories', expect.anything())
  expect(rpc).toHaveBeenCalledWith('ensure_finance_income_seed', { p_account_id: 'a1' })
})

it('não lança se ensure_finance_income_seed ainda não existe no banco', async () => {
  const rpc = vi.fn()
    .mockResolvedValueOnce({ error: null }) // provision_finance_categories
    .mockResolvedValueOnce({ error: { code: '42883', message: 'function ensure_finance_income_seed does not exist' } })
  const client = { rpc } as unknown as SupabaseClient<Database>
  await expect(ensureFinanceCategories(client, 'a1')).resolves.toBeUndefined()
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- tests/finance/provision.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Em `lib/finance/provision.ts`, após o bloco que trata `provision_finance_categories` (no fim da função, antes do `return`/`throw` final bem-sucedido), extrair a lógica de "function missing" para uma helper local e chamar o segundo RPC:

```ts
export async function ensureFinanceCategories(
  client: SupabaseClient<Database>,
  accountId: string
): Promise<void> {
  const provision = await client.rpc('provision_finance_categories', {
    p_account_id: accountId,
    p_tree: buildProvisionPayload() as unknown as Database['public']['Functions']['provision_finance_categories']['Args']['p_tree'],
  })
  if (provision.error && !isFunctionMissing(provision.error)) {
    throw new Error((provision.error as { message?: string }).message ?? 'Erro ao provisionar categorias')
  }
  if (provision.error) {
    console.warn('[finance] provision_finance_categories ainda não existe no banco; seguindo.')
  }

  const seed = await client.rpc('ensure_finance_income_seed', { p_account_id: accountId })
  if (seed.error && !isFunctionMissing(seed.error)) {
    throw new Error((seed.error as { message?: string }).message ?? 'Erro ao semear categorias de receita')
  }
  if (seed.error) {
    console.warn('[finance] ensure_finance_income_seed ainda não existe no banco; seguindo.')
  }
}

function isFunctionMissing(error: unknown): boolean {
  const code = (error as { code?: string }).code
  const msg = ((error as { message?: string }).message ?? '').toLowerCase()
  return (
    code === '42883' ||
    (msg.includes('does not exist') || msg.includes('could not find'))
  )
}
```

Adicionar `ensure_finance_income_seed` à assinatura de `Database['public']['Functions']` em `types/database.ts` se o `rpc()` tipado reclamar (Args `{ p_account_id: string }`, Returns `undefined`).

Em `lib/finance/default-categories.ts`, adicionar comentário-âncora:

```ts
// Categorias de RECEITA (direction 'in') NÃO ficam aqui — são semeadas pela
// função SQL public.ensure_finance_income_seed (migration_receita_financeiro.sql):
//   PJ: Consultas particulares, Procedimentos, Convênios, Outras receitas
//   PF: Salário / Pró-labore, Aluguéis recebidos, Investimentos, Outras receitas
```

- [ ] **Step 4: Rodar**

Run: `npm run test -- tests/finance/provision.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/finance/provision.ts lib/finance/default-categories.ts types/database.ts tests/
git commit -m "feat(finance): provisiona categorias de receita via ensure_finance_income_seed"
```

---

## Task 5: Rotas `/api/finance/entries` — `direction` + trava do espelho

**Files:**
- Modify: `app/api/finance/entries/route.ts`
- Modify: `app/api/finance/entries/[id]/route.ts`
- Modify: `tests/finance/api-entries.test.ts`

**Interfaces:**
- Consumes: `EntryInput.direction`, `category_direction_mismatch` (Task 3); `resolveCategoryPair(..., direction)` (Task 2).
- Produces: POST aceita `direction` no body (default `'out'`); PATCH/DELETE em linha com `revenue_entry_id` respondem `409 { code: 'revenue_mirror_locked' }`.

- [ ] **Step 1: Ler o guia de rotas**

Conferir `node_modules/next/dist/docs/` sobre route handlers / `params` (esta versão do Next difere do conhecido).

- [ ] **Step 2: Testes que falham**

Em `tests/finance/api-entries.test.ts`, adicionar `direction: 'out'` às linhas de `CATS`/`CATS_ARCHIVED` e adicionar:

```ts
const CATS_IN = [
  { id: 'rec', account_id: 'a1', kind: 'pj', direction: 'in', parent_id: null, name: 'Consultas particulares', sort_order: 0, is_archived: false, created_at: '' },
]

it('POST sem direction grava out', async () => {
  g.supabase = createSupabaseMock({
    finance_categories: { select: { data: CATS } },
    finance_entries: { insert: { data: { id: 'e1' } } },
  })
  const res = await POST(body({ type: 'pf', entry_date: '2026-09-01', amount: 10 }) as never)
  expect(res.status).toBe(201)
  const ins = g.supabase.callsTo('finance_entries', 'insert')[0]
  expect((ins.payload as Record<string, unknown>).direction).toBe('out')
})

it('POST receita com categoria in grava direction in', async () => {
  g.supabase = createSupabaseMock({
    finance_categories: { select: { data: CATS_IN } },
    workspaces: { select: { data: { id: 'w1' } } },
    finance_entries: { insert: { data: { id: 'e2' } } },
  })
  const res = await POST(body({ type: 'pj', entry_date: '2026-09-01', amount: 300, direction: 'in', category_id: 'rec', workspace_id: 'w1' }) as never)
  expect(res.status).toBe(201)
  const ins = g.supabase.callsTo('finance_entries', 'insert')[0]
  expect((ins.payload as Record<string, unknown>).direction).toBe('in')
  expect((ins.payload as Record<string, unknown>).category).toBe('Consultas particulares')
})

it('POST 400 quando categoria é de direção diferente', async () => {
  g.supabase = createSupabaseMock({ finance_categories: { select: { data: CATS } } })
  const res = await POST(body({ type: 'pf', entry_date: '2026-09-01', amount: 10, direction: 'in', category_id: 'fil' }) as never)
  expect(res.status).toBe(400)
  expect((await res.json()).code).toBe('category_direction_mismatch')
})

it('PATCH 409 em lançamento do ciclo de receita', async () => {
  g.supabase = createSupabaseMock({
    finance_categories: { select: { data: CATS } },
    finance_entries: { select: { data: { id: 'm1', account_id: 'a1', type: 'pj', revenue_entry_id: 're1' } } },
  })
  const res = await PATCH(new Request('https://app.test/x', { method: 'PATCH', body: JSON.stringify({ amount: 1 }), headers: { 'content-type': 'application/json' } }) as never, params('m1') as never)
  expect(res.status).toBe(409)
  expect((await res.json()).code).toBe('revenue_mirror_locked')
})

it('DELETE 409 em lançamento do ciclo de receita', async () => {
  g.supabase = createSupabaseMock({
    finance_entries: { select: { data: { id: 'm1', account_id: 'a1', type: 'pj', revenue_entry_id: 're1' } } },
  })
  const res = await DELETE(new Request('https://app.test/x', { method: 'DELETE' }) as never, params('m1') as never)
  expect(res.status).toBe(409)
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run test -- tests/finance/api-entries.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementar POST (`route.ts`)**

Em `readEntryBody`, adicionar:

```ts
    direction: b.direction === 'in' ? 'in' as const : 'out' as const,
```

Passar `direction` ao `validateEntryInput`:

```ts
  const err = validateEntryInput(tree, {
    type: b.type,
    entryDate: b.entryDate ?? '',
    amount: b.amount ?? NaN,
    categoryId: b.categoryId ?? null,
    subcategoryId: b.subcategoryId ?? null,
    direction: b.direction,
  })
```

`rootCategoryName` não muda (busca por id). No `payload`, adicionar `direction: b.direction`.

- [ ] **Step 5: Implementar PATCH/DELETE (`[id]/route.ts`)**

No começo dos dois handlers, depois de resolver `id` e o guard, buscar a linha e travar:

```ts
  const { data: existing } = await supabase
    .from('finance_entries')
    .select('id, account_id, type, direction, revenue_entry_id')
    .eq('id', id)
    .eq('account_id', g.session.accountId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Lançamento não encontrado' }, { status: 404 })
  if (existing.revenue_entry_id) {
    return NextResponse.json(
      { error: 'Lançamento gerido pelo ciclo de receita', code: 'revenue_mirror_locked' },
      { status: 409 }
    )
  }
```

(Substituir/reaproveitar o `select` que a rota já faz para o 404 — o `select` novo já traz `direction` e `revenue_entry_id`.)

No PATCH, definir `const nextDirection = body.direction === 'in' || body.direction === 'out' ? body.direction : existing.direction`. Se `body.category_id !== undefined` **ou** `body.direction !== undefined`, chamar `validateEntryInput(tree, { type: existing.type, entryDate: '2000-01-01', amount: 1, categoryId: nextCategoryId, subcategoryId: nextSubcategoryId, direction: nextDirection })` (data/amount são placeholders só para reaproveitar a checagem de categoria×direção) e devolver `400 { code }` se erro. Incluir `direction: nextDirection` no `patch` quando `body.direction` veio. Manter o snapshot de `category` quando `category_id` muda.

- [ ] **Step 6: Rodar**

Run: `npm run test -- tests/finance/api-entries.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/finance/entries/ tests/
git commit -m "feat(finance): rota de lançamentos aceita direction e trava o espelho do ciclo"
```

---

## Task 6: Rota `/api/finance/categories` — `direction`

**Files:**
- Modify: `app/api/finance/categories/route.ts`
- Modify: `tests/finance/api-categories.test.ts`

**Interfaces:**
- Consumes: `validateCategoryShape` com `direction` (Task 3).
- Produces: `POST /api/finance/categories` aceita `direction` (default `'out'`) e grava; `GET` aceita `?direction=in|out` e filtra os nós retornados.

- [ ] **Step 1: Testes que falham**

Em `tests/finance/api-categories.test.ts` (adicionar `direction: 'out'` aos fixtures existentes) e:

```ts
it('POST cria categoria de receita quando direction=in', async () => {
  g.supabase = createSupabaseMock({
    finance_categories: { select: { data: [] }, insert: { data: { id: 'novo' } } },
  })
  const res = await POST(new Request('https://app.test/x', { method: 'POST', body: JSON.stringify({ kind: 'pj', name: 'Telemedicina', direction: 'in' }), headers: { 'content-type': 'application/json' } }) as never)
  expect(res.status).toBe(201)
  const ins = g.supabase.callsTo('finance_categories', 'insert')[0]
  expect((ins.payload as Record<string, unknown>).direction).toBe('in')
})

it('GET ?direction=in devolve só categorias de receita', async () => {
  g.supabase = createSupabaseMock({
    finance_categories: { select: { data: [
      { id: 'd', account_id: 'a1', kind: 'pj', direction: 'out', parent_id: null, name: 'Aluguel', sort_order: 0, is_archived: false, created_at: '' },
      { id: 'r', account_id: 'a1', kind: 'pj', direction: 'in', parent_id: null, name: 'Consultas particulares', sort_order: 0, is_archived: false, created_at: '' },
    ] } },
    finance_entries: { select: { data: [] } },
  })
  const res = await GET(new NextRequest('https://app.test/api/finance/categories?kind=pj&direction=in') as never)
  const body = await res.json()
  expect(body.pj.map((c: { id: string }) => c.id)).toEqual(['r'])
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- tests/finance/api-categories.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

POST: ler `direction` do body (`body.direction === 'in' ? 'in' : 'out'`), passar a `validateCategoryShape({ kind, name, parentId, direction })` e incluir `direction` no `insert`. Quando `parentId` for informado, o `direction` deve ser o do pai — resolver o pai na árvore e usar `parent.direction` em vez do body (subcategoria herda).

GET: ler `const direction = new URL(req.url).searchParams.get('direction')`. Se `=== 'in' || === 'out'`, filtrar `tree.pf`/`tree.pj` para só os nós com aquele `direction` **antes** de `withCounts`. Sem o param, comportamento atual (todos).

- [ ] **Step 4: Rodar**

Run: `npm run test -- tests/finance/api-categories.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/finance/categories/route.ts tests/
git commit -m "feat(finance): CRUD de categorias entende direction"
```

---

## Task 7: Helper do espelho — `lib/revenue/finance-mirror.ts`

**Files:**
- Create: `lib/revenue/finance-mirror.ts`
- Create: `tests/revenue/finance-mirror.test.ts`

**Interfaces:**
- Consumes: `ensureFinanceCategories` (Task 4), `getFinanceCategoryTree` (Task 2), `saoPauloDateOnly` (`lib/revenue/cycle.ts`).
- Produces:
  - `export const REVENUE_MIRROR_CATEGORY = 'Consultas particulares'`
  - `export async function mirrorPaidRevenueToFinance(supabase, input: MirrorInput): Promise<void>`
  - `export async function unmirrorPaidRevenue(supabase, revenueEntryId: string): Promise<void>`
  - `export interface MirrorInput { id: string; accountId: string; workspaceId: string; amount: number; procedureName: string | null; paidAtIso: string | null }`

- [ ] **Step 1: Escrever os testes que falham**

`tests/revenue/finance-mirror.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createSupabaseMock, filterValue, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client, createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/finance/provision', () => ({ ensureFinanceCategories: vi.fn().mockResolvedValue(undefined) }))

import { mirrorPaidRevenueToFinance, unmirrorPaidRevenue, REVENUE_MIRROR_CATEGORY } from '@/lib/revenue/finance-mirror'

const CATS_IN = [
  { id: 'rec', account_id: 'a1', kind: 'pj', direction: 'in', parent_id: null, name: 'Consultas particulares', sort_order: 0, is_archived: false, created_at: '' },
]
const input = {
  id: 're1', accountId: 'a1', workspaceId: 'w1', amount: 300,
  procedureName: 'Consulta cardiológica', paidAtIso: '2026-09-04T17:30:00.000Z',
}

describe('mirrorPaidRevenueToFinance', () => {
  it('cria o finance_entry de entrada espelhando o pagamento', async () => {
    g.supabase = createSupabaseMock({
      finance_entries: { select: { data: null }, insert: { data: { id: 'fe1' } } },
      finance_categories: { select: { data: CATS_IN } },
    })
    await mirrorPaidRevenueToFinance(g.supabase.client as never, input)
    const ins = g.supabase.callsTo('finance_entries', 'insert')[0]
    const p = ins.payload as Record<string, unknown>
    expect(p.direction).toBe('in')
    expect(p.type).toBe('pj')
    expect(p.amount).toBe(300)
    expect(p.workspace_id).toBe('w1')
    expect(p.entry_date).toBe('2026-09-04')
    expect(p.revenue_entry_id).toBe('re1')
    expect(p.category).toBe(REVENUE_MIRROR_CATEGORY)
    expect(p.category_id).toBe('rec')
    expect(p.recorded_by_phone).toBe('revenue-cycle')
    expect(p.raw_message).toBe('(ciclo de receita)')
    expect(p.description).toBe('Consulta cardiológica')
  })

  it('é idempotente — não insere se já existe espelho', async () => {
    g.supabase = createSupabaseMock({
      finance_entries: { select: { data: { id: 'fe1' } }, insert: { data: { id: 'x' } } },
      finance_categories: { select: { data: CATS_IN } },
    })
    await mirrorPaidRevenueToFinance(g.supabase.client as never, input)
    expect(g.supabase.callsTo('finance_entries', 'insert')).toHaveLength(0)
  })

  it('insere com category_id null quando a categoria de receita não existe', async () => {
    g.supabase = createSupabaseMock({
      finance_entries: { select: { data: null }, insert: { data: { id: 'fe1' } } },
      finance_categories: { select: { data: [] } },
    })
    await mirrorPaidRevenueToFinance(g.supabase.client as never, input)
    const p = g.supabase.callsTo('finance_entries', 'insert')[0].payload as Record<string, unknown>
    expect(p.category_id).toBeNull()
    expect(p.category).toBe(REVENUE_MIRROR_CATEGORY)
  })

  it('não lança quando o insert falha', async () => {
    g.supabase = createSupabaseMock({
      finance_entries: { select: { data: null }, insert: { data: null, error: { message: 'boom' } } },
      finance_categories: { select: { data: CATS_IN } },
    })
    await expect(mirrorPaidRevenueToFinance(g.supabase.client as never, input)).resolves.toBeUndefined()
  })

  it('usa a data de hoje em SP quando paidAtIso é null', async () => {
    g.supabase = createSupabaseMock({
      finance_entries: { select: { data: null }, insert: { data: { id: 'fe1' } } },
      finance_categories: { select: { data: CATS_IN } },
    })
    await mirrorPaidRevenueToFinance(g.supabase.client as never, { ...input, paidAtIso: null })
    const p = g.supabase.callsTo('finance_entries', 'insert')[0].payload as Record<string, unknown>
    expect(String(p.entry_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('unmirrorPaidRevenue', () => {
  it('apaga o espelho pela revenue_entry_id', async () => {
    g.supabase = createSupabaseMock({ finance_entries: { delete: { data: null, count: 1 } } })
    await unmirrorPaidRevenue(g.supabase.client as never, 're1')
    const del = g.supabase.callsTo('finance_entries', 'delete')[0]
    expect(filterValue(del, 'eq', 'revenue_entry_id')).toBe('re1')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- tests/revenue/finance-mirror.test.ts`
Expected: FAIL ("Cannot find module '@/lib/revenue/finance-mirror'").

- [ ] **Step 3: Implementar `lib/revenue/finance-mirror.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { ensureFinanceCategories } from '@/lib/finance/provision'
import { getFinanceCategoryTree } from '@/lib/finance/categories'
import { saoPauloDateOnly } from '@/lib/revenue/cycle'
import { normalizeCategoryName } from '@/lib/finance/default-categories'

type SupabaseAdmin = SupabaseClient<Database>

// Categoria-raiz PJ (direction 'in') que o espelho do ciclo de receita usa.
export const REVENUE_MIRROR_CATEGORY = 'Consultas particulares'

export interface MirrorInput {
  id: string
  accountId: string
  workspaceId: string
  amount: number
  procedureName: string | null
  paidAtIso: string | null
}

// Cria (idempotente) o finance_entry de entrada que espelha um pagamento de
// receita confirmado. Nunca lança — falha é logada. Ver
// docs/superpowers/specs/2026-09-04-receita-espelho-financeiro-design.md.
export async function mirrorPaidRevenueToFinance(
  supabase: SupabaseAdmin,
  input: MirrorInput
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('finance_entries')
      .select('id')
      .eq('revenue_entry_id', input.id)
      .maybeSingle()
    if (existing) return

    await ensureFinanceCategories(supabase, input.accountId)
    const tree = await getFinanceCategoryTree(supabase, input.accountId)
    const target = normalizeCategoryName(REVENUE_MIRROR_CATEGORY)
    const cat = tree.pj.find(
      (c) => c.direction === 'in' && normalizeCategoryName(c.name) === target
    )

    const entryDate = saoPauloDateOnly(input.paidAtIso ?? new Date().toISOString())

    const payload: Database['public']['Tables']['finance_entries']['Insert'] = {
      account_id: input.accountId,
      workspace_id: input.workspaceId,
      recorded_by_phone: 'revenue-cycle',
      type: 'pj',
      direction: 'in',
      description: input.procedureName ?? 'Consulta',
      amount: input.amount,
      category: REVENUE_MIRROR_CATEGORY,
      category_id: cat?.id ?? null,
      subcategory_id: null,
      raw_message: '(ciclo de receita)',
      entry_date: entryDate,
      revenue_entry_id: input.id,
    }

    const { error } = await supabase.from('finance_entries').insert(payload)
    if (error) {
      console.error('[revenue-mirror] falha ao criar espelho do pagamento', {
        revenueEntryId: input.id,
        error: error.message,
      })
    }
  } catch (err) {
    console.error('[revenue-mirror] erro inesperado ao espelhar pagamento', {
      revenueEntryId: input.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Remove o espelho de uma revenue_entry (reembolso / correção de status).
// Hoje sem call site — a exclusão da revenue_entry cascateia via FK. Pronta
// para quando existir um fluxo de estorno.
export async function unmirrorPaidRevenue(
  supabase: SupabaseAdmin,
  revenueEntryId: string
): Promise<void> {
  const { error } = await supabase
    .from('finance_entries')
    .delete()
    .eq('revenue_entry_id', revenueEntryId)
  if (error) {
    console.error('[revenue-mirror] falha ao remover espelho', { revenueEntryId, error: error.message })
  }
}
```

- [ ] **Step 4: Rodar**

Run: `npm run test -- tests/revenue/finance-mirror.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/revenue/finance-mirror.ts tests/revenue/finance-mirror.test.ts
git commit -m "feat(revenue): helper que espelha pagamento confirmado como lançamento PJ"
```

---

## Task 8: Fiar o espelho nos 3 pontos que marcam `paid`

**Files:**
- Modify: `app/api/revenue-entries/[id]/confirm/route.ts`
- Modify: `app/api/revenue/route.ts`
- Modify: `lib/finance/appointment-payment.ts`
- Modify: `tests/revenue/cycle.test.ts` (ou criar `tests/finance/appointment-payment.test.ts`)
- Create: `tests/finance/revenue-confirm-mirror.test.ts`

**Interfaces:**
- Consumes: `mirrorPaidRevenueToFinance` (Task 7).
- Produces: as 3 transições para `paid` chamam o espelho com os campos da linha.

- [ ] **Step 1: Testes que falham**

`tests/finance/revenue-confirm-mirror.test.ts` — cobre a rota `confirm` e a rota `POST /api/revenue`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))
const mirror = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client, createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/session/api', () => ({
  requireWorkspaceSession: async () => ({ session: { userId: 'u1', accountId: 'a1', workspaceId: 'w1', role: 'owner', modules: ['revenue_cycle'] } }),
  requireModule: () => null,
}))
vi.mock('@/lib/revenue/finance-mirror', () => ({ mirrorPaidRevenueToFinance: mirror, REVENUE_MIRROR_CATEGORY: 'Consultas particulares' }))

import { POST as CONFIRM } from '@/app/api/revenue-entries/[id]/confirm/route'
import { POST as CREATE_REVENUE } from '@/app/api/revenue/route'

beforeEach(() => mirror.mockClear())

it('confirmar pagamento chama o espelho com os campos da linha', async () => {
  g.supabase = createSupabaseMock({
    revenue_entries: {
      select: { data: { id: 're1', payment_status: 'realized' } },
      update: { data: { id: 're1', account_id: 'a1', workspace_id: 'w1', amount: 250, procedure_name: 'Retorno', paid_at: '2026-09-04T12:00:00Z' } },
    },
  })
  const res = await CONFIRM(new Request('https://app.test/x', { method: 'POST', body: JSON.stringify({ payment_method: 'pix' }), headers: { 'content-type': 'application/json' } }) as never, { params: Promise.resolve({ id: 're1' }) } as never)
  expect(res.status).toBe(200)
  expect(mirror).toHaveBeenCalledWith(expect.anything(), {
    id: 're1', accountId: 'a1', workspaceId: 'w1', amount: 250, procedureName: 'Retorno', paidAtIso: '2026-09-04T12:00:00Z',
  })
})

it('lançamento avulso previsto NÃO chama o espelho', async () => {
  g.supabase = createSupabaseMock({
    revenue_entries: { insert: { data: { id: 're2', account_id: 'a1', workspace_id: 'w1', amount: 100, procedure_name: null, paid_at: null, payment_status: 'pending' } } },
  })
  const res = await CREATE_REVENUE(new Request('https://app.test/x', { method: 'POST', body: JSON.stringify({ amount: 100, status: 'previsto' }), headers: { 'content-type': 'application/json' } }) as never)
  expect(res.status).toBe(201)
  expect(mirror).not.toHaveBeenCalled()
})

it('lançamento avulso confirmado chama o espelho', async () => {
  g.supabase = createSupabaseMock({
    revenue_entries: { insert: { data: { id: 're3', account_id: 'a1', workspace_id: 'w1', amount: 100, procedure_name: null, paid_at: '2026-09-04T12:00:00Z', payment_status: 'paid' } } },
  })
  const res = await CREATE_REVENUE(new Request('https://app.test/x', { method: 'POST', body: JSON.stringify({ amount: 100, status: 'confirmado', payment_method: 'pix' }), headers: { 'content-type': 'application/json' } }) as never)
  expect(res.status).toBe(201)
  expect(mirror).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 're3', amount: 100 }))
})
```

Para `confirmAppointmentPayment`, adicionar em `tests/revenue/cycle.test.ts` (ou novo arquivo) um caso com `vi.mock('@/lib/revenue/finance-mirror', ...)` verificando que o mirror é chamado só quando o `update` devolve linha (`data` não-nulo) e não quando `data` é `null`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- tests/finance/revenue-confirm-mirror.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar — rota `confirm`**

Em `app/api/revenue-entries/[id]/confirm/route.ts`, garantir que o `update(...).select()` traga os campos necessários (`select('id, account_id, workspace_id, amount, procedure_name, paid_at')` — ou manter `.select()` completo). Depois do `if (error) ...`, antes do `return NextResponse.json(data)`:

```ts
  await mirrorPaidRevenueToFinance(supabase, {
    id: data.id,
    accountId: data.account_id,
    workspaceId: data.workspace_id,
    amount: Number(data.amount),
    procedureName: data.procedure_name ?? null,
    paidAtIso: data.paid_at ?? null,
  })
```

Import no topo: `import { mirrorPaidRevenueToFinance } from '@/lib/revenue/finance-mirror'`.

- [ ] **Step 4: Implementar — `POST /api/revenue`**

Após o insert bem-sucedido, quando `paymentStatus === 'paid'`:

```ts
  if (paymentStatus === 'paid' && data) {
    await mirrorPaidRevenueToFinance(supabase, {
      id: data.id,
      accountId: data.account_id,
      workspaceId: data.workspace_id,
      amount: Number(data.amount),
      procedureName: data.procedure_name ?? null,
      paidAtIso: data.paid_at ?? null,
    })
  }
```

- [ ] **Step 5: Implementar — `confirmAppointmentPayment`**

Em `lib/finance/appointment-payment.ts`, o `update` já faz `.select('id')`. Ampliar para `.select('id, account_id, workspace_id, amount, procedure_name, paid_at')`. Após confirmar que `data` existe (retorno `true`), antes do `return`:

```ts
  await mirrorPaidRevenueToFinance(supabase, {
    id: data.id,
    accountId: data.account_id,
    workspaceId: data.workspace_id,
    amount: Number(data.amount),
    procedureName: data.procedure_name ?? null,
    paidAtIso: data.paid_at ?? null,
  })
```

Import: `import { mirrorPaidRevenueToFinance } from '@/lib/revenue/finance-mirror'`.

- [ ] **Step 5b: Blindar `getEntries` do agente contra receita**

`lib/finance/agent.ts` — `getEntries()` alimenta as consultas de gasto do WhatsApp ("quanto gastei"). Sem filtro, passaria a somar receitas manuais/espelho. Adicionar, na montagem do `query`:

```ts
  query = query.eq('direction', 'out')
```

(O suporte a consultar receita pelo WhatsApp é o Plano 2; aqui só travamos a regressão.) Teste em `tests/finance/agent-*.test.ts` (ou o que cobre `getEntries`): mock com linhas `direction:'in'` e `direction:'out'`, esperar só as `'out'` no resultado — verificando `filterValue(call, 'eq', 'direction') === 'out'`.

- [ ] **Step 6: Rodar a suíte relevante**

Run: `npm run test -- tests/finance/revenue-confirm-mirror.test.ts tests/revenue/cycle.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/revenue-entries/ app/api/revenue/ lib/finance/appointment-payment.ts lib/finance/agent.ts tests/
git commit -m "feat(revenue): confirmar pagamento espelha lançamento PJ no financeiro"
```

---

## Task 9: `FinanceEntry` type + `lib/finance/types.ts`

**Files:**
- Modify: `lib/finance/types.ts`

**Interfaces:**
- Produces: `FinanceEntry` ganha `direction: 'in' | 'out'` e `revenue_entry_id: string | null`.

- [ ] **Step 1: Implementar**

Em `lib/finance/types.ts`, no `type FinanceEntry`, após `type: FinanceEntryType`:

```ts
  // Entrada (receita) ou saída (despesa). Lançamento manual da tela e do
  // agente é sempre 'out'; 'in' vem do cadastro de receita ou do espelho do
  // ciclo de receita.
  direction: 'in' | 'out'
```

e após `subcategory_id: string | null`:

```ts
  // Preenchido quando o lançamento é o espelho de um pagamento do ciclo de
  // receita (revenue_entries.id). Linha read-only na tela e na API.
  revenue_entry_id: string | null
```

(Deixar `FinanceIntent` como está — mudanças do agente são o Plano 2.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS (ou só erros nos componentes da Task 10-12, que ainda serão editados).

- [ ] **Step 3: Commit**

```bash
git add lib/finance/types.ts
git commit -m "feat(finance): direction e revenue_entry_id no tipo FinanceEntry"
```

---

## Task 10: Formulário — toggle Receita/Despesa + picker por direção

**Files:**
- Modify: `components/finance/FinanceCategoryPicker.tsx`
- Modify: `components/finance/FinanceEntryForm.tsx`

**Interfaces:**
- Consumes: `CategoryNode.direction` (Task 2); `POST /api/finance/entries` com `direction` (Task 5).
- Produces: `FinanceCategoryPicker` ganha prop `direction: 'in' | 'out'`; `FinanceEntryForm` envia `direction` no payload.

- [ ] **Step 1: `FinanceCategoryPicker.tsx`**

Adicionar `direction: 'in' | 'out'` às props. Trocar:

```ts
  const current = tree[kind].find((c) => c.id === categoryId) ?? null
  const roots = tree[kind].filter((c) => (c.direction === direction) && (!c.isArchived || c.id === categoryId))
```

`subs` já deriva de `current.children` (herdam direção) — sem mudança.

- [ ] **Step 2: `FinanceEntryForm.tsx`**

Adicionar estado `const [direction, setDirection] = useState<'in' | 'out'>('out')`. No `useEffect` de seed: `setDirection(entry?.direction ?? 'out')`.

Adicionar, acima do campo Data, um toggle (2 botões ou `Tabs`) Despesa/Receita que chama `setDirection` e, ao mudar, zera categoria:

```tsx
<div className="flex gap-2">
  <Button type="button" variant={direction === 'out' ? 'default' : 'ghost'}
    onClick={() => { setDirection('out'); setCategoryId(null); setSubcategoryId(null) }}>Despesa</Button>
  <Button type="button" variant={direction === 'in' ? 'default' : 'ghost'}
    onClick={() => { setDirection('in'); setCategoryId(null); setSubcategoryId(null) }}>Receita</Button>
</div>
```

Passar `direction={direction}` ao `<FinanceCategoryPicker>`. Incluir `direction` no `payload`. Quando `entry?.revenue_entry_id` estiver setado, o form não deve abrir para edição (garantido na Task 11 — a tabela esconde a ação), mas por segurança: se `entry?.revenue_entry_id`, desabilitar Salvar.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compila sem erro de tipo nos componentes de finance.

- [ ] **Step 4: Commit**

```bash
git add components/finance/FinanceCategoryPicker.tsx components/finance/FinanceEntryForm.tsx
git commit -m "feat(finance): formulário de lançamento com toggle Receita/Despesa"
```

---

## Task 11: Tela — cards, split receita/despesa, gráfico, tabela

**Files:**
- Modify: `components/finance/FinanceClient.tsx`
- Modify: `components/finance/FinanceSummaryCards.tsx`
- Modify: `components/finance/FinanceEntryTable.tsx`
- Modify: `components/finance/FinanceCategoryChart.tsx` (só se necessário para tipos)

**Interfaces:**
- Consumes: `FinanceEntry.direction`, `FinanceEntry.revenue_entry_id` (Task 9); `CategoryNode.direction` (Task 2).
- Produces: `FinanceSummaryCards` props `{ receitas: number; despesas: number; topCategory: {name,value}|null }`.

- [ ] **Step 1: `FinanceClient.tsx`**

- `filtered` continua o recorte por `kind` + `month`. Derivar:

```ts
const receitas = filtered.filter((e) => e.direction === 'in')
const despesas = filtered.filter((e) => e.direction === 'out')
const totalReceitas = receitas.reduce((s, e) => s + e.amount, 0)
const totalDespesas = despesas.reduce((s, e) => s + e.amount, 0)
```

- Novo estado `const [chartSide, setChartSide] = useState<'out' | 'in'>('out')`.
- `roots` para o gráfico: `categoryTree[kind].filter((c) => c.direction === chartSide)`.
- `byCategory` calcula sobre `chartSide === 'in' ? receitas : despesas` e os `roots` do lado.
- `uncategorized` conta o lado do `chartSide`.
- Passar `receitas={totalReceitas} despesas={totalDespesas} topCategory={topCategory}` a `FinanceSummaryCards`.
- Acima do `FinanceCategoryChart`, um segmento "Despesas | Receitas" que seta `chartSide`.
- `FinanceEntryTable`: passar `entries={filtered}` (mostra os dois lados) — a tabela já rotula por direção.

- [ ] **Step 2: `FinanceSummaryCards.tsx`**

Trocar props para `{ receitas, despesas, topCategory }`. Renderizar 3 cards:
- "Receitas do mês" — `formatBRL(receitas)`, texto/realce verde (`text-green-600`).
- "Despesas do mês" — `formatBRL(despesas)`; abaixo, `topCategory ? 'Maior: ' + topCategory.name : null` em `text-xs text-gray-400`.
- "Saldo" — `formatBRL(receitas - despesas)`, verde se `>= 0`, senão `text-red-600`.

Layout: `grid grid-cols-1 gap-4 sm:grid-cols-3`.

- [ ] **Step 3: `FinanceEntryTable.tsx`**

- `names()` passa a filtrar os roots por `e.direction`: `const roots = (e.type === 'pf' ? tree.pf : tree.pj).filter((c) => c.direction === e.direction)`.
- Nova primeira célula ou badge junto da Descrição: `e.direction === 'in' ? <span className="...green">Receita</span> : <span className="...">Despesa</span>`.
- Valor: se `e.direction === 'in'`, renderizar `+ {formatBRL(e.amount)}` com `text-green-600`.
- Coluna de ações: quando `e.revenue_entry_id`, não renderizar o `DropdownMenu`; no lugar, `<span className="text-xs text-gray-400">Ciclo de receita</span>`.

- [ ] **Step 4: `FinanceCategoryChart.tsx`**

Provavelmente sem mudança (recebe `{ category, total }[]`). Se o título fixo "Por categoria" confundir, aceitar prop opcional `title`. Ajuste mínimo só se o build reclamar.

- [ ] **Step 5: Build + preview**

Run: `npm run build`
Expected: PASS.

Preview (verificação visual — usar as ferramentas do painel Browser):
1. `preview_start` com o dev server do projeto.
2. Abrir `/finance`, aba **Clínica (PJ)** e **Pessoal (PF)**: os 3 cards aparecem (Receitas/Despesas/Saldo).
3. Novo lançamento → toggle **Receita** → o picker lista as categorias de receita do tipo.
4. Segmento **Despesas | Receitas** troca o gráfico.
5. `read_console_messages` / `preview_logs` sem erro.
6. Screenshot da aba PJ com os 3 cards.

- [ ] **Step 6: Commit**

```bash
git add components/finance/FinanceClient.tsx components/finance/FinanceSummaryCards.tsx components/finance/FinanceEntryTable.tsx components/finance/FinanceCategoryChart.tsx
git commit -m "feat(finance): tela mostra Receitas/Despesas/Saldo e marca lançamentos do ciclo"
```

---

## Task 12: Gerenciador de categorias — receita

**Files:**
- Modify: `components/finance/FinanceCategoryManager.tsx`
- Modify: `components/finance/FinanceClient.tsx` (passar `direction`)

**Interfaces:**
- Consumes: `GET/POST /api/finance/categories` com `direction` (Task 6).
- Produces: `FinanceCategoryManager` ganha prop `direction: 'in' | 'out'`.

- [ ] **Step 1: `FinanceCategoryManager.tsx`**

- Adicionar `direction: 'in' | 'out'` às props.
- `load()`: `fetch(\`/api/finance/categories?kind=${kind}&direction=${direction}\`)`.
- `create()`: incluir `direction` no body do POST (`jsonInit('POST', { kind, direction, name, parent_id: parentId ?? null })`).
- `useEffect` deps: incluir `direction` (via `load` que já é `useCallback` — adicionar `direction` às deps do `useCallback`).

- [ ] **Step 2: `FinanceClient.tsx`**

Na aba Categorias, um segmento local "Despesas | Receitas" (ou reusar `chartSide`) e passar `<FinanceCategoryManager kind={kind} direction={catSide} onChanged={refresh} />`.

- [ ] **Step 3: Build + preview**

Run: `npm run build`
Preview: em `/finance` → aba **Categorias** → alternar Despesas/Receitas; criar uma categoria de receita "Telemedicina" em PJ; confirmar que aparece e que o picker do formulário de receita a lista.

- [ ] **Step 4: Commit**

```bash
git add components/finance/FinanceCategoryManager.tsx components/finance/FinanceClient.tsx
git commit -m "feat(finance): gerenciador de categorias cobre receita"
```

---

## Task 13: Fechamento — suíte, lint, build, revisão de segurança

**Files:** nenhum novo (correções pontuais se algo falhar).

- [ ] **Step 1: Suíte completa**

Run: `npm run test`
Expected: PASS (toda a suíte, não só finance/revenue).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: sem erros novos.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Revisão de segurança**

Rodar a skill `security-review` sobre o diff da branch. Pontos de atenção: a trava `revenue_mirror_locked` cobre PATCH **e** DELETE; o helper de espelho nunca vaza entre contas (usa `account_id` da própria `revenue_entry`); `GET /api/finance/categories?direction=` não expõe categoria de outra conta (o filtro é sobre a árvore já escopada por `account_id`).

- [ ] **Step 5: Commit final (se houve ajustes)**

```bash
git add -A
git commit -m "chore(finance): ajustes finais da revisão do bloco de receita"
```

- [ ] **Step 6: Instruções de deploy para o owner**

Registrar no PR (o usuário abre o PR): rodar `supabase/migration_receita_financeiro.sql` no SQL Editor **antes** do deploy do código (a coluna `direction` com default `'out'` mantém o código antigo funcionando; o código novo tolera a função de seed ausente). Sem backfill de `revenue_entries` já pagas — intencional.

---

## Self-Review (preenchido pelo autor do plano)

**Cobertura do spec:**
- Modelo de dados (direction, revenue_entry_id, índices, triggers de categoria, seed) → Task 1.
- `lib/finance/categories.ts` (direction no nó) → Task 2.
- `entry-validation` / `category-validation` → Task 3.
- `provision.ts` + seed → Task 4.
- Rotas `/api/finance/entries` (direction + trava) → Task 5.
- Rotas `/api/finance/categories` (direction) → Task 6.
- Helper `lib/revenue/finance-mirror.ts` → Task 7.
- 3 sites de `paid` → Task 8.
- `FinanceEntry` type → Task 9.
- Form + picker → Task 10.
- Cards / split / gráfico / tabela → Task 11.
- Category manager → Task 12.
- Testes + segurança → Task 13.
- **Fora deste plano (Plano 2, explícito no spec):** agente WhatsApp — `parser.ts` (`/pf+`/`/pj+`), `interpret.ts` (direction no schema), `categorize.ts` (categoriza por direção), `respond.ts` (cópia de receita), `agent.ts` cadastro manual de receita e `handleUndo` pulando o espelho, prompts. **A anti-regressão de `getEntries` (`.eq('direction','out')`) está no Plano 1, Task 8 Step 5b** — o resto do agente fica para o Plano 2.

**Placeholders:** nenhum "TBD"/"TODO"; todos os steps de código têm bloco real.

**Consistência de tipos:** `MirrorInput` (Task 7) usado igual nas 3 chamadas da Task 8. `direction: 'in' | 'out'` idêntico em `CategoryNode`, `EntryInput`, `FinanceEntry`, body das rotas. `REVENUE_MIRROR_CATEGORY` definido na Task 7, reusado no teste. `revenue_mirror_locked` / `category_direction_mismatch` / `parent_direction_mismatch` consistentes entre rota e teste.
