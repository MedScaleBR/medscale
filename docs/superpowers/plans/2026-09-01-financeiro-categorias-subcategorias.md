# /finance — Categorias e subcategorias (Bloco A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à tela `/finance` uma árvore de categorias/subcategorias (2 níveis, por conta, PF/PJ separados) com CRUD, seed automático, CRUD de lançamentos na própria tela e um agente de WhatsApp que categoriza contra essa árvore.

**Architecture:** Uma tabela auto-referente `finance_categories` (`parent_id` null = raiz, preenchido = subcategoria; profundidade 2 garantida por trigger). `finance_entries` ganha `category_id`/`subcategory_id` (o `category` texto vira snapshot). Provisionamento *lazy* por conta via função Postgres `provision_finance_categories` (advisory lock + seed curado + derivação do histórico + backfill), chamada tanto no server component da tela quanto no agente. Rotas REST finas em `app/api/finance/`; toda a lógica de validação/árvore fica em `lib/finance/*` (puro, testável), seguindo o padrão de `lib/revenue/*`. Componentes React não são testados por unidade neste repo (ambiente `node`, sem RTL) — as tarefas de UI têm gate de `tsc`/`lint` + verificação manual no preview.

**Tech Stack:** Next.js (App Router, ver `AGENTS.md`), TypeScript, Supabase (Postgres + RLS), Vitest (`environment: 'node'`, `globals: true`), Recharts, shadcn/ui (`components/ui/*`), Anthropic SDK.

**Spec:** `docs/superpowers/specs/2026-09-01-financeiro-categorias-subcategorias-design.md`

## Global Constraints

- **Escopo owner-only.** Todas as rotas e a tela checam `session.role === 'owner'` (`requireRole(session, ['owner'])`) + módulo `finance` (`requireModule(session, 'finance')`). Mesmo padrão de `app/api/revenue-settings/route.ts`.
- **`schema.sql` é "drop and recreate".** Toda mudança de schema vai em `supabase/migration_finance_categories.sql` (aditivo, com o cabeçalho de aviso copiado de `supabase/migration_finance.sql`) **e** é espelhada em `supabase/schema.sql`. A migração **não roda automaticamente** — o owner roda no SQL Editor e abre o PR (convenção do projeto: commit apenas, PR é do usuário).
- **`finance_entries.category` (texto) permanece** nesta fase — vira snapshot/raw e fallback visual ("Sem categoria"). Não remover.
- **Migração de dados por conta é *lazy* e idempotente** — nunca um `UPDATE` global no arquivo SQL.
- **2 níveis exatos** de categoria. Nenhum caminho (schema, API, UI, agente) pode criar um 3º nível.
- **Árvores PF e PJ separadas** por `kind text check (kind in ('pf','pj'))`. `kind` da categoria sempre igual ao `type` do lançamento.
- **Testes:** `npm run test` (= `vitest run`). Rodar um arquivo: `npx vitest run tests/finance/<arquivo>.test.ts`. Novos testes vão em `tests/finance/`, no estilo dos existentes (`tests/finance/resolve-unit.test.ts`): funções puras, Supabase mockado via `tests/helpers/supabase-mock.ts`, agente via `tests/helpers/agent-harness.ts`.
- **Sem lib de toast** no repo — componentes carregam estado de erro inline (ver `components/receita/RevenueClient.tsx`). Mutações do cliente chamam `router.refresh()` (`next/navigation`) + `useTransition`.
- **Commits frequentes**, um por tarefa concluída. Mensagens em pt-BR, no estilo do repo (`feat(finance): ...`, `fix(finance): ...`). Terminar a mensagem com:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

---

## Mapa de arquivos

**SQL / tipos**
- `supabase/migration_finance_categories.sql` — **criar.** Tabela, índices, 2 triggers, RLS, grants, `alter table finance_entries`, funções `normalize_category_name` e `provision_finance_categories`.
- `supabase/schema.sql` — **modificar.** Espelhar tudo (lista de `drop table`, `drop function`, `create table`, índices, triggers, RLS, policies).
- `types/database.ts` — **modificar.** Adicionar `finance_categories` (Row/Insert/Update/Relationships); estender `finance_entries` Row com `category_id`/`subcategory_id`; registrar as funções novas em `Functions`.

**Libs de servidor (puras / testáveis)**
- `lib/finance/default-categories.ts` — **criar.** `DEFAULT_FINANCE_CATEGORIES`, `normalizeCategoryName`, `buildProvisionPayload`.
- `lib/finance/categories.ts` — **criar.** Tipos `CategoryNode`/`FinanceCategoryTree`, `getFinanceCategoryTree`, `resolveCategoryPair`.
- `lib/finance/category-validation.ts` — **criar.** `validateCategoryShape`.
- `lib/finance/entry-validation.ts` — **criar.** `validateEntryInput`.
- `lib/finance/provision.ts` — **criar.** `ensureFinanceCategories`.
- `lib/finance/types.ts` — **modificar.** `FinanceEntry` (+`category_id`,`subcategory_id`); `FinanceIntent` (`entry` e `query` ganham `subcategory`).
- `lib/finance/categorize.ts` — **modificar.** `categorizeEntry(description, type, tree)`; remover constantes.
- `lib/finance/interpret.ts` — **modificar.** `interpretMessage(msg, today, tree)`; campo `subcategoria` no tool; remover `validCategory`.
- `lib/finance/respond.ts` — **modificar.** `QueryFilters` ganha `categoryId`/`subcategoryId`.
- `lib/finance/agent.ts` — **modificar.** Chama `ensureFinanceCategories` + `getFinanceCategoryTree`; resolve par categoria/subcategoria; grava ids; `getEntries` filtra por id.

**API**
- `app/api/finance/categories/route.ts` — **criar.** `GET`, `POST`.
- `app/api/finance/categories/[id]/route.ts` — **criar.** `PATCH`, `DELETE`.
- `app/api/finance/entries/route.ts` — **criar.** `POST`.
- `app/api/finance/entries/[id]/route.ts` — **criar.** `PATCH`, `DELETE`.

**Tela**
- `app/(dashboard)/finance/page.tsx` — **modificar.** `ensureFinanceCategories` + carregar árvore + passar ao client.
- `components/finance/FinanceClient.tsx` — **modificar.** Segmented control PF/PJ + abas Visão geral / Lançamentos / Categorias.
- `components/finance/FinanceCategoryPicker.tsx` — **criar.**
- `components/finance/FinanceEntryForm.tsx` — **criar.**
- `components/finance/FinanceEntryTable.tsx` — **modificar.** Ações + colunas Subcategoria/Unidade.
- `components/finance/FinanceCategoryManager.tsx` — **criar.**
- `components/finance/FinanceSummaryCards.tsx` — **modificar.** "Maior gasto" com subcategoria.
- `components/finance/FinanceCategoryChart.tsx` — **modificar.** Drill-down categoria → subcategoria.

**Testes novos**
- `tests/finance/default-categories.test.ts`
- `tests/finance/categories-tree.test.ts` (`getFinanceCategoryTree` + `resolveCategoryPair`)
- `tests/finance/category-validation.test.ts`
- `tests/finance/entry-validation.test.ts`
- `tests/finance/categorize-prompt.test.ts`
- `tests/finance/agent-category.test.ts`

---

## Interfaces (contrato entre tarefas — copiar verbatim)

```ts
// lib/finance/default-categories.ts
export interface DefaultCategoryTree { pf: DefaultCategoryNode[]; pj: DefaultCategoryNode[] }
export interface DefaultCategoryNode { name: string; children: string[] }
export const DEFAULT_FINANCE_CATEGORIES: DefaultCategoryTree
/** trim + minúsculas + sem acento (NFD) + espaços colapsados */
export function normalizeCategoryName(name: string): string
/** DEFAULT_FINANCE_CATEGORIES com children sempre presente — payload do RPC */
export function buildProvisionPayload(): DefaultCategoryTree

// lib/finance/categories.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { FinanceEntryType } from './types'
export interface CategoryNode {
  id: string; name: string; sortOrder: number; isArchived: boolean; children: CategoryNode[]
}
export interface FinanceCategoryTree { pf: CategoryNode[]; pj: CategoryNode[] }
export async function getFinanceCategoryTree(
  client: SupabaseClient<Database>, accountId: string, opts?: { includeArchived?: boolean }
): Promise<FinanceCategoryTree>
export interface ResolvedCategoryPair {
  categoryId: string | null; categoryName: string | null
  subcategoryId: string | null; subcategoryName: string | null
}
export function resolveCategoryPair(
  tree: FinanceCategoryTree, type: FinanceEntryType | null,
  categoryName: string | null, subcategoryName: string | null
): ResolvedCategoryPair

// lib/finance/category-validation.ts
import type { FinanceCategoryTree } from './categories'
export type CategoryValidationError =
  | { code: 'empty_name' } | { code: 'kind_invalid' } | { code: 'parent_not_found' }
  | { code: 'parent_not_root' } | { code: 'parent_kind_mismatch' }
  | { code: 'duplicate_sibling' } | { code: 'would_orphan_children' } | { code: 'node_not_found' }
export function validateCategoryShape(
  tree: FinanceCategoryTree,
  input: { kind: string; name: string; parentId: string | null; nodeId?: string }
): CategoryValidationError | null

// lib/finance/entry-validation.ts
import type { FinanceCategoryTree } from './categories'
import type { FinanceEntryType } from './types'
export type EntryValidationError =
  | { code: 'amount_invalid' } | { code: 'date_invalid' } | { code: 'category_not_found' }
  | { code: 'subcategory_not_found' } | { code: 'category_kind_mismatch' } | { code: 'subcategory_not_child' }
export interface EntryInput {
  type: FinanceEntryType; entryDate: string; amount: number
  categoryId: string | null; subcategoryId: string | null
}
export function validateEntryInput(tree: FinanceCategoryTree, input: EntryInput): EntryValidationError | null

// lib/finance/provision.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
export async function ensureFinanceCategories(
  client: SupabaseClient<Database>, accountId: string
): Promise<void>
```

SQL (assinaturas):

```sql
public.normalize_category_name(p_name text) returns text   -- immutable
public.provision_finance_categories(p_account_id uuid, p_tree jsonb) returns void
```

---

## Task 1: Schema — tabela `finance_categories` + colunas em `finance_entries`

**Files:**
- Create: `supabase/migration_finance_categories.sql`
- Modify: `supabase/schema.sql` (lista `drop table` ~L20-52; lista `drop function` ~L55-66; após `create table public.finance_sessions` ~L262; índices ~L686-688; `alter table ... enable row level security` ~L933; policies ~L1085; após bloco `trg_enforce_ws_account` ~L776)
- Modify: `types/database.ts` (`finance_entries` Row ~L855-878; bloco `Tables` ~L914; `Functions` ~L917-931)

**Interfaces:**
- Consumes: nada.
- Produces: tabela `public.finance_categories (id, account_id, kind, parent_id, name, sort_order, is_archived, created_at)`; `finance_entries.category_id`, `finance_entries.subcategory_id` (uuid null, FK `on delete set null`); triggers `trg_enforce_finance_category_depth`, `trg_enforce_finance_entry_category`; tipo TS `Database['public']['Tables']['finance_categories']`.

- [ ] **Step 1: Escrever `supabase/migration_finance_categories.sql`**

Cabeçalho copiado de `supabase/migration_finance.sql` (aviso "NÃO rode schema.sql"). Conteúdo:

```sql
-- Migração incremental: Categorias e subcategorias do financeiro (Bloco A)
-- Rode isto no SQL Editor do Supabase — NÃO rode supabase/schema.sql inteiro,
-- pois aquele arquivo é "drop and recreate" e apagaria todos os dados.
-- Este arquivo só ADICIONA. O conteúdo também já foi incorporado em
-- supabase/schema.sql, que segue sendo a fonte de verdade para reconstruções.

create table public.finance_categories (
  id           uuid default uuid_generate_v4() primary key,
  account_id   uuid references public.accounts(id) on delete cascade not null,
  kind         text not null check (kind in ('pf','pj')),
  -- null = categoria-raiz; preenchido = subcategoria. Profundidade máxima 2
  -- (garantida por trg_enforce_finance_category_depth).
  parent_id    uuid references public.finance_categories(id) on delete cascade,
  name         text not null,
  sort_order   int not null default 0,
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now()
);

create index idx_finance_categories_tree
  on public.finance_categories(account_id, kind, parent_id, sort_order);

-- Impede duas irmãs de mesmo nome (case/acento-insensitive); permite mesmo
-- nome em ramos diferentes. Coalesce porque NULL em unique é sempre distinto.
create unique index idx_finance_categories_unique_sibling
  on public.finance_categories(
    account_id, kind,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    public.normalize_category_name(name)
  );

alter table public.finance_categories enable row level security;

create policy "finance_categories: owner only" on public.finance_categories
  for all using (public.is_account_owner(account_id));

grant all on public.finance_categories to authenticated, service_role;

-- Normalização compartilhada com lib/finance/default-categories.ts
-- (normalizeCategoryName). Determinística/immutable para poder entrar no
-- índice único acima. translate() em vez de unaccent para não depender de
-- extensão.
create or replace function public.normalize_category_name(p_name text)
returns text language sql immutable as $$
  select regexp_replace(
    lower(translate(btrim(coalesce(p_name, '')),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')),
    '\s+', ' ', 'g')
$$;

-- Profundidade 2 + coerência account/kind do parent.
create or replace function public.enforce_finance_category_depth()
returns trigger language plpgsql as $$
declare v_parent record;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'finance_categories: categoria não pode ser pai de si mesma';
    end if;
    select account_id, kind, parent_id into v_parent
      from public.finance_categories where id = new.parent_id;
    if not found then
      raise exception 'finance_categories: parent_id % inexistente', new.parent_id;
    end if;
    if v_parent.parent_id is not null then
      raise exception 'finance_categories: profundidade máxima é 2 níveis';
    end if;
    if v_parent.account_id <> new.account_id or v_parent.kind <> new.kind then
      raise exception 'finance_categories: parent_id de outra conta ou kind';
    end if;
    if exists (select 1 from public.finance_categories where parent_id = new.id) then
      raise exception 'finance_categories: categoria com subcategorias não pode virar subcategoria';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_enforce_finance_category_depth
  before insert or update on public.finance_categories
  for each row execute procedure public.enforce_finance_category_depth();

alter table public.finance_entries
  add column category_id    uuid references public.finance_categories(id) on delete set null,
  add column subcategory_id uuid references public.finance_categories(id) on delete set null;

create index idx_finance_entries_category
  on public.finance_entries(account_id, category_id, entry_date desc);

-- subcategory_id tem que ser filha de category_id; kind da categoria = type.
create or replace function public.enforce_finance_entry_category()
returns trigger language plpgsql as $$
declare v_cat record; v_sub_parent uuid;
begin
  if new.category_id is not null then
    select kind, parent_id into v_cat
      from public.finance_categories where id = new.category_id;
    if not found then raise exception 'finance_entries: category_id inexistente'; end if;
    if v_cat.kind <> new.type then
      raise exception 'finance_entries: kind da categoria difere do type do lançamento';
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

create trigger trg_enforce_finance_entry_category
  before insert or update on public.finance_entries
  for each row execute procedure public.enforce_finance_entry_category();
```

(A função `provision_finance_categories` é adicionada na Task 3, no fim deste mesmo arquivo.)

- [ ] **Step 2: Espelhar em `supabase/schema.sql`**

- Lista `drop table if exists` (~L20): adicionar `public.finance_categories,` **antes** de `public.finance_sessions` (ordem: filhas antes de pais; `finance_categories` referencia `accounts` e a si mesma — pode vir logo após `finance_sessions,` sem problema, mas antes de `accounts`).
- Lista `drop function if exists` (~L55): adicionar
  `drop function if exists public.normalize_category_name(text) cascade;`
  `drop function if exists public.enforce_finance_category_depth() cascade;`
  `drop function if exists public.enforce_finance_entry_category() cascade;`
  `drop function if exists public.provision_finance_categories(uuid, jsonb) cascade;`
- Após `create table public.finance_sessions (...)` (~L262): colar o `create table public.finance_categories` e a função `normalize_category_name` (a função precisa existir antes do índice único).
- Bloco de índices (~L686): adicionar `idx_finance_categories_tree`, `idx_finance_categories_unique_sibling`, `idx_finance_entries_category`.
- No `create table public.finance_entries` (~L239): adicionar as duas colunas `category_id`/`subcategory_id` inline (com comentário).
- `enable row level security` (~L933): adicionar `alter table public.finance_categories enable row level security;`
- Policies (~L1085): adicionar a policy `"finance_categories: owner only"`.
- Após o bloco `trg_enforce_ws_account` (~L776): adicionar as funções `enforce_finance_category_depth` / `enforce_finance_entry_category` e seus `create trigger`.

- [ ] **Step 3: Atualizar `types/database.ts`**

No bloco `Tables`, após `finance_sessions` (~L914), adicionar:

```ts
      finance_categories: {
        Row: {
          id: string
          account_id: string
          kind: FinanceEntryType
          parent_id: string | null
          name: string
          sort_order: number
          is_archived: boolean
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['finance_categories']['Row']> & {
          account_id: string
          kind: FinanceEntryType
          name: string
        }
        Update: Partial<Database['public']['Tables']['finance_categories']['Row']>
        Relationships: [
          {
            foreignKeyName: 'finance_categories_account_id_fkey'
            columns: ['account_id']
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'finance_categories_parent_id_fkey'
            columns: ['parent_id']
            referencedRelation: 'finance_categories'
            referencedColumns: ['id']
          },
        ]
      }
```

No `finance_entries` Row (~L866, após `category`): adicionar
`category_id: string | null` e `subcategory_id: string | null`.

No bloco `Functions` (~L917): adicionar
```ts
      normalize_category_name: { Args: { p_name: string }; Returns: string }
      provision_finance_categories: { Args: { p_account_id: string; p_tree: Json }; Returns: undefined }
```
(Se `Json` não existir no arquivo, use `Record<string, unknown>`.)

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: PASS (sem erros novos). Nenhum consumidor ainda usa os campos — só o tipo compila.

- [ ] **Step 5: Commit**

```bash
git add supabase/migration_finance_categories.sql supabase/schema.sql types/database.ts
git commit -m "feat(finance): schema de finance_categories + colunas em finance_entries

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `lib/finance/default-categories.ts` — árvore curada + normalização

**Files:**
- Create: `lib/finance/default-categories.ts`
- Test: `tests/finance/default-categories.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `DEFAULT_FINANCE_CATEGORIES`, `normalizeCategoryName(name)`, `buildProvisionPayload()` (ver bloco Interfaces).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/finance/default-categories.test.ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FINANCE_CATEGORIES,
  normalizeCategoryName,
  buildProvisionPayload,
} from '@/lib/finance/default-categories'

describe('normalizeCategoryName', () => {
  it('remove acento, caixa e espaços de sobra', () => {
    expect(normalizeCategoryName('  Alimentação ')).toBe('alimentacao')
    expect(normalizeCategoryName('Impostos  e   Taxas')).toBe('impostos e taxas')
    expect(normalizeCategoryName('SAÚDE')).toBe('saude')
  })
  it('trata null/undefined como string vazia', () => {
    expect(normalizeCategoryName(undefined as unknown as string)).toBe('')
  })
})

describe('DEFAULT_FINANCE_CATEGORIES', () => {
  it('tem raízes em pf e pj, todas com children array', () => {
    expect(DEFAULT_FINANCE_CATEGORIES.pf.length).toBeGreaterThan(5)
    expect(DEFAULT_FINANCE_CATEGORIES.pj.length).toBeGreaterThan(5)
    for (const kind of ['pf', 'pj'] as const) {
      for (const cat of DEFAULT_FINANCE_CATEGORIES[kind]) {
        expect(typeof cat.name).toBe('string')
        expect(Array.isArray(cat.children)).toBe(true)
      }
    }
  })
  it('não tem irmãs com nome normalizado duplicado', () => {
    for (const kind of ['pf', 'pj'] as const) {
      const roots = DEFAULT_FINANCE_CATEGORIES[kind].map((c) => normalizeCategoryName(c.name))
      expect(new Set(roots).size).toBe(roots.length)
      for (const cat of DEFAULT_FINANCE_CATEGORIES[kind]) {
        const subs = cat.children.map(normalizeCategoryName)
        expect(new Set(subs).size).toBe(subs.length)
      }
    }
  })
  it('inclui as raízes das constantes antigas para o backfill casar', () => {
    const pf = DEFAULT_FINANCE_CATEGORIES.pf.map((c) => c.name)
    expect(pf).toEqual(expect.arrayContaining(['Alimentação', 'Moradia', 'Saúde', 'Transporte', 'Lazer', 'Investimentos', 'Outros']))
    const pj = DEFAULT_FINANCE_CATEGORIES.pj.map((c) => c.name)
    expect(pj).toEqual(expect.arrayContaining(['Aluguel', 'Marketing', 'Impostos', 'Outros']))
  })
})

describe('buildProvisionPayload', () => {
  it('devolve a árvore com children sempre presente', () => {
    const p = buildProvisionPayload()
    for (const kind of ['pf', 'pj'] as const) {
      for (const cat of p[kind]) expect(Array.isArray(cat.children)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/finance/default-categories.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `lib/finance/default-categories.ts`**

```ts
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/finance/default-categories.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/finance/default-categories.ts tests/finance/default-categories.test.ts
git commit -m "feat(finance): árvore curada padrão + normalizeCategoryName

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Função `provision_finance_categories` + `lib/finance/provision.ts`

**Files:**
- Modify: `supabase/migration_finance_categories.sql` (append), `supabase/schema.sql` (append junto às outras funções, ~após L890 do bloco de funções auxiliares)
- Create: `lib/finance/provision.ts`
- Test: `tests/finance/provision.test.ts`

**Interfaces:**
- Consumes: `buildProvisionPayload` (Task 2); RPC `provision_finance_categories` (esta task).
- Produces: `ensureFinanceCategories(client, accountId)` — chama `client.rpc('provision_finance_categories', { p_account_id, p_tree })`. Idempotente. Usada pela tela (Task 11) e pelo agente (Task 16).

- [ ] **Step 1: Adicionar `provision_finance_categories` ao fim de `migration_finance_categories.sql`** (e espelhar em `schema.sql`)

```sql
-- Provisionamento lazy e idempotente das categorias de uma conta. Chamada no
-- primeiro carregamento de /finance e no agente do WhatsApp. Roda numa única
-- transação (função); advisory lock evita corrida entre dois carregamentos.
-- p_tree: { "pf": [{ "name": "...", "children": ["..."] }, ...], "pj": [...] }
create or replace function public.provision_finance_categories(p_account_id uuid, p_tree jsonb)
returns void language plpgsql as $$
declare
  v_kind        text;
  v_cat         jsonb;
  v_sub         text;
  v_root_id     uuid;
  v_order       int;
  v_suborder    int;
  v_existing    text;
  v_existing_kd text;
begin
  perform pg_advisory_xact_lock(hashtext(p_account_id::text));

  if exists (select 1 from public.finance_categories where account_id = p_account_id) then
    return; -- já provisionada
  end if;

  -- 1. árvore curada
  foreach v_kind in array array['pf','pj'] loop
    v_order := 0;
    for v_cat in select jsonb_array_elements(p_tree -> v_kind) loop
      insert into public.finance_categories (account_id, kind, parent_id, name, sort_order)
      values (p_account_id, v_kind, null, v_cat ->> 'name', v_order)
      returning id into v_root_id;
      v_order := v_order + 1;
      v_suborder := 0;
      for v_sub in select jsonb_array_elements_text(coalesce(v_cat -> 'children', '[]'::jsonb)) loop
        insert into public.finance_categories (account_id, kind, parent_id, name, sort_order)
        values (p_account_id, v_kind, v_root_id, v_sub, v_suborder);
        v_suborder := v_suborder + 1;
      end loop;
    end loop;
  end loop;

  -- 2. derivar do histórico: category texto que não casa com nenhuma raiz
  for v_existing, v_existing_kd in
    select distinct btrim(fe.category), fe.type
    from public.finance_entries fe
    where fe.account_id = p_account_id
      and fe.category is not null and btrim(fe.category) <> ''
  loop
    if not exists (
      select 1 from public.finance_categories c
      where c.account_id = p_account_id and c.kind = v_existing_kd and c.parent_id is null
        and public.normalize_category_name(c.name) = public.normalize_category_name(v_existing)
    ) then
      insert into public.finance_categories (account_id, kind, parent_id, name, sort_order)
      values (
        p_account_id, v_existing_kd, null, v_existing,
        coalesce((select max(sort_order) + 1 from public.finance_categories
                  where account_id = p_account_id and kind = v_existing_kd and parent_id is null), 0)
      );
    end if;
  end loop;

  -- 3. backfill: category texto → category_id da raiz de mesmo kind
  update public.finance_entries fe
  set category_id = c.id
  from public.finance_categories c
  where fe.account_id = p_account_id
    and fe.category_id is null
    and fe.category is not null
    and c.account_id = p_account_id
    and c.parent_id is null
    and c.kind = fe.type
    and public.normalize_category_name(c.name) = public.normalize_category_name(fe.category);
end;
$$;

grant execute on function public.provision_finance_categories(uuid, jsonb) to authenticated, service_role;
grant execute on function public.normalize_category_name(text) to authenticated, service_role;
```

Em `schema.sql`, colar essas duas `create function` + os `grant execute` no bloco "12. FUNÇÕES AUXILIARES" (após `is_account_owner`, ~L866). Confirmar que `normalize_category_name` já foi colada antes (Task 1 Step 2, junto do `create table`).

- [ ] **Step 2: Escrever o teste que falha (`ensureFinanceCategories`)**

```ts
// tests/finance/provision.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createSupabaseMock } from '../helpers/supabase-mock'
import { ensureFinanceCategories } from '@/lib/finance/provision'

describe('ensureFinanceCategories', () => {
  it('chama o RPC provision_finance_categories com a conta e a árvore', async () => {
    const mock = createSupabaseMock()
    await ensureFinanceCategories(mock.client as never, 'acc-1')
    expect(mock.rpc).toHaveBeenCalledWith(
      'provision_finance_categories',
      expect.objectContaining({
        p_account_id: 'acc-1',
        p_tree: expect.objectContaining({ pf: expect.any(Array), pj: expect.any(Array) }),
      })
    )
  })

  it('propaga erro do RPC', async () => {
    const mock = createSupabaseMock()
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    await expect(ensureFinanceCategories(mock.client as never, 'acc-1')).rejects.toThrow('boom')
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/finance/provision.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar `lib/finance/provision.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { buildProvisionPayload } from './default-categories'

// Provisiona (idempotente) a árvore de categorias da conta: seed curado +
// derivação das categorias que já aparecem em finance_entries + backfill do
// category_id dos lançamentos antigos. Barato quando já provisionada (a função
// Postgres só checa um count sob advisory lock). Chamada no server component
// de /finance e no agente do WhatsApp antes de ler a árvore.
export async function ensureFinanceCategories(
  client: SupabaseClient<Database>,
  accountId: string
): Promise<void> {
  const { error } = await client.rpc('provision_finance_categories', {
    p_account_id: accountId,
    p_tree: buildProvisionPayload() as unknown as Database['public']['Functions']['provision_finance_categories']['Args']['p_tree'],
  })
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/finance/provision.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migration_finance_categories.sql supabase/schema.sql lib/finance/provision.ts tests/finance/provision.test.ts
git commit -m "feat(finance): provision_finance_categories (seed + derivação + backfill)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `lib/finance/categories.ts` — `getFinanceCategoryTree` + `resolveCategoryPair`

**Files:**
- Create: `lib/finance/categories.ts`
- Test: `tests/finance/categories-tree.test.ts`

**Interfaces:**
- Consumes: `normalizeCategoryName` (Task 2); tabela `finance_categories` (Task 1).
- Produces: `CategoryNode`, `FinanceCategoryTree`, `getFinanceCategoryTree(client, accountId, opts?)`, `ResolvedCategoryPair`, `resolveCategoryPair(tree, type, catName, subName)` (ver bloco Interfaces).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/finance/categories-tree.test.ts
import { describe, it, expect } from 'vitest'
import { createSupabaseMock } from '../helpers/supabase-mock'
import { getFinanceCategoryTree, resolveCategoryPair, type FinanceCategoryTree } from '@/lib/finance/categories'

const ROWS = [
  { id: 'pf-fil', account_id: 'a1', kind: 'pf', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: false, created_at: '' },
  { id: 'pf-esc', account_id: 'a1', kind: 'pf', parent_id: 'pf-fil', name: 'Escola', sort_order: 0, is_archived: false, created_at: '' },
  { id: 'pf-ali', account_id: 'a1', kind: 'pf', parent_id: null, name: 'Alimentação', sort_order: 1, is_archived: false, created_at: '' },
  { id: 'pf-old', account_id: 'a1', kind: 'pf', parent_id: null, name: 'Antiga', sort_order: 2, is_archived: true, created_at: '' },
  { id: 'pj-alu', account_id: 'a1', kind: 'pj', parent_id: null, name: 'Aluguel', sort_order: 0, is_archived: false, created_at: '' },
]

describe('getFinanceCategoryTree', () => {
  it('monta as árvores pf/pj aninhadas, sem arquivadas por padrão', async () => {
    const mock = createSupabaseMock({ finance_categories: { select: { data: ROWS } } })
    const tree = await getFinanceCategoryTree(mock.client as never, 'a1')
    expect(tree.pf.map((c) => c.name)).toEqual(['Filhos', 'Alimentação'])
    expect(tree.pf[0].children.map((c) => c.name)).toEqual(['Escola'])
    expect(tree.pj.map((c) => c.name)).toEqual(['Aluguel'])
  })
  it('inclui arquivadas quando opts.includeArchived', async () => {
    const mock = createSupabaseMock({ finance_categories: { select: { data: ROWS } } })
    const tree = await getFinanceCategoryTree(mock.client as never, 'a1', { includeArchived: true })
    expect(tree.pf.map((c) => c.name)).toContain('Antiga')
  })
})

const TREE: FinanceCategoryTree = {
  pf: [{ id: 'pf-fil', name: 'Filhos', sortOrder: 0, isArchived: false, children: [
        { id: 'pf-esc', name: 'Escola', sortOrder: 0, isArchived: false, children: [] }] }],
  pj: [{ id: 'pj-alu', name: 'Aluguel', sortOrder: 0, isArchived: false, children: [] }],
}

describe('resolveCategoryPair', () => {
  it('casa categoria e subcategoria por nome sem acento/caixa', () => {
    expect(resolveCategoryPair(TREE, 'pf', 'FILHOS', 'escola')).toEqual({
      categoryId: 'pf-fil', categoryName: 'Filhos', subcategoryId: 'pf-esc', subcategoryName: 'Escola',
    })
  })
  it('ignora subcategoria que não pertence à categoria resolvida', () => {
    expect(resolveCategoryPair(TREE, 'pf', 'Filhos', 'Aluguel')).toEqual({
      categoryId: 'pf-fil', categoryName: 'Filhos', subcategoryId: null, subcategoryName: null,
    })
  })
  it('nada casa → tudo null', () => {
    expect(resolveCategoryPair(TREE, 'pf', 'Inexistente', null)).toEqual({
      categoryId: null, categoryName: null, subcategoryId: null, subcategoryName: null,
    })
  })
  it('respeita o kind (pj não acha categoria pf)', () => {
    expect(resolveCategoryPair(TREE, 'pj', 'Filhos', null).categoryId).toBeNull()
  })
  it('type null: procura em pf e depois pj', () => {
    expect(resolveCategoryPair(TREE, null, 'Aluguel', null).categoryId).toBe('pj-alu')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/finance/categories-tree.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `lib/finance/categories.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { FinanceEntryType } from './types'
import { normalizeCategoryName } from './default-categories'

export interface CategoryNode {
  id: string
  name: string
  sortOrder: number
  isArchived: boolean
  children: CategoryNode[]
}
export interface FinanceCategoryTree {
  pf: CategoryNode[]
  pj: CategoryNode[]
}

type Row = Database['public']['Tables']['finance_categories']['Row']

// Lê finance_categories da conta e devolve as duas árvores aninhadas (2
// níveis), ordenadas por sort_order. Arquivadas ficam de fora salvo
// opts.includeArchived (o gerenciador na tela usa true para o modo "mostrar
// arquivadas").
export async function getFinanceCategoryTree(
  client: SupabaseClient<Database>,
  accountId: string,
  opts: { includeArchived?: boolean } = {}
): Promise<FinanceCategoryTree> {
  let q = client
    .from('finance_categories')
    .select('id, account_id, kind, parent_id, name, sort_order, is_archived, created_at')
    .eq('account_id', accountId)
    .order('sort_order', { ascending: true })
  if (!opts.includeArchived) q = q.eq('is_archived', false)
  const { data } = await q
  return buildTree((data ?? []) as Row[])
}

function buildTree(rows: Row[]): FinanceCategoryTree {
  const node = (r: Row): CategoryNode => ({
    id: r.id, name: r.name, sortOrder: r.sort_order, isArchived: r.is_archived, children: [],
  })
  const make = (kind: FinanceEntryType): CategoryNode[] => {
    const ofKind = rows.filter((r) => r.kind === kind)
    const roots = ofKind.filter((r) => r.parent_id === null).map(node)
    const byId = new Map(roots.map((n) => [n.id, n]))
    for (const r of ofKind.filter((r) => r.parent_id !== null)) {
      const parent = byId.get(r.parent_id as string)
      if (parent) parent.children.push(node(r))
    }
    const bySort = (a: CategoryNode, b: CategoryNode) => a.sortOrder - b.sortOrder
    roots.sort(bySort)
    for (const root of roots) root.children.sort(bySort)
    return roots
  }
  return { pf: make('pf'), pj: make('pj') }
}

export interface ResolvedCategoryPair {
  categoryId: string | null
  categoryName: string | null
  subcategoryId: string | null
  subcategoryName: string | null
}

const EMPTY: ResolvedCategoryPair = {
  categoryId: null, categoryName: null, subcategoryId: null, subcategoryName: null,
}

// Casa nomes (possivelmente vindos do modelo) contra a árvore da conta.
// type null tenta pf e depois pj. Subcategoria só resolve se for filha da
// categoria resolvida.
export function resolveCategoryPair(
  tree: FinanceCategoryTree,
  type: FinanceEntryType | null,
  categoryName: string | null,
  subcategoryName: string | null
): ResolvedCategoryPair {
  if (!categoryName) return EMPTY
  const kinds: FinanceEntryType[] = type ? [type] : ['pf', 'pj']
  const target = normalizeCategoryName(categoryName)
  for (const kind of kinds) {
    const cat = tree[kind].find((c) => normalizeCategoryName(c.name) === target)
    if (!cat) continue
    let subId: string | null = null
    let subName: string | null = null
    if (subcategoryName) {
      const sub = cat.children.find(
        (s) => normalizeCategoryName(s.name) === normalizeCategoryName(subcategoryName)
      )
      if (sub) { subId = sub.id; subName = sub.name }
    }
    return { categoryId: cat.id, categoryName: cat.name, subcategoryId: subId, subcategoryName: subName }
  }
  return EMPTY
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/finance/categories-tree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/finance/categories.ts tests/finance/categories-tree.test.ts
git commit -m "feat(finance): getFinanceCategoryTree + resolveCategoryPair

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `lib/finance/category-validation.ts` — `validateCategoryShape`

**Files:**
- Create: `lib/finance/category-validation.ts`
- Test: `tests/finance/category-validation.test.ts`

**Interfaces:**
- Consumes: `FinanceCategoryTree`, `CategoryNode` (Task 4); `normalizeCategoryName` (Task 2).
- Produces: `CategoryValidationError`, `validateCategoryShape(tree, { kind, name, parentId, nodeId? })` — retorna o primeiro erro ou `null`. Usada por `POST`/`PATCH` de `finance/categories` (Tasks 8-9).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/finance/category-validation.test.ts
import { describe, it, expect } from 'vitest'
import { validateCategoryShape } from '@/lib/finance/category-validation'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

const TREE: FinanceCategoryTree = {
  pf: [
    { id: 'fil', name: 'Filhos', sortOrder: 0, isArchived: false, children: [
      { id: 'esc', name: 'Escola', sortOrder: 0, isArchived: false, children: [] },
    ] },
    { id: 'ali', name: 'Alimentação', sortOrder: 1, isArchived: false, children: [] },
  ],
  pj: [{ id: 'alu', name: 'Aluguel', sortOrder: 0, isArchived: false, children: [] }],
}

describe('validateCategoryShape', () => {
  it('aceita nova raiz com nome livre', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'Pets', parentId: null })).toBeNull()
  })
  it('rejeita nome vazio', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: '   ', parentId: null })).toEqual({ code: 'empty_name' })
  })
  it('rejeita kind inválido', () => {
    expect(validateCategoryShape(TREE, { kind: 'xx', name: 'A', parentId: null })).toEqual({ code: 'kind_invalid' })
  })
  it('rejeita irmã duplicada (case/acento)', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'alimentacao', parentId: null })).toEqual({ code: 'duplicate_sibling' })
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'ESCOLA', parentId: 'fil' })).toEqual({ code: 'duplicate_sibling' })
  })
  it('permite renomear o próprio nó para o mesmo nome (nodeId ignora a si)', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'Alimentação', parentId: null, nodeId: 'ali' })).toBeNull()
  })
  it('rejeita parent inexistente', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'X', parentId: 'nope' })).toEqual({ code: 'parent_not_found' })
  })
  it('rejeita parent que já é subcategoria (evita 3º nível)', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'X', parentId: 'esc' })).toEqual({ code: 'parent_not_root' })
  })
  it('rejeita parent de outro kind', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'X', parentId: 'alu' })).toEqual({ code: 'parent_kind_mismatch' })
  })
  it('rejeita mover um nó que tem filhos para virar subcategoria', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'Filhos', parentId: 'ali', nodeId: 'fil' })).toEqual({ code: 'would_orphan_children' })
  })
  it('rejeita PATCH de nó inexistente', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'X', parentId: null, nodeId: 'ghost' })).toEqual({ code: 'node_not_found' })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/finance/category-validation.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `lib/finance/category-validation.ts`**

```ts
import type { FinanceCategoryTree, CategoryNode } from './categories'
import { normalizeCategoryName } from './default-categories'
import type { FinanceEntryType } from './types'

export type CategoryValidationError =
  | { code: 'empty_name' }
  | { code: 'kind_invalid' }
  | { code: 'parent_not_found' }
  | { code: 'parent_not_root' }
  | { code: 'parent_kind_mismatch' }
  | { code: 'duplicate_sibling' }
  | { code: 'would_orphan_children' }
  | { code: 'node_not_found' }

interface Flat { node: CategoryNode; kind: FinanceEntryType; parentId: string | null }

function flatten(tree: FinanceCategoryTree): Flat[] {
  const out: Flat[] = []
  for (const kind of ['pf', 'pj'] as const) {
    for (const root of tree[kind]) {
      out.push({ node: root, kind, parentId: null })
      for (const child of root.children) out.push({ node: child, kind, parentId: root.id })
    }
  }
  return out
}

// Valida a forma de uma categoria/subcategoria antes de criar (sem nodeId) ou
// editar (com nodeId). Não toca o banco — a rota resolve a árvore antes.
export function validateCategoryShape(
  tree: FinanceCategoryTree,
  input: { kind: string; name: string; parentId: string | null; nodeId?: string }
): CategoryValidationError | null {
  if (input.kind !== 'pf' && input.kind !== 'pj') return { code: 'kind_invalid' }
  const name = input.name?.trim() ?? ''
  if (!name) return { code: 'empty_name' }

  const flat = flatten(tree)

  if (input.nodeId && !flat.some((f) => f.node.id === input.nodeId)) {
    return { code: 'node_not_found' }
  }

  if (input.parentId) {
    const parent = flat.find((f) => f.node.id === input.parentId)
    if (!parent) return { code: 'parent_not_found' }
    if (parent.parentId !== null) return { code: 'parent_not_root' }
    if (parent.kind !== input.kind) return { code: 'parent_kind_mismatch' }
  }

  if (input.nodeId && input.parentId) {
    const self = flat.find((f) => f.node.id === input.nodeId)
    if (self && self.node.children.length > 0) return { code: 'would_orphan_children' }
  }

  const target = normalizeCategoryName(name)
  const siblingClash = flat.some(
    (f) =>
      f.kind === input.kind &&
      f.parentId === (input.parentId ?? null) &&
      f.node.id !== input.nodeId &&
      normalizeCategoryName(f.node.name) === target
  )
  if (siblingClash) return { code: 'duplicate_sibling' }

  return null
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/finance/category-validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/finance/category-validation.ts tests/finance/category-validation.test.ts
git commit -m "feat(finance): validateCategoryShape (profundidade, kind, irmãs)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: `lib/finance/entry-validation.ts` — `validateEntryInput`

**Files:**
- Create: `lib/finance/entry-validation.ts`
- Test: `tests/finance/entry-validation.test.ts`

**Interfaces:**
- Consumes: `FinanceCategoryTree` (Task 4).
- Produces: `EntryValidationError`, `EntryInput`, `validateEntryInput(tree, input)`. Usada por `POST`/`PATCH` de `finance/entries` (Task 10) e pelo agente (Task 16, indiretamente via `resolveCategoryPair`, mas a rota usa esta).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/finance/entry-validation.test.ts
import { describe, it, expect } from 'vitest'
import { validateEntryInput } from '@/lib/finance/entry-validation'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

const TREE: FinanceCategoryTree = {
  pf: [{ id: 'fil', name: 'Filhos', sortOrder: 0, isArchived: false, children: [
        { id: 'esc', name: 'Escola', sortOrder: 0, isArchived: false, children: [] }] }],
  pj: [{ id: 'alu', name: 'Aluguel', sortOrder: 0, isArchived: false, children: [] }],
}
const base = { type: 'pf' as const, entryDate: '2026-09-01', amount: 100, categoryId: null, subcategoryId: null }

describe('validateEntryInput', () => {
  it('aceita lançamento sem categoria', () => {
    expect(validateEntryInput(TREE, base)).toBeNull()
  })
  it('aceita categoria + subcategoria coerentes', () => {
    expect(validateEntryInput(TREE, { ...base, categoryId: 'fil', subcategoryId: 'esc' })).toBeNull()
  })
  it('rejeita valor <= 0 ou não finito', () => {
    expect(validateEntryInput(TREE, { ...base, amount: 0 })).toEqual({ code: 'amount_invalid' })
    expect(validateEntryInput(TREE, { ...base, amount: Number.NaN })).toEqual({ code: 'amount_invalid' })
  })
  it('rejeita data fora de YYYY-MM-DD', () => {
    expect(validateEntryInput(TREE, { ...base, entryDate: '01/09/2026' })).toEqual({ code: 'date_invalid' })
  })
  it('rejeita category_id inexistente', () => {
    expect(validateEntryInput(TREE, { ...base, categoryId: 'ghost' })).toEqual({ code: 'category_not_found' })
  })
  it('rejeita categoria de kind diferente do type', () => {
    expect(validateEntryInput(TREE, { ...base, categoryId: 'alu' })).toEqual({ code: 'category_kind_mismatch' })
  })
  it('rejeita subcategoria que não é filha da categoria', () => {
    expect(validateEntryInput(TREE, { ...base, categoryId: 'fil', subcategoryId: 'alu' })).toEqual({ code: 'subcategory_not_child' })
  })
  it('rejeita subcategoria sem categoria', () => {
    expect(validateEntryInput(TREE, { ...base, subcategoryId: 'esc' })).toEqual({ code: 'subcategory_not_child' })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/finance/entry-validation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `lib/finance/entry-validation.ts`**

```ts
import type { FinanceCategoryTree, CategoryNode } from './categories'
import type { FinanceEntryType } from './types'

export type EntryValidationError =
  | { code: 'amount_invalid' }
  | { code: 'date_invalid' }
  | { code: 'category_not_found' }
  | { code: 'subcategory_not_found' }
  | { code: 'category_kind_mismatch' }
  | { code: 'subcategory_not_child' }

export interface EntryInput {
  type: FinanceEntryType
  entryDate: string
  amount: number
  categoryId: string | null
  subcategoryId: string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function findRoot(tree: FinanceCategoryTree, id: string): { node: CategoryNode; kind: FinanceEntryType } | null {
  for (const kind of ['pf', 'pj'] as const) {
    const hit = tree[kind].find((c) => c.id === id)
    if (hit) return { node: hit, kind }
  }
  return null
}

// Valida um lançamento manual (rota) ou editado. Não checa workspace_id — isso
// exige query e fica na rota.
export function validateEntryInput(
  tree: FinanceCategoryTree,
  input: EntryInput
): EntryValidationError | null {
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { code: 'amount_invalid' }
  if (!ISO_DATE.test(input.entryDate) || Number.isNaN(Date.parse(input.entryDate))) {
    return { code: 'date_invalid' }
  }

  let root: { node: CategoryNode; kind: FinanceEntryType } | null = null
  if (input.categoryId) {
    root = findRoot(tree, input.categoryId)
    if (!root) return { code: 'category_not_found' }
    if (root.kind !== input.type) return { code: 'category_kind_mismatch' }
  }

  if (input.subcategoryId) {
    if (!root) return { code: 'subcategory_not_child' }
    const child = root.node.children.find((s) => s.id === input.subcategoryId)
    if (!child) {
      // existe em algum lugar? erro mais específico
      const anywhere = ['pf', 'pj'].some((k) =>
        tree[k as FinanceEntryType].some((c) => c.children.some((s) => s.id === input.subcategoryId))
      )
      return anywhere ? { code: 'subcategory_not_child' } : { code: 'subcategory_not_found' }
    }
  }

  return null
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/finance/entry-validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/finance/entry-validation.ts tests/finance/entry-validation.test.ts
git commit -m "feat(finance): validateEntryInput

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: `lib/finance/types.ts` — `FinanceEntry` + `FinanceIntent`

**Files:**
- Modify: `lib/finance/types.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `FinanceEntry` com `category_id: string | null`, `subcategory_id: string | null`; `FinanceIntent` variante `entry` com `subcategory: string | null`; variante `query` com `subcategory: string | null`.

- [ ] **Step 1: Editar `lib/finance/types.ts`**

Em `FinanceEntry` (após `category: string | null`):
```ts
  // Vínculo com a árvore finance_categories. null = "Sem categoria" na tela
  // (lançamento antigo sem match, ou lançado sem categoria). `category` (texto)
  // segue preenchido como snapshot do nome resolvido.
  category_id: string | null
  subcategory_id: string | null
```

Na variante `entry` de `FinanceIntent` (após `category: string | null`):
```ts
      // Nome da subcategoria deduzido (linguagem natural) ou null. O agente
      // resolve nome -> id contra a árvore da conta.
      subcategory: string | null
```

Na variante `query` (após `category: string | null`):
```ts
subcategory: string | null;
```

Ajustar o comentário do topo da variante `entry` que hoje diz "`category` vem preenchida... null (caminho dos atalhos) faz o agente categorizar" — acrescentar que `subcategory` segue a mesma lógica.

- [ ] **Step 2: Verificar tipos (vai quebrar consumidores — esperado)**

Run: `npx tsc --noEmit`
Expected: FAIL em `lib/finance/parser.ts` (retorna `entry`/`query` sem `subcategory`), `lib/finance/interpret.ts`, `lib/finance/agent.ts`. Anotar os arquivos; serão corrigidos nas Tasks 8/15/16. **Não corrigir agora** além do próximo passo.

- [ ] **Step 3: Corrigir `lib/finance/parser.ts` (mínimo para compilar)**

Nas duas construções de retorno de `parser.ts`:
- No `resumoMatch` (`kind: 'query'`): adicionar `subcategory: null,`
- No `entryMatch` (`kind: 'entry'`): adicionar `subcategory: null,` (atalho `/pf`/`/pj` não deduz subcategoria)

- [ ] **Step 4: Verificar que `parser.ts` compila isolado**

Run: `npx vitest run tests/finance/` (os testes existentes de parser/resolve-unit continuam passando; interpret/agent ainda não têm teste novo)
Expected: os testes atuais passam; `tsc --noEmit` ainda acusa `interpret.ts`/`agent.ts` (ok, próximas tasks).

- [ ] **Step 5: Commit**

```bash
git add lib/finance/types.ts lib/finance/parser.ts
git commit -m "feat(finance): campos category_id/subcategory_id e subcategory no intent

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: API — `app/api/finance/categories/route.ts` (GET + POST)

**Files:**
- Create: `app/api/finance/categories/route.ts`
- Test: `tests/finance/api-categories.test.ts`

**Interfaces:**
- Consumes: `requireWorkspaceSession`, `requireModule`, `requireRole` (`lib/session/api`); `getFinanceCategoryTree` (Task 4); `validateCategoryShape` (Task 5); `ensureFinanceCategories` (Task 3).
- Produces: `GET /api/finance/categories?kind=pf|pj` → `{ pf: NodeWithCount[], pj: NodeWithCount[] }` onde `NodeWithCount = CategoryNode & { entryCount: number }`; `POST` body `{ kind, name, parent_id? }` → `201` `{ id }` ou `400 { error, code }`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/finance/api-categories.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock, role: 'owner' as string }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client,
  createAdminClient: () => g.supabase.client,
}))
vi.mock('@/lib/session/api', () => ({
  requireWorkspaceSession: async () => ({
    session: { userId: 'u1', accountId: 'a1', workspaceId: 'w1', role: g.role, modules: ['finance'] },
  }),
  requireModule: () => null,
  requireRole: (s: { role: string }, roles: string[]) =>
    roles.includes(s.role) ? null : new Response(JSON.stringify({ error: 'nope' }), { status: 403 }),
}))

import { GET, POST } from '@/app/api/finance/categories/route'

const CAT_ROWS = [
  { id: 'r1', account_id: 'a1', kind: 'pf', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: false, created_at: '' },
]

function req(body?: unknown, url = 'https://app.test/api/finance/categories') {
  return new Request(url, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
}

beforeEach(() => { g.role = 'owner' })

describe('GET /api/finance/categories', () => {
  it('403 para não-owner', async () => {
    g.role = 'admin'
    g.supabase = createSupabaseMock()
    const res = await GET(req() as never)
    expect(res.status).toBe(403)
  })
  it('devolve a árvore com entryCount', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CAT_ROWS } },
      finance_entries: { select: { data: [{ category_id: 'r1', subcategory_id: null }] } },
    })
    const res = await GET(req() as never)
    const json = await res.json()
    expect(json.pf[0].entryCount).toBe(1)
  })
})

describe('POST /api/finance/categories', () => {
  it('400 com code para nome vazio', async () => {
    g.supabase = createSupabaseMock({ finance_categories: { select: { data: CAT_ROWS } } })
    const res = await POST(req({ kind: 'pf', name: '  ' }) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('empty_name')
  })
  it('insere e devolve 201 com id', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CAT_ROWS }, insert: { data: { id: 'new-1' } } },
    })
    const res = await POST(req({ kind: 'pf', name: 'Pets' }) as never)
    expect(res.status).toBe(201)
    expect((await res.json()).id).toBe('new-1')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/finance/api-categories.test.ts`
Expected: FAIL — rota não existe.

- [ ] **Step 3: Implementar `app/api/finance/categories/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule, requireRole } from '@/lib/session/api'
import { ensureFinanceCategories } from '@/lib/finance/provision'
import { getFinanceCategoryTree, type CategoryNode } from '@/lib/finance/categories'
import { validateCategoryShape } from '@/lib/finance/category-validation'

// CRUD da árvore de categorias do financeiro. Exclusivo do owner (dado
// financeiro), módulo 'finance'. Escrita com createClient() — a policy
// "finance_categories: owner only" é o guarda.

async function guard(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return { error: result.error }
  const mod = requireModule(result.session, 'finance')
  if (mod) return { error: mod }
  const role = requireRole(result.session, ['owner'])
  if (role) return { error: role }
  return { session: result.session }
}

export async function GET(req: NextRequest) {
  const g = await guard(req)
  if ('error' in g) return g.error
  const supabase = await createClient()
  await ensureFinanceCategories(supabase, g.session.accountId)

  const tree = await getFinanceCategoryTree(supabase, g.session.accountId, { includeArchived: true })
  const { data: refs } = await supabase
    .from('finance_entries')
    .select('category_id, subcategory_id')
    .eq('account_id', g.session.accountId)

  const counts = new Map<string, number>()
  for (const r of refs ?? []) {
    for (const id of [r.category_id, r.subcategory_id]) {
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  const withCounts = (nodes: CategoryNode[]): (CategoryNode & { entryCount: number })[] =>
    nodes.map((n) => ({ ...n, entryCount: counts.get(n.id) ?? 0, children: withCounts(n.children) }))

  const kind = req.nextUrl.searchParams.get('kind')
  const out = { pf: withCounts(tree.pf), pj: withCounts(tree.pj) }
  if (kind === 'pf' || kind === 'pj') return NextResponse.json({ [kind]: out[kind] })
  return NextResponse.json(out)
}

export async function POST(req: NextRequest) {
  const g = await guard(req)
  if ('error' in g) return g.error
  const body = await req.json().catch(() => ({}))
  const kind = String(body.kind ?? '')
  const name = String(body.name ?? '').trim()
  const parentId = body.parent_id ? String(body.parent_id) : null

  const supabase = await createClient()
  await ensureFinanceCategories(supabase, g.session.accountId)
  const tree = await getFinanceCategoryTree(supabase, g.session.accountId, { includeArchived: true })

  const err = validateCategoryShape(tree, { kind, name, parentId })
  if (err) return NextResponse.json({ error: 'Categoria inválida', code: err.code }, { status: 400 })

  // sort_order = fim da lista de irmãs
  const siblings = parentId
    ? (tree[kind as 'pf' | 'pj'].find((c) => c.id === parentId)?.children ?? [])
    : tree[kind as 'pf' | 'pj']
  const sortOrder = siblings.length

  const { data, error } = await supabase
    .from('finance_categories')
    .insert({ account_id: g.session.accountId, kind: kind as 'pf' | 'pj', parent_id: parentId, name, sort_order: sortOrder })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id }, { status: 201 })
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/finance/api-categories.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/finance/categories/route.ts tests/finance/api-categories.test.ts
git commit -m "feat(finance): GET/POST /api/finance/categories

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: API — `app/api/finance/categories/[id]/route.ts` (PATCH + DELETE)

**Files:**
- Create: `app/api/finance/categories/[id]/route.ts`
- Test: adicionar a `tests/finance/api-categories.test.ts`

**Interfaces:**
- Consumes: mesmos helpers da Task 8.
- Produces: `PATCH /api/finance/categories/:id` body `{ name?, parent_id?, sort_order?, is_archived? }` → `200 { ok: true }` ou `400 { error, code }`. `DELETE` → `200 { ok: true }` ou `409 { error, code: 'in_use', children, entries }`.

- [ ] **Step 1: Escrever os testes que falham** (append no arquivo da Task 8)

```ts
import { PATCH, DELETE } from '@/app/api/finance/categories/[id]/route'

const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('PATCH /api/finance/categories/[id]', () => {
  it('arquivar raiz cascateia para os filhos', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: {
        select: { data: [
          { id: 'r1', account_id: 'a1', kind: 'pf', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: false, created_at: '' },
          { id: 's1', account_id: 'a1', kind: 'pf', parent_id: 'r1', name: 'Escola', sort_order: 0, is_archived: false, created_at: '' },
        ] },
        update: { data: null },
      },
    })
    const res = await PATCH(new Request('https://app.test/x', { method: 'PATCH', body: JSON.stringify({ is_archived: true }), headers: { 'content-type': 'application/json' } }) as never, params('r1') as never)
    expect(res.status).toBe(200)
    const updates = g.supabase.callsTo('finance_categories', 'update')
    expect(updates.length).toBeGreaterThanOrEqual(1) // raiz + filhos (via .in ou 2ª chamada)
  })
  it('400 ao renomear para nome de irmã existente', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: [
        { id: 'r1', account_id: 'a1', kind: 'pf', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: false, created_at: '' },
        { id: 'r2', account_id: 'a1', kind: 'pf', parent_id: null, name: 'Alimentação', sort_order: 1, is_archived: false, created_at: '' },
      ] } },
    })
    const res = await PATCH(new Request('https://app.test/x', { method: 'PATCH', body: JSON.stringify({ name: 'alimentacao' }), headers: { 'content-type': 'application/json' } }) as never, params('r1') as never)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('duplicate_sibling')
  })
})

describe('DELETE /api/finance/categories/[id]', () => {
  it('409 quando há lançamentos usando', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: [
        { id: 'r1', account_id: 'a1', kind: 'pf', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: false, created_at: '' },
      ] } },
      finance_entries: { select: { data: [{ id: 'e1' }] } },
    })
    const res = await DELETE(new Request('https://app.test/x', { method: 'DELETE' }) as never, params('r1') as never)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('in_use')
  })
  it('200 quando vazia', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: [
        { id: 'r1', account_id: 'a1', kind: 'pf', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: false, created_at: '' },
      ] }, delete: { data: null } },
      finance_entries: { select: { data: [] } },
    })
    const res = await DELETE(new Request('https://app.test/x', { method: 'DELETE' }) as never, params('r1') as never)
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/finance/api-categories.test.ts`
Expected: FAIL — rota `[id]` não existe.

- [ ] **Step 3: Implementar `app/api/finance/categories/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule, requireRole } from '@/lib/session/api'
import { getFinanceCategoryTree, type FinanceCategoryTree, type CategoryNode } from '@/lib/finance/categories'
import { validateCategoryShape } from '@/lib/finance/category-validation'

async function guard(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return { error: result.error }
  const mod = requireModule(result.session, 'finance')
  if (mod) return { error: mod }
  const role = requireRole(result.session, ['owner'])
  if (role) return { error: role }
  return { session: result.session }
}

function findNode(tree: FinanceCategoryTree, id: string):
  { node: CategoryNode; kind: 'pf' | 'pj'; parentId: string | null } | null {
  for (const kind of ['pf', 'pj'] as const) {
    for (const root of tree[kind]) {
      if (root.id === id) return { node: root, kind, parentId: null }
      for (const child of root.children) if (child.id === id) return { node: child, kind, parentId: root.id }
    }
  }
  return null
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await guard(req)
  if ('error' in g) return g.error
  const body = await req.json().catch(() => ({}))

  const supabase = await createClient()
  const tree = await getFinanceCategoryTree(supabase, g.session.accountId, { includeArchived: true })
  const found = findNode(tree, id)
  if (!found) return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 404 })

  const nextName = body.name !== undefined ? String(body.name).trim() : found.node.name
  const nextParent =
    body.parent_id !== undefined ? (body.parent_id ? String(body.parent_id) : null) : found.parentId

  if (body.name !== undefined || body.parent_id !== undefined) {
    const err = validateCategoryShape(tree, {
      kind: found.kind, name: nextName, parentId: nextParent, nodeId: id,
    })
    if (err) return NextResponse.json({ error: 'Alteração inválida', code: err.code }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = nextName
  if (body.parent_id !== undefined) patch.parent_id = nextParent
  if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order)
  if (body.is_archived !== undefined) patch.is_archived = Boolean(body.is_archived)

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })

  const { error } = await supabase.from('finance_categories').update(patch).eq('id', id).eq('account_id', g.session.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Arquivar/desarquivar raiz cascateia para as subcategorias.
  if (body.is_archived !== undefined && found.parentId === null && found.node.children.length > 0) {
    await supabase
      .from('finance_categories')
      .update({ is_archived: Boolean(body.is_archived) })
      .eq('account_id', g.session.accountId)
      .eq('parent_id', id)
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await guard(req)
  if ('error' in g) return g.error

  const supabase = await createClient()
  const tree = await getFinanceCategoryTree(supabase, g.session.accountId, { includeArchived: true })
  const found = findNode(tree, id)
  if (!found) return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 404 })

  const childCount = found.node.children.length
  const { data: entryRefs } = await supabase
    .from('finance_entries')
    .select('id')
    .eq('account_id', g.session.accountId)
    .or(`category_id.eq.${id},subcategory_id.eq.${id}`)
  const entryCount = entryRefs?.length ?? 0

  if (childCount > 0 || entryCount > 0) {
    return NextResponse.json(
      { error: 'Categoria em uso — arquive em vez de excluir', code: 'in_use', children: childCount, entries: entryCount },
      { status: 409 }
    )
  }

  const { error } = await supabase.from('finance_categories').delete().eq('id', id).eq('account_id', g.session.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/finance/api-categories.test.ts`
Expected: PASS. (Se o mock não suportar `.or()`, ajustar o teste do `DELETE` para configurar `finance_entries.select` retornando o array desejado — o mock ignora o filtro e devolve `data` configurado.)

- [ ] **Step 5: Commit**

```bash
git add "app/api/finance/categories/[id]/route.ts" tests/finance/api-categories.test.ts
git commit -m "feat(finance): PATCH/DELETE /api/finance/categories/[id]

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: API — `app/api/finance/entries` (POST) + `[id]` (PATCH + DELETE)

**Files:**
- Create: `app/api/finance/entries/route.ts`, `app/api/finance/entries/[id]/route.ts`
- Test: `tests/finance/api-entries.test.ts`

**Interfaces:**
- Consumes: helpers de sessão; `getFinanceCategoryTree` (Task 4); `validateEntryInput` (Task 6); `ensureFinanceCategories` (Task 3).
- Produces: `POST /api/finance/entries` body `{ type, entry_date, description?, amount, category_id?, subcategory_id?, workspace_id? }` → `201 { id }`. `PATCH /api/finance/entries/:id` mesmos campos (menos `type`) → `200 { ok: true }`. `DELETE` → `200 { ok: true }`. Servidor grava `recorded_by_phone: 'web'`, `raw_message: '(lançado na tela)'`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/finance/api-entries.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseMock, type SupabaseMock, filterValue } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock, role: 'owner' as string }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client, createAdminClient: () => g.supabase.client,
}))
vi.mock('@/lib/session/api', () => ({
  requireWorkspaceSession: async () => ({
    session: { userId: 'u1', accountId: 'a1', workspaceId: 'w1', role: g.role, modules: ['finance'] },
  }),
  requireModule: () => null,
  requireRole: (s: { role: string }, roles: string[]) =>
    roles.includes(s.role) ? null : new Response('{}', { status: 403 }),
}))
vi.mock('@/lib/finance/provision', () => ({ ensureFinanceCategories: vi.fn(async () => {}) }))

import { POST } from '@/app/api/finance/entries/route'
import { PATCH, DELETE } from '@/app/api/finance/entries/[id]/route'

const CATS = [
  { id: 'fil', account_id: 'a1', kind: 'pf', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: false, created_at: '' },
  { id: 'esc', account_id: 'a1', kind: 'pf', parent_id: 'fil', name: 'Escola', sort_order: 0, is_archived: false, created_at: '' },
]
const body = (o: Record<string, unknown>) =>
  new Request('https://app.test/x', { method: 'POST', body: JSON.stringify(o), headers: { 'content-type': 'application/json' } })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => { g.role = 'owner' })

describe('POST /api/finance/entries', () => {
  it('cria com recorded_by_phone=web e devolve 201', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CATS } },
      finance_entries: { insert: { data: { id: 'e-new' } } },
    })
    const res = await POST(body({ type: 'pf', entry_date: '2026-09-01', amount: 120, category_id: 'fil', subcategory_id: 'esc' }) as never)
    expect(res.status).toBe(201)
    const ins = g.supabase.callsTo('finance_entries', 'insert')[0]
    expect((ins.payload as Record<string, unknown>).recorded_by_phone).toBe('web')
    expect((ins.payload as Record<string, unknown>).raw_message).toBe('(lançado na tela)')
  })
  it('400 para subcategoria de outra categoria', async () => {
    g.supabase = createSupabaseMock({ finance_categories: { select: { data: CATS } } })
    const res = await POST(body({ type: 'pf', entry_date: '2026-09-01', amount: 10, category_id: 'fil', subcategory_id: 'nope' }) as never)
    expect(res.status).toBe(400)
  })
  it('400 se workspace_id não pertence à conta', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CATS } },
      workspaces: { select: { data: null } },
    })
    const res = await POST(body({ type: 'pj', entry_date: '2026-09-01', amount: 10, workspace_id: 'w-outra' }) as never)
    expect(res.status).toBe(400)
  })
})

describe('PATCH/DELETE /api/finance/entries/[id]', () => {
  it('PATCH atualiza amount', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CATS } },
      finance_entries: { select: { data: { id: 'e1', account_id: 'a1', type: 'pf' } }, update: { data: null } },
    })
    const res = await PATCH(new Request('https://app.test/x', { method: 'PATCH', body: JSON.stringify({ amount: 99 }), headers: { 'content-type': 'application/json' } }) as never, params('e1') as never)
    expect(res.status).toBe(200)
  })
  it('DELETE remove', async () => {
    g.supabase = createSupabaseMock({
      finance_entries: { select: { data: { id: 'e1', account_id: 'a1', type: 'pf' } }, delete: { data: null } },
    })
    const res = await DELETE(new Request('https://app.test/x', { method: 'DELETE' }) as never, params('e1') as never)
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/finance/api-entries.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `app/api/finance/entries/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule, requireRole } from '@/lib/session/api'
import { ensureFinanceCategories } from '@/lib/finance/provision'
import { getFinanceCategoryTree } from '@/lib/finance/categories'
import { validateEntryInput } from '@/lib/finance/entry-validation'
import type { FinanceEntryType } from '@/lib/finance/types'

async function guard(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return { error: result.error }
  const mod = requireModule(result.session, 'finance')
  if (mod) return { error: mod }
  const role = requireRole(result.session, ['owner'])
  if (role) return { error: role }
  return { session: result.session }
}

// Body compartilhado entre POST e PATCH. `type` só no POST.
async function readEntryBody(req: NextRequest) {
  const b = await req.json().catch(() => ({}))
  return {
    type: b.type as FinanceEntryType | undefined,
    entryDate: b.entry_date ? String(b.entry_date) : undefined,
    description: b.description === undefined ? undefined : (b.description ? String(b.description) : null),
    amount: b.amount === undefined ? undefined : Number(b.amount),
    categoryId: b.category_id === undefined ? undefined : (b.category_id ? String(b.category_id) : null),
    subcategoryId: b.subcategory_id === undefined ? undefined : (b.subcategory_id ? String(b.subcategory_id) : null),
    workspaceId: b.workspace_id === undefined ? undefined : (b.workspace_id ? String(b.workspace_id) : null),
  }
}

async function workspaceBelongs(
  supabase: Awaited<ReturnType<typeof createClient>>, accountId: string, workspaceId: string
): Promise<boolean> {
  const { data } = await supabase.from('workspaces').select('id').eq('id', workspaceId).eq('account_id', accountId).maybeSingle()
  return !!data
}

export async function POST(req: NextRequest) {
  const g = await guard(req)
  if ('error' in g) return g.error
  const b = await readEntryBody(req)

  if (b.type !== 'pf' && b.type !== 'pj') {
    return NextResponse.json({ error: "type deve ser 'pf' ou 'pj'" }, { status: 400 })
  }
  const supabase = await createClient()
  await ensureFinanceCategories(supabase, g.session.accountId)
  const tree = await getFinanceCategoryTree(supabase, g.session.accountId)

  const err = validateEntryInput(tree, {
    type: b.type,
    entryDate: b.entryDate ?? '',
    amount: b.amount ?? NaN,
    categoryId: b.categoryId ?? null,
    subcategoryId: b.subcategoryId ?? null,
  })
  if (err) return NextResponse.json({ error: 'Lançamento inválido', code: err.code }, { status: 400 })

  if (b.type === 'pj' && b.workspaceId) {
    if (!(await workspaceBelongs(supabase, g.session.accountId, b.workspaceId))) {
      return NextResponse.json({ error: 'Unidade inválida', code: 'workspace_invalid' }, { status: 400 })
    }
  }

  const { data, error } = await supabase
    .from('finance_entries')
    .insert({
      account_id: g.session.accountId,
      workspace_id: b.type === 'pj' ? b.workspaceId ?? null : null,
      recorded_by_phone: 'web',
      type: b.type,
      description: b.description ?? null,
      amount: b.amount as number,
      category: null,
      category_id: b.categoryId ?? null,
      subcategory_id: b.subcategoryId ?? null,
      raw_message: '(lançado na tela)',
      entry_date: b.entryDate as string,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id }, { status: 201 })
}
```

- [ ] **Step 4: Implementar `app/api/finance/entries/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule, requireRole } from '@/lib/session/api'
import { getFinanceCategoryTree } from '@/lib/finance/categories'
import { validateEntryInput } from '@/lib/finance/entry-validation'
import type { FinanceEntryType } from '@/lib/finance/types'

async function guard(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return { error: result.error }
  const mod = requireModule(result.session, 'finance')
  if (mod) return { error: mod }
  const role = requireRole(result.session, ['owner'])
  if (role) return { error: role }
  return { session: result.session }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await guard(req)
  if ('error' in g) return g.error
  const b = await req.json().catch(() => ({}))

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('finance_entries')
    .select('id, account_id, type')
    .eq('id', id)
    .eq('account_id', g.session.accountId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Lançamento não encontrado' }, { status: 404 })

  const type = existing.type as FinanceEntryType
  const tree = await getFinanceCategoryTree(supabase, g.session.accountId)

  const patch: Record<string, unknown> = {}
  if (b.entry_date !== undefined) patch.entry_date = String(b.entry_date)
  if (b.description !== undefined) patch.description = b.description ? String(b.description) : null
  if (b.amount !== undefined) patch.amount = Number(b.amount)
  if (b.category_id !== undefined) patch.category_id = b.category_id ? String(b.category_id) : null
  if (b.subcategory_id !== undefined) patch.subcategory_id = b.subcategory_id ? String(b.subcategory_id) : null
  if (b.workspace_id !== undefined && type === 'pj') {
    const wid = b.workspace_id ? String(b.workspace_id) : null
    if (wid) {
      const { data: ws } = await supabase.from('workspaces').select('id').eq('id', wid).eq('account_id', g.session.accountId).maybeSingle()
      if (!ws) return NextResponse.json({ error: 'Unidade inválida', code: 'workspace_invalid' }, { status: 400 })
    }
    patch.workspace_id = wid
  }

  // Revalida categoria/subcategoria com os valores finais.
  const err = validateEntryInput(tree, {
    type,
    entryDate: (patch.entry_date as string) ?? '2026-01-01', // data só falha se veio no patch e é inválida
    amount: patch.amount !== undefined ? (patch.amount as number) : 1,
    categoryId: (patch.category_id as string | null) ?? null,
    subcategoryId: (patch.subcategory_id as string | null) ?? null,
  })
  if (err && !(err.code === 'date_invalid' && b.entry_date === undefined) && !(err.code === 'amount_invalid' && b.amount === undefined)) {
    return NextResponse.json({ error: 'Alteração inválida', code: err.code }, { status: 400 })
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })
  const { error } = await supabase.from('finance_entries').update(patch).eq('id', id).eq('account_id', g.session.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await guard(req)
  if ('error' in g) return g.error
  const supabase = await createClient()
  const { error, count } = await supabase
    .from('finance_entries')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('account_id', g.session.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Lançamento não encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
```

> Nota de revisão: a revalidação no PATCH é deliberadamente frouxa para `date`/`amount` não informados. Se o revisor preferir, extrair um `validateEntryPatch` dedicado em `lib/finance/entry-validation.ts` com teste próprio — não obrigatório para o bloco A.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/finance/api-entries.test.ts`
Expected: PASS. (Se o mock `delete({ count })` não devolver `count`, configurar `finance_entries.delete` como `{ data: null, count: 1 }` no teste.)

- [ ] **Step 6: Commit**

```bash
git add app/api/finance/entries tests/finance/api-entries.test.ts
git commit -m "feat(finance): CRUD /api/finance/entries

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: `finance/page.tsx` — provisionar, carregar árvore, passar ao client

**Files:**
- Modify: `app/(dashboard)/finance/page.tsx`
- Modify: `components/finance/FinanceClient.tsx` (só a assinatura de props + tipos; a reestruturação visual é a Task 15)

**Interfaces:**
- Consumes: `ensureFinanceCategories` (Task 3), `getFinanceCategoryTree` (Task 4).
- Produces: `FinanceClient` passa a receber `categoryTree: FinanceCategoryTree` e `entries` já com `category_id`/`subcategory_id`. `workspaces: { id: string; name: string }[]` também vai como prop (para o form PJ).

- [ ] **Step 1: Editar `app/(dashboard)/finance/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { ensureFinanceCategories } from '@/lib/finance/provision'
import { getFinanceCategoryTree } from '@/lib/finance/categories'
import { FinanceClient } from '@/components/finance/FinanceClient'
import type { FinanceEntry } from '@/lib/finance/types'

const MONTHS_OF_HISTORY = 12

export default async function FinancePage() {
  const session = await resolveActiveSession()
  if (!session) redirect('/sem-acesso')
  if (session.role !== 'owner') redirect('/dashboard')
  if (!session.accountModules.includes('finance')) redirect('/dashboard')

  const supabase = await createClient()

  // Provisiona a árvore de categorias na primeira visita (idempotente).
  await ensureFinanceCategories(supabase, session.accountId)

  const now = new Date()
  const cutoff = new Date(now.getFullYear(), now.getMonth() - (MONTHS_OF_HISTORY - 1), 1)
    .toISOString().split('T')[0]

  const [{ data: entries }, categoryTree, { data: workspaces }] = await Promise.all([
    supabase
      .from('finance_entries')
      .select('*')
      .eq('account_id', session.accountId)
      .gte('entry_date', cutoff)
      .order('entry_date', { ascending: false }),
    getFinanceCategoryTree(supabase, session.accountId),
    supabase.from('workspaces').select('id, name').eq('account_id', session.accountId).eq('is_active', true).order('display_order'),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Financeiro</h1>
        <p className="text-sm text-gray-400">
          Lançamentos pessoais (PF) e da clínica (PJ) — pelo WhatsApp ou aqui na tela
        </p>
      </div>
      <FinanceClient
        initialEntries={(entries ?? []) as FinanceEntry[]}
        categoryTree={categoryTree}
        workspaces={workspaces ?? []}
      />
    </div>
  )
}
```

- [ ] **Step 2: Ajustar a assinatura de `FinanceClient` (sem reestruturar ainda)**

Em `components/finance/FinanceClient.tsx`, trocar a assinatura para aceitar as props novas e manter o corpo atual funcionando (o `entries` filtrado por `type`/`month` já existe; ignore `categoryTree`/`workspaces` por enquanto com um `// eslint-disable-next-line` ou use-os só no tipo):

```tsx
import type { FinanceCategoryTree } from '@/lib/finance/categories'

export function FinanceClient({
  initialEntries,
  categoryTree,
  workspaces,
}: {
  initialEntries: FinanceEntry[]
  categoryTree: FinanceCategoryTree
  workspaces: { id: string; name: string }[]
}) {
  // ...corpo atual inalterado; categoryTree/workspaces usados na Task 15...
  void categoryTree; void workspaces
```

- [ ] **Step 3: Verificar build + tipos**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: Verificação manual no preview**

Run: `preview_start` com o dev server; abrir `/finance` logado como owner.
Expected: a tela carrega igual a antes (nada visual mudou), sem erro no console nem no server log. Conferir no Supabase que `finance_categories` foi populada para a conta e que `finance_entries.category_id` foi backfillado onde o nome batia.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/finance/page.tsx" components/finance/FinanceClient.tsx
git commit -m "feat(finance): provisiona categorias e carrega a árvore em /finance

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: `components/finance/FinanceCategoryPicker.tsx`

**Files:**
- Create: `components/finance/FinanceCategoryPicker.tsx`

**Interfaces:**
- Consumes: `FinanceCategoryTree`, `CategoryNode` (Task 4); `components/ui/select`.
- Produces:
  ```tsx
  export function FinanceCategoryPicker(props: {
    kind: 'pf' | 'pj'
    tree: FinanceCategoryTree
    categoryId: string | null
    subcategoryId: string | null
    onChange: (next: { categoryId: string | null; subcategoryId: string | null }) => void
    disabled?: boolean
  }): JSX.Element
  ```
  Dois `Select`: categoria (raízes não-arquivadas do `kind`) e subcategoria (filhas da categoria escolhida; escondido/desabilitado se a categoria não tem filhas). Trocar a categoria zera a subcategoria. Inclui opção "Sem categoria" (valor vazio).

- [ ] **Step 1: Implementar o componente**

```tsx
'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

const NONE = '__none__'

export function FinanceCategoryPicker({
  kind, tree, categoryId, subcategoryId, onChange, disabled,
}: {
  kind: 'pf' | 'pj'
  tree: FinanceCategoryTree
  categoryId: string | null
  subcategoryId: string | null
  onChange: (next: { categoryId: string | null; subcategoryId: string | null }) => void
  disabled?: boolean
}) {
  const roots = tree[kind].filter((c) => !c.isArchived)
  const current = roots.find((c) => c.id === categoryId) ?? null
  const subs = (current?.children ?? []).filter((s) => !s.isArchived)

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs text-gray-400">Categoria</label>
        <Select
          value={categoryId ?? NONE}
          disabled={disabled}
          onValueChange={(v) => onChange({ categoryId: v === NONE ? null : v, subcategoryId: null })}
        >
          <SelectTrigger><SelectValue placeholder="Sem categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Sem categoria</SelectItem>
            {roots.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {subs.length > 0 && (
        <div>
          <label className="mb-1 block text-xs text-gray-400">Subcategoria</label>
          <Select
            value={subcategoryId ?? NONE}
            disabled={disabled}
            onValueChange={(v) => onChange({ categoryId, subcategoryId: v === NONE ? null : v })}
          >
            <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Nenhuma</SelectItem>
              {subs.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verificar tipos + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/finance/FinanceCategoryPicker.tsx
git commit -m "feat(finance): FinanceCategoryPicker (select categoria + subcategoria)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 13: `FinanceEntryForm.tsx` + `FinanceEntryTable.tsx` (ações e colunas)

**Files:**
- Create: `components/finance/FinanceEntryForm.tsx`
- Modify: `components/finance/FinanceEntryTable.tsx`

**Interfaces:**
- Consumes: `FinanceCategoryPicker` (Task 12); `FinanceCategoryTree` (Task 4); rotas `POST/PATCH/DELETE /api/finance/entries` (Task 10); `components/ui/{dialog,input,button,label}`.
- Produces:
  ```tsx
  export function FinanceEntryForm(props: {
    open: boolean
    onOpenChange: (o: boolean) => void
    kind: 'pf' | 'pj'
    tree: FinanceCategoryTree
    workspaces: { id: string; name: string }[]
    entry: FinanceEntry | null // null = criar
    onSaved: () => void         // chama router.refresh() no pai
  }): JSX.Element
  ```
  `FinanceEntryTable` passa a aceitar `onEdit(entry)` e `onDelete(entry)` e a renderizar as colunas Subcategoria (nome resolvido via `tree`) e Unidade (só quando `kind==='pj'`), além de um menu `⋯` por linha. Para resolver nomes, o table recebe também `tree: FinanceCategoryTree`.

- [ ] **Step 1: Implementar `FinanceEntryForm.tsx`**

```tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FinanceCategoryPicker } from './FinanceCategoryPicker'
import type { FinanceCategoryTree } from '@/lib/finance/categories'
import type { FinanceEntry } from '@/lib/finance/types'

const NONE = '__none__'
const todayISO = () => new Date().toISOString().slice(0, 10)

export function FinanceEntryForm({
  open, onOpenChange, kind, tree, workspaces, entry, onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  kind: 'pf' | 'pj'
  tree: FinanceCategoryTree
  workspaces: { id: string; name: string }[]
  entry: FinanceEntry | null
  onSaved: () => void
}) {
  const [date, setDate] = useState(todayISO())
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setError(null)
    setDate(entry?.entry_date ?? todayISO())
    setDescription(entry?.description ?? '')
    setAmount(entry ? String(entry.amount) : '')
    setCategoryId(entry?.category_id ?? null)
    setSubcategoryId(entry?.subcategory_id ?? null)
    setWorkspaceId(entry?.workspace_id ?? null)
  }, [open, entry])

  const submit = () => {
    setError(null)
    const value = Number(amount.replace(',', '.'))
    if (!Number.isFinite(value) || value <= 0) { setError('Informe um valor maior que zero.'); return }

    const payload = {
      type: kind,
      entry_date: date,
      description: description.trim() || null,
      amount: value,
      category_id: categoryId,
      subcategory_id: subcategoryId,
      workspace_id: kind === 'pj' ? workspaceId : null,
    }
    const url = entry ? `/api/finance/entries/${entry.id}` : '/api/finance/entries'
    const method = entry ? 'PATCH' : 'POST'

    startTransition(async () => {
      const res = await fetch(url, {
        method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? 'Não foi possível salvar.')
        return
      }
      onOpenChange(false)
      onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry ? 'Editar lançamento' : 'Novo lançamento'} — {kind === 'pf' ? 'Pessoal' : 'Clínica'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-400">Data</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Valor (R$)</label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-400">Descrição</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Escola João" />
          </div>

          <FinanceCategoryPicker
            kind={kind}
            tree={tree}
            categoryId={categoryId}
            subcategoryId={subcategoryId}
            onChange={({ categoryId, subcategoryId }) => { setCategoryId(categoryId); setSubcategoryId(subcategoryId) }}
          />

          {kind === 'pj' && workspaces.length > 1 && (
            <div>
              <label className="mb-1 block text-xs text-gray-400">Unidade</label>
              <Select value={workspaceId ?? NONE} onValueChange={(v) => setWorkspaceId(v === NONE ? null : v)}>
                <SelectTrigger><SelectValue placeholder="Consolidado (sem unidade)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Consolidado (sem unidade)</SelectItem>
                  {workspaces.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
          <Button onClick={submit} disabled={pending}>{pending ? 'Salvando…' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Reescrever `FinanceEntryTable.tsx`**

```tsx
'use client'

import { MoreVertical } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import type { FinanceEntry } from '@/lib/finance/types'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

const MAX_ROWS = 200

function names(tree: FinanceCategoryTree, e: FinanceEntry): { cat: string; sub: string } {
  const roots = e.type === 'pf' ? tree.pf : tree.pj
  const cat = roots.find((c) => c.id === e.category_id)
  const sub = cat?.children.find((s) => s.id === e.subcategory_id)
  return {
    cat: cat?.name ?? (e.category_id ? '—' : 'Sem categoria'),
    sub: sub?.name ?? '—',
  }
}

export function FinanceEntryTable({
  entries, tree, kind, unitNames, onEdit, onDelete,
}: {
  entries: FinanceEntry[]
  tree: FinanceCategoryTree
  kind: 'pf' | 'pj'
  unitNames: Record<string, string>
  onEdit: (e: FinanceEntry) => void
  onDelete: (e: FinanceEntry) => void
}) {
  const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const rows = entries.slice(0, MAX_ROWS)

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
      {rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">Nenhum lançamento neste período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 text-left text-xs text-gray-400">
                <th className="px-5 py-3 font-normal">Data</th>
                <th className="px-5 py-3 font-normal">Descrição</th>
                <th className="px-5 py-3 font-normal">Categoria</th>
                <th className="px-5 py-3 font-normal">Subcategoria</th>
                {kind === 'pj' && <th className="px-5 py-3 font-normal">Unidade</th>}
                <th className="px-5 py-3 font-normal">Valor</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const n = names(tree, e)
                return (
                  <tr key={e.id} className="border-b border-[var(--navy-06)] last:border-0">
                    <td className="px-5 py-3 text-gray-600">
                      {new Date(e.entry_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-5 py-3 text-gray-600">{e.description ?? '—'}</td>
                    <td className={`px-5 py-3 ${e.category_id ? 'text-gray-600' : 'text-amber-600'}`}>{n.cat}</td>
                    <td className="px-5 py-3 text-gray-600">{n.sub}</td>
                    {kind === 'pj' && (
                      <td className="px-5 py-3 text-gray-600">
                        {e.workspace_id ? (unitNames[e.workspace_id] ?? 'Unidade') : 'Consolidado'}
                      </td>
                    )}
                    <td className="px-5 py-3 font-medium text-gray-900">{formatBRL(e.amount)}</td>
                    <td className="px-2 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="rounded p-1 hover:bg-[var(--navy-06)]">
                          <MoreVertical className="h-4 w-4 text-gray-400" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onEdit(e)}>Editar</DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600" onClick={() => onDelete(e)}>Excluir</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verificar tipos + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: FAIL só em `FinanceClient.tsx` (ainda usa a assinatura antiga de `FinanceEntryTable`). Será resolvido na Task 15. Confirmar que os dois arquivos novos/editados desta task não têm erro próprio (checar a saída do tsc).

- [ ] **Step 4: Commit**

```bash
git add components/finance/FinanceEntryForm.tsx components/finance/FinanceEntryTable.tsx
git commit -m "feat(finance): form de lançamento + tabela com ações e subcategoria

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 14: `components/finance/FinanceCategoryManager.tsx`

**Files:**
- Create: `components/finance/FinanceCategoryManager.tsx`

**Interfaces:**
- Consumes: rotas `GET/POST /api/finance/categories`, `PATCH/DELETE /api/finance/categories/[id]` (Tasks 8-9); `components/ui/{dialog,input,button}`.
- Produces:
  ```tsx
  export function FinanceCategoryManager(props: { kind: 'pf' | 'pj' }): JSX.Element
  ```
  Busca a própria árvore via `GET /api/finance/categories?kind=<kind>` no mount e após cada mutação (estado local, sem depender de `router.refresh`). Renderiza raízes expansíveis com subcategorias; contador `entryCount`; ações Renomear / +Subcategoria / Arquivar / ↑ / ↓ na raiz; Renomear / Arquivar / Mover na subcategoria; botão + Nova categoria; toggle "Mostrar arquivadas".

- [ ] **Step 1: Implementar o componente**

Detalhes de implementação (o executor escreve o JSX seguindo estes contratos exatos):

- Estado: `const [data, setData] = useState<NodeWithCount[]>([])`, `const [showArchived, setShowArchived] = useState(false)`, `const [busy, setBusy] = useState(false)`, `const [error, setError] = useState<string|null>(null)`.
- `type NodeWithCount = { id: string; name: string; sortOrder: number; isArchived: boolean; entryCount: number; children: NodeWithCount[] }`.
- `load()`: `const r = await fetch(\`/api/finance/categories?kind=${kind}\`); const j = await r.json(); setData(j[kind] ?? [])`. Chamar em `useEffect([kind])` e ao fim de cada ação.
- `create(name, parentId)`: `POST /api/finance/categories` `{ kind, name, parent_id: parentId }`; em erro `res.status===400` mostrar mensagem por `code` (mapa: `duplicate_sibling` → "Já existe uma categoria com esse nome aqui.", `empty_name` → "Dê um nome à categoria.", `parent_not_root` → "Não dá para criar um 3º nível.", fallback → "Não foi possível criar.").
- `rename(id, name)`: `PATCH /api/finance/categories/${id}` `{ name }`.
- `move(id, parentId)`: `PATCH` `{ parent_id: parentId }`.
- `archive(id, value)`: `PATCH` `{ is_archived: value }` (a rota cascateia para os filhos quando é raiz).
- `reorder(id, dir)`: troca `sort_order` com o irmão vizinho — implementar como dois `PATCH` `{ sort_order }` (o do nó e o do vizinho). Ordenar `data` por `sortOrder` na renderização.
- `remove(id)`: `DELETE /api/finance/categories/${id}`; em `409` mostrar "Categoria em uso ({entries} lançamentos, {children} subcategorias). Arquive em vez de excluir." e não remover.
- Arquivar raiz com filhos: `window.confirm(\`Arquivar "${name}" também esconde ${childCount} subcategoria(s). Continuar?\`)` antes do `PATCH`.
- Inputs de nome: usar um `Dialog` simples com um `Input` (padrão de `RevenueClient`), ou `prompt()` como MVP aceitável — preferir `Dialog` para casar com o resto da tela.
- Layout: lista `divide-y`, cada raiz um bloco com header (nome + `({entryCount})` + botões) e, quando expandida, as filhas indentadas. Arquivadas só aparecem se `showArchived`, com `opacity-50` e botão "Reativar".

- [ ] **Step 2: Verificar tipos + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS para este arquivo (ainda pode falhar `FinanceClient.tsx` — Task 15).

- [ ] **Step 3: Commit**

```bash
git add components/finance/FinanceCategoryManager.tsx
git commit -m "feat(finance): FinanceCategoryManager (CRUD da árvore na tela)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 15: `FinanceClient.tsx` reestruturado + `FinanceSummaryCards` + `FinanceCategoryChart`

**Files:**
- Modify: `components/finance/FinanceClient.tsx`
- Modify: `components/finance/FinanceSummaryCards.tsx`
- Modify: `components/finance/FinanceCategoryChart.tsx`

**Interfaces:**
- Consumes: `FinanceEntryForm` (Task 13), `FinanceEntryTable` (Task 13), `FinanceCategoryManager` (Task 14), `resolveCategoryPair`/`FinanceCategoryTree` (Task 4); `components/ui/tabs`; `useRouter` (`next/navigation`).
- Produces: a tela com segmented control PF/PJ (via `Tabs` externo, como hoje) + `Tabs` interno `Visão geral | Lançamentos | Categorias`.

- [ ] **Step 1: Reescrever `FinanceClient.tsx`**

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { FinanceMonthPicker } from './FinanceMonthPicker'
import { FinanceSummaryCards } from './FinanceSummaryCards'
import { FinanceCategoryChart } from './FinanceCategoryChart'
import { FinanceEntryTable } from './FinanceEntryTable'
import { FinanceEntryForm } from './FinanceEntryForm'
import { FinanceCategoryManager } from './FinanceCategoryManager'
import type { FinanceEntry, FinanceEntryType } from '@/lib/finance/types'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function FinanceClient({
  initialEntries, categoryTree, workspaces,
}: {
  initialEntries: FinanceEntry[]
  categoryTree: FinanceCategoryTree
  workspaces: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [kind, setKind] = useState<FinanceEntryType>('pf')
  const [view, setView] = useState<'overview' | 'entries' | 'categories'>('overview')
  const [month, setMonth] = useState(currentMonth())
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<FinanceEntry | null>(null)

  const unitNames = useMemo(
    () => Object.fromEntries(workspaces.map((w) => [w.id, w.name])),
    [workspaces]
  )

  const filtered = useMemo(
    () => initialEntries.filter((e) => e.type === kind && e.entry_date.startsWith(month)),
    [initialEntries, kind, month]
  )
  const total = filtered.reduce((s, e) => s + e.amount, 0)

  const roots = kind === 'pf' ? categoryTree.pf : categoryTree.pj
  const catName = (e: FinanceEntry) =>
    roots.find((c) => c.id === e.category_id)?.name ?? (e.category_id ? '—' : 'Sem categoria')

  const byCategory = useMemo(() => {
    const totals = new Map<string, number>()
    for (const e of filtered) {
      const key = catName(e)
      totals.set(key, (totals.get(key) ?? 0) + e.amount)
    }
    return Array.from(totals.entries())
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total)
  }, [filtered, roots])

  const topCategory = byCategory[0] ? { name: byCategory[0].category, value: byCategory[0].total } : null
  const uncategorized = filtered.filter((e) => !e.category_id).length

  const refresh = () => router.refresh()
  const openNew = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (e: FinanceEntry) => { setEditing(e); setFormOpen(true) }
  const del = async (e: FinanceEntry) => {
    if (!window.confirm('Excluir este lançamento?')) return
    const res = await fetch(`/api/finance/entries/${e.id}`, { method: 'DELETE' })
    if (res.ok) refresh()
    else window.alert('Não foi possível excluir.')
  }

  return (
    <>
      <Tabs value={kind} onValueChange={(v) => setKind(v as FinanceEntryType)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="pf">Pessoal (PF)</TabsTrigger>
            <TabsTrigger value="pj">Clínica (PJ)</TabsTrigger>
          </TabsList>
          <FinanceMonthPicker month={month} onChange={setMonth} />
        </div>
      </Tabs>

      <Tabs value={view} onValueChange={(v) => setView(v as typeof view)} className="mt-4">
        <TabsList>
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="entries">Lançamentos</TabsTrigger>
          <TabsTrigger value="categories">Categorias</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <FinanceSummaryCards total={total} topCategory={topCategory} />
          {uncategorized > 0 && (
            <button
              onClick={() => setView('entries')}
              className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-700"
            >
              {uncategorized} lançamento(s) sem categoria neste período — clique para revisar.
            </button>
          )}
          <FinanceCategoryChart data={byCategory} />
        </TabsContent>

        <TabsContent value="entries" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={openNew}><Plus className="mr-1 h-4 w-4" /> Novo lançamento</Button>
          </div>
          <FinanceEntryTable
            entries={filtered}
            tree={categoryTree}
            kind={kind}
            unitNames={unitNames}
            onEdit={openEdit}
            onDelete={del}
          />
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          <FinanceCategoryManager kind={kind} />
        </TabsContent>
      </Tabs>

      <FinanceEntryForm
        open={formOpen}
        onOpenChange={setFormOpen}
        kind={kind}
        tree={categoryTree}
        workspaces={workspaces}
        entry={editing}
        onSaved={refresh}
      />
    </>
  )
}
```

- [ ] **Step 2: `FinanceSummaryCards.tsx` — "Maior gasto" aceita subcategoria no label**

Trocar a prop `topCategory` para `{ name: string; value: number } | null` (já é) e, no `FinanceClient`, quando o top for uma subcategoria, passar `name` como `"Categoria — Subcategoria"`. Nesta task basta garantir que o componente renderiza `topCategory.name` como está (já faz) — nenhuma mudança de código obrigatória além de um comentário. Pular edição se não houver o que mudar.

- [ ] **Step 3: `FinanceCategoryChart.tsx` — sem mudança obrigatória no bloco A**

O gráfico já recebe `{ category, total }[]`. Drill-down por subcategoria fica anotado como melhoria futura (comentário `// TODO(bloco A+): drill-down categoria -> subcategoria`). Não implementar agora para não inflar a task.

- [ ] **Step 4: Verificar build completo + lint**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Verificação manual no preview**

Abrir `/finance`:
- Alternar PF/PJ e as abas Visão geral / Lançamentos / Categorias.
- Criar um lançamento PF com categoria + subcategoria; conferir que aparece na tabela e no total após o refresh.
- Editar o valor; excluir.
- Na aba Categorias: criar categoria, criar subcategoria, renomear, arquivar (com confirmação de cascata), reativar, mover subcategoria, tentar excluir uma em uso (espera aviso 409).
- PJ com >1 unidade: o form mostra o select de unidade; criar lançamento e ver a coluna Unidade.

- [ ] **Step 6: Commit**

```bash
git add components/finance/FinanceClient.tsx components/finance/FinanceSummaryCards.tsx components/finance/FinanceCategoryChart.tsx
git commit -m "feat(finance): tela /finance reestruturada (abas Visão geral/Lançamentos/Categorias)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 16: Agente — `categorize.ts` + `interpret.ts` cientes da árvore

**Files:**
- Modify: `lib/finance/categorize.ts`, `lib/finance/interpret.ts`
- Test: `tests/finance/categorize-prompt.test.ts`

**Interfaces:**
- Consumes: `FinanceCategoryTree`, `CategoryNode` (Task 4); `FinanceIntent` com `subcategory` (Task 7).
- Produces:
  - `categorizeEntry(description: string, type: FinanceEntryType, tree: FinanceCategoryTree): Promise<{ categoryName: string | null; subcategoryName: string | null }>`
  - `buildCategorizePrompt(type, tree): string` (export nomeado, para teste puro)
  - `interpretMessage(messageText: string, today: string, tree: FinanceCategoryTree): Promise<FinanceIntent>`
  - `PF_CATEGORIES` / `PJ_CATEGORIES` **removidos**.

- [ ] **Step 1: Escrever o teste que falha (`buildCategorizePrompt`)**

```ts
// tests/finance/categorize-prompt.test.ts
import { describe, it, expect } from 'vitest'
import { buildCategorizePrompt } from '@/lib/finance/categorize'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

const TREE: FinanceCategoryTree = {
  pf: [
    { id: 'fil', name: 'Filhos', sortOrder: 0, isArchived: false, children: [
      { id: 'esc', name: 'Escola', sortOrder: 0, isArchived: false, children: [] },
    ] },
    { id: 'arq', name: 'Arquivada', sortOrder: 1, isArchived: true, children: [] },
    { id: 'out', name: 'Outros', sortOrder: 2, isArchived: false, children: [] },
  ],
  pj: [{ id: 'alu', name: 'Aluguel', sortOrder: 0, isArchived: false, children: [] }],
}

describe('buildCategorizePrompt', () => {
  it('lista Categoria > Subcategoria e raízes sozinhas, sem arquivadas', () => {
    const p = buildCategorizePrompt('pf', TREE)
    expect(p).toContain('Filhos > Escola')
    expect(p).toContain('Filhos')
    expect(p).toContain('Outros')
    expect(p).not.toContain('Arquivada')
  })
  it('usa o kind certo', () => {
    expect(buildCategorizePrompt('pj', TREE)).toContain('Aluguel')
    expect(buildCategorizePrompt('pj', TREE)).not.toContain('Filhos')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/finance/categorize-prompt.test.ts`
Expected: FAIL — `buildCategorizePrompt` não existe.

- [ ] **Step 3: Reescrever `lib/finance/categorize.ts`**

```ts
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
```

- [ ] **Step 4: Editar `lib/finance/interpret.ts`**

- Remover `import { PF_CATEGORIES, PJ_CATEGORIES } from './categorize'`; adicionar `import type { FinanceCategoryTree } from './categories'`.
- `INTENT_TOOL.input_schema.properties`: adicionar
  ```ts
  subcategoria: {
    type: ['string', 'null'],
    description:
      'Em lancamento/consulta: a subcategoria EXATA da árvore, quando fizer sentido (ex: "Escola" dentro de "Filhos"). null se não houver.',
  },
  ```
  e `'subcategoria'` ao array `required` (o schema é `strict: true`).
- `IntentToolInput`: adicionar `subcategoria: string | null`.
- `buildSystem(today)` → `buildSystem(today: string, tree: FinanceCategoryTree)`:
  ```ts
  const fmt = (nodes: FinanceCategoryTree['pf']) =>
    nodes
      .filter((c) => !c.isArchived)
      .map((c) => {
        const subs = c.children.filter((s) => !s.isArchived).map((s) => s.name)
        return subs.length ? `${c.name} (${subs.join(', ')})` : c.name
      })
      .join('; ')
  // ...
  `Categorias válidas em pf: ${fmt(tree.pf)}`
  `Categorias válidas em pj: ${fmt(tree.pj)}`
  ```
- `interpretMessage(messageText, today)` → `interpretMessage(messageText, today, tree)`, passando `tree` a `buildSystem`.
- `toIntent`: remover a função `validCategory` e seu uso. Na variante `lancamento`:
  ```ts
  category: input.categoria?.trim() || null,
  subcategory: input.subcategoria?.trim() || null,
  ```
  Na variante `consulta`:
  ```ts
  category: input.categoria?.trim() || null,
  subcategory: input.subcategoria?.trim() || null,
  ```
  (o agente resolve nome→id e valida).

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/finance/categorize-prompt.test.ts`
Expected: PASS. `npx tsc --noEmit` ainda acusa `agent.ts` (Task 17).

- [ ] **Step 6: Commit**

```bash
git add lib/finance/categorize.ts lib/finance/interpret.ts tests/finance/categorize-prompt.test.ts
git commit -m "feat(finance): categorize.ts e interpret.ts leem a árvore da conta

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 17: Agente — `agent.ts` + `respond.ts` (resolver ids, gravar, filtrar por id)

**Files:**
- Modify: `lib/finance/agent.ts`, `lib/finance/respond.ts`
- Test: `tests/finance/agent-category.test.ts`

**Interfaces:**
- Consumes: `ensureFinanceCategories` (Task 3); `getFinanceCategoryTree`, `resolveCategoryPair` (Task 4); `categorizeEntry` (Task 16); `interpretMessage` (Task 16).
- Produces: agente que grava `category_id`/`subcategory_id` em `finance_entries` e filtra consultas por `category_id`. `QueryFilters` (respond.ts) ganha `categoryId: string | null` e `subcategoryId: string | null`.

- [ ] **Step 1: Escrever o teste que falha (agent harness)**

```ts
// tests/finance/agent-category.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mergeSupabaseConfig, resetAgentHarness, state, PARAMS } from '../helpers/agent-harness'

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => state.supabase.client,
  createClient: async () => state.supabase.client,
}))
vi.mock('@/lib/whatsapp/send', () => ({ sendWhatsAppMessage: (...a: unknown[]) => Promise.resolve({ ok: true }) }))

const CAT_ROWS = [
  { id: 'fil', account_id: PARAMS.accountId, kind: 'pf', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: false, created_at: '' },
  { id: 'esc', account_id: PARAMS.accountId, kind: 'pf', parent_id: 'fil', name: 'Escola', sort_order: 0, is_archived: false, created_at: '' },
]

beforeEach(() => {
  resetAgentHarness()
  mergeSupabaseConfig({
    memberships: { select: { data: [{ account_id: PARAMS.accountId, user_id: 'u1' }] } },
    profiles: { select: { data: [{ id: 'u1', phone: PARAMS.patientPhone }] } },
    accounts: { select: { data: { modules: ['finance'] } } },
    finance_categories: { select: { data: CAT_ROWS } },
    finance_sessions: { select: { data: null } },
    finance_entries: { select: { data: [] }, insert: { data: { id: 'e1', amount: 200, type: 'pf', category: 'Filhos' } } },
  })
})

it('grava category_id e subcategory_id resolvidos da árvore', async () => {
  // interpretMessage devolve nomes; o agente resolve pela árvore.
  state.claudeResponses = [
    { content: [{ type: 'tool_use', name: 'registrar_intencao', input: {
      intencao: 'lancamento', tipo: 'pf', descricao: 'Escola do João', valor: 200,
      categoria: 'Filhos', subcategoria: 'Escola', mes: null, unidade: null,
      paciente: null, horario: null, forma_pagamento: null,
    } }], stop_reason: 'tool_use' },
    'ok',
  ]
  const { processFinancialMessage } = await import('@/lib/finance/agent')
  await processFinancialMessage(PARAMS.patientPhone, 'gastei 200 na escola do joão')

  const ins = state.supabase.callsTo('finance_entries', 'insert')[0]
  const p = ins.payload as Record<string, unknown>
  expect(p.category_id).toBe('fil')
  expect(p.subcategory_id).toBe('esc')
  expect(p.category).toBe('Filhos') // snapshot do nome
})
```

> Ajuste conforme o harness real: pode ser preciso mockar `@/lib/finance/interpret` e `@/lib/finance/categorize` em vez de dirigir via `state.claudeResponses`, se o agente instanciar o Anthropic client diretamente (ver como `tests/agent/*` fazem). O contrato a verificar é o mesmo: `insert` recebe `category_id: 'fil'`, `subcategory_id: 'esc'`, `category: 'Filhos'`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/finance/agent-category.test.ts`
Expected: FAIL.

- [ ] **Step 3: Editar `lib/finance/respond.ts`**

`QueryFilters`:
```ts
export interface QueryFilters {
  type: FinanceEntryType | null
  category: string | null          // nome, para o texto da resposta
  categoryId: string | null        // filtro real
  subcategoryId: string | null
  month: string | null
  workspaceId: string | null
  unitLabel: string | null
}
```
`describeScope`/`monthLabel`/`groupByCategory` continuam usando `filters.category` (nome) — sem mudança nessas funções.

- [ ] **Step 4: Editar `lib/finance/agent.ts`**

- Imports: `import { ensureFinanceCategories } from './provision'`, `import { getFinanceCategoryTree, resolveCategoryPair, type FinanceCategoryTree } from './categories'`.
- Após obter `accountId` e confirmar o módulo `finance` (perto da L179), antes do passo 2.5:
  ```ts
  await ensureFinanceCategories(supabase, accountId)
  const categoryTree = await getFinanceCategoryTree(supabase, accountId)
  ```
- L194: `interpretMessage(messageText, today)` → `interpretMessage(messageText, today, categoryTree)`.
- Bloco `intent.kind === 'query'` (L244-265): resolver nome→id antes de montar os filtros:
  ```ts
  const pair = resolveCategoryPair(categoryTree, intent.type, intent.category, intent.subcategory)
  // ...
  const entries = await getEntries(accountId, {
    type: intent.type,
    category: pair.categoryName,
    categoryId: pair.categoryId,
    subcategoryId: pair.subcategoryId,
    month: intent.month,
    workspaceId: unit?.id ?? null,
    unitLabel: unit?.name ?? null,
  })
  // buildQueryMessage recebe o mesmo objeto de filtros
  ```
- Passo 4 (L268-272), categorização:
  ```ts
  let pair = resolveCategoryPair(categoryTree, intent.type, intent.category, intent.subcategory)
  if (!pair.categoryId && intent.description) {
    const guess = await categorizeEntry(intent.description, intent.type, categoryTree)
    pair = resolveCategoryPair(categoryTree, intent.type, guess.categoryName, guess.subcategoryName)
  }
  ```
- Passo 4.5 (escolha de unidade PJ): no `pending.entry`, trocar `category` por os três: `category: pair.categoryName`, `category_id: pair.categoryId`, `subcategory_id: pair.subcategoryId`. Ajustar a interface `PendingChooseWorkspace.entry` para incluir `category_id: string | null` e `subcategory_id: string | null`.
- Passo 5 `persistEntryAndConfirm`: a assinatura `args` ganha `categoryId: string | null` e `subcategoryId: string | null`; o `insert` passa a gravar:
  ```ts
  category: args.categoryName,        // renomear o campo atual `category` para `categoryName` no args
  category_id: args.categoryId,
  subcategory_id: args.subcategoryId,
  ```
  (manter `category` na coluna = `args.categoryName` como snapshot).
- `handlePendingChooseWorkspace`: ao chamar `persistEntryAndConfirm`, passar `categoryId: pending.entry.category_id`, `subcategoryId: pending.entry.subcategory_id`, `categoryName: pending.entry.category`.
- `getEntries(accountId, filters)`: trocar `if (filters.category) query = query.eq('category', filters.category)` por:
  ```ts
  if (filters.categoryId) query = query.eq('category_id', filters.categoryId)
  if (filters.subcategoryId) query = query.eq('subcategory_id', filters.subcategoryId)
  ```
- `handleUndo` / `buildUndoMessage`: sem mudança (usam `entry.description`/`amount`/`type`).

- [ ] **Step 5: Rodar e ver passar + suíte de finance/agent**

Run: `npx vitest run tests/finance/ tests/agent/`
Expected: PASS. Ajustar mocks do teste novo até refletir o fluxo real (ver nota no Step 1).

- [ ] **Step 6: Verificar tipos + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/finance/agent.ts lib/finance/respond.ts tests/finance/agent-category.test.ts
git commit -m "feat(finance): agente grava category_id/subcategory_id e filtra por id

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 18: Fechamento — suíte completa, espelho do schema, checklist manual

**Files:**
- Verify: `supabase/schema.sql` vs `supabase/migration_finance_categories.sql`
- Verify: repo inteiro

- [ ] **Step 1: Conferir espelho schema ↔ migração**

Ler os dois arquivos lado a lado e confirmar que `schema.sql` contém, com o mesmo texto: `create table public.finance_categories` (+ colunas em `finance_entries`), os 3 índices, `normalize_category_name`, `enforce_finance_category_depth` (+ trigger), `enforce_finance_entry_category` (+ trigger), `provision_finance_categories`, o `enable row level security`, a policy `"finance_categories: owner only"`, e as entradas nas listas `drop table` / `drop function`. Corrigir divergências.

- [ ] **Step 2: Suíte completa**

Run: `npm run test`
Expected: PASS (todos os arquivos, não só `tests/finance/`).

- [ ] **Step 3: Lint + tipos + build**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Grep de resíduo**

Run: `grep -rn "PF_CATEGORIES\|PJ_CATEGORIES\|validCategory" lib/ app/ tests/`
Expected: sem resultados (todas as referências removidas).

- [ ] **Step 5: Checklist manual (documentar o resultado no PR)**

Aplicar `supabase/migration_finance_categories.sql` no SQL Editor do Supabase (staging). Depois, logado como owner:

1. Abrir `/finance` numa conta com lançamentos antigos → conferir no banco que `finance_categories` foi populada (curada + derivadas do histórico) e `finance_entries.category_id` backfillado onde o nome batia; a tela mostra a faixa "sem categoria" para os que não bateram.
2. Aba Categorias: criar categoria, criar subcategoria, renomear, reordenar (↑/↓), mover subcategoria, arquivar raiz com filhos (confirmar cascata), "Mostrar arquivadas" + Reativar, tentar excluir uma em uso (→ aviso 409), excluir uma vazia (→ ok).
3. Aba Lançamentos: criar PF com categoria+subcategoria, editar valor/data/descrição, reclassificar categoria, excluir. Criar PJ com e sem unidade (conta com >1 unidade).
4. Visão geral: total e "Maior gasto" corretos; gráfico por categoria; faixa "sem categoria" leva para a aba Lançamentos.
5. WhatsApp: "gastei 200 na escola do joão" → `finance_entries` com `category_id` (Filhos) e `subcategory_id` (Escola) e `category='Filhos'`; `/pj Aluguel 3500` → PJ categorizado; "quanto gastei em filhos esse mês?" → filtra por `category_id`; `/resumo pf` responde.
6. Conta nova (sem histórico): `/finance` cria só a árvore curada; nada quebra.

- [ ] **Step 6: Commit final (se houve ajuste de espelho)**

```bash
git add -A
git commit -m "chore(finance): espelha schema.sql e ajustes finais do bloco A

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review (feita pelo autor do plano)

**1. Cobertura da spec**

| Item da spec | Task |
|---|---|
| §2.1 tabela `finance_categories` + índices + RLS + grants + trigger de profundidade | 1 |
| §2.2 colunas `category_id`/`subcategory_id` + índice + trigger de coerência | 1 |
| §2.3 migração aditiva + espelho em `schema.sql` + `types/database.ts` | 1, 3, 18 |
| §3.1 árvore curada | 2 |
| §3.2 `ensureFinanceCategories` lazy/idempotente + advisory lock + chamada na tela e no agente | 3 (função), 11 (tela), 17 (agente) |
| §3.2 derivação do histórico + backfill | 3 (dentro de `provision_finance_categories`) |
| §4.1 Visão geral (cards, faixa "sem categoria", gráfico) | 15 |
| §4.2 aba Lançamentos + form CRUD | 13, 15 |
| §4.3 aba Categorias (gerenciador, kind ativo) | 14, 15 |
| §4.4 componentes | 12–15 |
| §5.1 `GET`/`POST` categories | 8 |
| §5.2 `PATCH`/`DELETE` categories (cascata, 409) | 9 |
| §5.3 `POST` entries (`recorded_by_phone='web'`, `raw_message`) | 10 |
| §5.4 `PATCH`/`DELETE` entries | 10 |
| §6.1 `lib/finance/categories.ts` | 4 |
| §6.2 `default-categories.ts` dona das listas; constantes removidas | 2, 16 |
| §6.3 `categorizeEntry(desc, type, tree)` | 16 |
| §6.4 `interpret.ts` campo `subcategoria`, `buildSystem(today, tree)`, sem `validCategory` | 16 |
| §6.5 `agent.ts` ensure+tree, resolve par, grava ids, `getEntries` por id, `QueryFilters` | 17 |
| §7 testes (`default-categories`, `provision`, `resolve-category-pair`, `categorize-prompt`, agente) | 2, 3, 4, 16, 17 |
| §7 checklist manual | 18 |
| §8 `category` texto permanece; espelho; migração não roda sozinha | 1, 10 (grava `category` snapshot), 18 |

Sem lacunas. `category-validation` e `entry-validation` (Tasks 5-6) são detalhamento das rotas §5, não estavam nomeados na spec mas servem os requisitos dela.

**2. Placeholders:** nenhum "TBD/TODO" acionável pendente. As duas notas "melhoria futura" (drill-down do gráfico na Task 15 Step 3; `validateEntryPatch` dedicado na Task 10) são explicitamente fora do escopo do bloco A e não bloqueiam nenhum requisito da spec.

**3. Consistência de tipos:**
- `FinanceCategoryTree` / `CategoryNode` — definidos na Task 4, consumidos com a mesma forma nas Tasks 5, 6, 8–17.
- `resolveCategoryPair(tree, type, categoryName, subcategoryName)` — assinatura idêntica na Task 4 e nas chamadas da Task 17.
- `categorizeEntry(description, type, tree)` retornando `{ categoryName, subcategoryName }` — Task 16 define, Task 17 consome com esses nomes.
- `ensureFinanceCategories(client, accountId)` — Task 3 define, Tasks 8, 10, 11, 17 chamam com 2 args.
- `QueryFilters` ganha `categoryId`/`subcategoryId` na Task 17; `getEntries` e `buildQueryMessage` no mesmo commit — sem consumidor externo do shape.
- `FinanceEntry.category_id/subcategory_id` — Task 7 adiciona ao tipo e ao `types/database.ts` (Task 1); Tasks 13/15/17 usam.
- Nota: a Task 17 renomeia o campo `category` do objeto `args` de `persistEntryAndConfirm` para `categoryName` — está explicitado no Step 4 para evitar colisão com a coluna `category`.

---

## Execution Handoff

Plano salvo em `docs/superpowers/plans/2026-09-01-financeiro-categorias-subcategorias.md`. Duas opções de execução:

**1. Subagent-Driven (recomendada)** — um subagente novo por task, revisão entre tasks, iteração rápida.

**2. Inline Execution** — executar as tasks nesta sessão via `superpowers:executing-plans`, em lotes com checkpoints.

Qual abordagem?
