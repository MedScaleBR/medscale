# Receita no financeiro — espelho do ciclo + lançamento manual de receita

Data: 2026-09-04
Status: design aprovado (aguardando revisão do spec)

## Problema

Hoje `finance_entries` é um registro de **gastos**: todo `amount > 0`, sem
sinal, árvore de categorias PF/PJ só de despesa, e o total da tela `/finance`
soma tudo como saída. O ciclo de receita (`revenue_entries`, tela
`/ciclo-receita`) vive em paralelo e não alimenta o financeiro.

Objetivo:

1. Todo pagamento de consulta confirmado no ciclo de receita (`payment_status
   = 'paid'`) aparece automaticamente como um lançamento de **entrada** PJ no
   `/finance`, na unidade certa, sem digitação.
2. O `/finance` passa a distinguir receita de despesa nas duas abas (PF e PJ),
   mostrando Receitas / Despesas / Saldo.
3. O owner pode lançar receita manualmente — pela tela e pelo agente do
   WhatsApp — nas duas abas, com árvore de categorias de receita própria.

## Decisões

| # | Tema | Decisão |
|---|------|---------|
| 1 | Gatilho do espelho | Só quando `revenue_entries.payment_status` vira `'paid'` |
| 2 | Modelo de receita/despesa | `finance_entries.direction` (`'in'`/`'out'`); tela mostra Receitas / Despesas / Saldo nas duas abas |
| 3 | Estorno / exclusão | Reversão automática: sai de `'paid'` → espelho apagado; `revenue_entry` deletada → espelho apagado (FK cascade) |
| 4 | Retroativo | Não. Só pagamentos confirmados após o deploy geram espelho |
| 5 | Edição do espelho | Read-only na tela e na API. Categoria de receita fixa atribuída pelo helper de espelho |
| 6 | Ponto único do espelho | Helper TS `lib/revenue/finance-mirror.ts`, chamado nos 3 sites que marcam `paid`. **Revisado** (era trigger Postgres): o repo não tem harness de teste com banco real; o helper é 100% testável com `createSupabaseMock` e segue o padrão de `lib/revenue/cycle.ts` |
| 7 | Categorias de receita | Árvore separada por `direction`; seed provisionado por tipo (PF e PJ) |
| 8 | Lançamento manual de receita | Tela **e** agente WhatsApp |

## Modelo de dados

### `finance_entries` — 2 colunas novas

```sql
alter table public.finance_entries
  add column direction text not null default 'out'
    check (direction in ('in','out')),
  add column revenue_entry_id uuid unique
    references public.revenue_entries(id) on delete cascade;

create index idx_finance_entries_direction
  on public.finance_entries(account_id, type, direction, entry_date desc);
```

- `direction`: `'out'` = despesa (tudo que existe hoje; o default cobre o
  backfill sem `update`). `'in'` = receita.
- `revenue_entry_id`: vínculo com a origem no ciclo. `unique` → idempotência
  (re-confirmar não duplica). `on delete cascade` → apagar a `revenue_entry`
  apaga o espelho de graça. `null` para lançamento manual.

### `finance_categories` — coluna `direction`

```sql
alter table public.finance_categories
  add column direction text not null default 'out'
    check (direction in ('in','out'));
```

- Categorias existentes viram `direction = 'out'` (default).
- O índice único de irmãos passa a incluir `direction` — permite uma raiz
  "Outras" de receita e outra de despesa no mesmo tipo:

```sql
drop index if exists public.idx_finance_categories_unique_sibling;
create unique index idx_finance_categories_unique_sibling
  on public.finance_categories(
    account_id, kind, direction,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    public.normalize_category_name(name)
  );

create index idx_finance_categories_tree_dir
  on public.finance_categories(account_id, kind, direction, parent_id, sort_order);
```

### Triggers ajustados

**`enforce_finance_category_depth`** (categoria vs pai): além de `account_id`
e `kind`, o pai precisa ter o mesmo `direction` da filha.

**`enforce_finance_entry_category`** (lançamento vs categoria): além de
`kind = type`, exige `finance_categories.direction = finance_entries.direction`.
Nova mensagem: `finance_entries: direction da categoria difere do lançamento`.

### Helper do espelho — `lib/revenue/finance-mirror.ts`

Sem trigger. Um módulo TS com duas funções, chamadas com `createAdminClient()`
(mesma razão de `lib/revenue/cycle.ts`: `finance_entries` e `revenue_entries`
têm RLS owner-only e os writers já usam service role).

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { ensureFinanceCategories } from '@/lib/finance/provision'
import { getFinanceCategoryTree } from '@/lib/finance/categories'
import { saoPauloDateOnly } from '@/lib/revenue/cycle'

type SupabaseAdmin = SupabaseClient<Database>

/** Nome da categoria-raiz PJ (direction 'in') que o espelho usa. */
export const REVENUE_MIRROR_CATEGORY = 'Consultas particulares'

interface MirrorInput {
  id: string                 // revenue_entries.id
  accountId: string
  workspaceId: string
  amount: number
  procedureName: string | null
  paidAtIso: string | null   // revenue_entries.paid_at
}

/**
 * Cria (idempotente) o finance_entry de entrada que espelha um pagamento de
 * receita confirmado. No-op se já existe um espelho para essa revenue_entry.
 * Nunca lança: falha é logada e engolida — não pode derrubar a confirmação
 * do pagamento.
 */
export async function mirrorPaidRevenueToFinance(
  supabase: SupabaseAdmin,
  input: MirrorInput
): Promise<void>

/**
 * Remove o espelho de uma revenue_entry (reembolso / correção de status /
 * pré-exclusão). No-op se não havia espelho. Pronta para o dia em que existir
 * um fluxo de estorno; hoje a exclusão da revenue_entry já cascateia via FK.
 */
export async function unmirrorPaidRevenue(
  supabase: SupabaseAdmin,
  revenueEntryId: string
): Promise<void>
```

Comportamento de `mirrorPaidRevenueToFinance`:

1. `select id from finance_entries where revenue_entry_id = input.id` → se
   existe, retorna (idempotente; cobre reconfirmação e corrida).
2. `await ensureFinanceCategories(supabase, accountId)` — garante o seed de
   receita mesmo que o owner nunca tenha aberto `/finance`.
3. Lê a árvore, acha a raiz `kind='pj'`, `direction='in'`, nome
   normalizado == `REVENUE_MIRROR_CATEGORY`. Se não achar (seed degradado),
   segue com `category_id = null`.
4. `insert` em `finance_entries`:

| campo | valor |
|---|---|
| `account_id` / `workspace_id` | `input.accountId` / `input.workspaceId` |
| `type` / `direction` | `'pj'` / `'in'` |
| `amount` | `input.amount` |
| `entry_date` | `saoPauloDateOnly(input.paidAtIso ?? new Date().toISOString())` |
| `category` | `REVENUE_MIRROR_CATEGORY` (ou `null` se não resolveu) |
| `category_id` / `subcategory_id` | id da raiz resolvida / `null` |
| `description` | `input.procedureName ?? 'Consulta'` |
| `recorded_by_phone` | `'revenue-cycle'` |
| `raw_message` | `'(ciclo de receita)'` |
| `revenue_entry_id` | `input.id` |

5. Erro no insert → `console.error('[revenue-mirror] …')` e retorna. A coluna
   `revenue_entry_id UNIQUE` é o backstop final contra duplicata.

`unmirrorPaidRevenue`: `delete from finance_entries where revenue_entry_id = X`.

**Sites de chamada:**

| Arquivo | Onde | Chamada |
|---|---|---|
| `app/api/revenue-entries/[id]/confirm/route.ts` | depois do `update ... payment_status:'paid'` bem-sucedido | `mirrorPaidRevenueToFinance(supabase, { id, accountId, workspaceId, amount: data.amount, procedureName: data.procedure_name, paidAtIso: data.paid_at })` |
| `lib/finance/appointment-payment.ts` → `confirmAppointmentPayment` | depois do `update` que retornou linha | idem, com os campos da linha atualizada (o `update` passa a `.select('id, account_id, workspace_id, amount, procedure_name, paid_at')`) |
| `app/api/revenue/route.ts` POST | quando `paymentStatus === 'paid'`, depois do insert | idem, a partir de `data` |

Reversão automática hoje = só a FK `on delete cascade` (exclusão da
`revenue_entry` ou da conta). Não existe fluxo de `paid → refunded` no código
atual; quando existir, chama `unmirrorPaidRevenue` nele.

### Provisionamento de categorias de receita

O RPC `provision_finance_categories` tem guarda "se já existe qualquer
categoria da conta, retorna". Contas que já provisionaram despesa **não**
ganhariam o seed de receita. Solução: função idempotente dedicada
`ensure_finance_income_seed`, chamada por `ensureFinanceCategories` (que roda
no carregamento de `/finance`, no agente, e é invocada pelo
`mirrorPaidRevenueToFinance` antes de ler a árvore), mais um `select` único
por conta na migration.

```sql
create or replace function public.ensure_finance_income_seed(p_account_id uuid)
returns void language plpgsql as $$
declare v_kind text; v_name text; v_order int;
begin
  perform pg_advisory_xact_lock(hashtext('income-seed:' || p_account_id::text));
  if exists (select 1 from public.finance_categories
             where account_id = p_account_id and direction = 'in') then
    return;
  end if;
  -- PJ
  v_order := 0;
  foreach v_name in array array[
    'Consultas particulares','Procedimentos','Convênios','Outras receitas'
  ] loop
    insert into public.finance_categories
      (account_id, kind, direction, parent_id, name, sort_order)
    values (p_account_id, 'pj', 'in', null, v_name, v_order);
    v_order := v_order + 1;
  end loop;
  -- PF
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
```

Seed inicial (raízes, sem subcategorias — o owner cria depois pela tela):

| Tipo | Categorias de receita |
|------|-----------------------|
| PJ | Consultas particulares · Procedimentos · Convênios · Outras receitas |
| PF | Salário / Pró-labore · Aluguéis recebidos · Investimentos · Outras receitas |

O espelho do ciclo aponta sempre para **PJ › Consultas particulares**.

### Migration (incremental, `supabase/migration_receita_financeiro.sql`)

Ordem, para rodar no SQL Editor (não reexecutar `schema.sql`):

1. `alter table finance_categories add column direction ...` (default `'out'`).
2. `alter table finance_entries add column direction ...` (default `'out'`)
   `, add column revenue_entry_id uuid unique references revenue_entries(id)
   on delete cascade`.
3. Recriar índice único de irmãos com `direction`; criar
   `idx_finance_categories_tree_dir` e `idx_finance_entries_direction`.
4. `create or replace` das duas funções de trigger de categoria
   (`enforce_finance_category_depth`, `enforce_finance_entry_category`) com a
   checagem de `direction`.
5. `create function ensure_finance_income_seed`.
6. `select ensure_finance_income_seed(id) from accounts` — semeia receita em
   todas as contas existentes (uma vez).
7. Espelhar `schema.sql` (fonte de verdade para reconstrução) com as mesmas
   mudanças.

Sem trigger de espelho (o espelho é o helper TS). Sem backfill de
`revenue_entries` já pagas (decisão 4).

## Camada `lib/`

### `types/database.ts`

`finance_entries` Row/Insert/Update: `direction: 'in' | 'out'`,
`revenue_entry_id: string | null`. `finance_categories`: `direction`.

### `lib/finance/types.ts`

`FinanceEntry` ganha `direction` e `revenue_entry_id`.
`FinanceIntent`:
- `kind: 'entry'` ganha `direction: 'in' | 'out'`.
- `kind: 'query'` ganha `direction: 'in' | 'out' | null` (null = ambos).

### `lib/finance/categories.ts`

`FinanceCategoryTree` **mantém a forma** `{ pf: CategoryNode[]; pj:
CategoryNode[] }` — restruturá-la para `{in,out}` explodiria em ~10 arquivos e
~8 testes. Em vez disso, o `direction` vai **no nó**:

```ts
interface CategoryNode {
  id: string
  name: string
  direction: 'in' | 'out'   // novo
  sortOrder: number
  isArchived: boolean
  children: CategoryNode[]
}
```

- `getFinanceCategoryTree`: adiciona `direction` ao `select`.
- `buildTree`: agrupa por `kind` como hoje; cada nó carrega `r.direction`.
  Uma subcategoria herda o `direction` do pai (o banco garante coerência).
- `rootCategoryName(tree, id)`: inalterado (busca por id).
- `resolveCategoryPair(tree, type, categoryName, subcategoryName, direction)`:
  novo 5º parâmetro `direction: 'in' | 'out'` (default `'out'`); filtra
  `tree[kind].filter(c => c.direction === direction)` antes de casar o nome.

Consumidores que só precisam de "todas as categorias do tipo" seguem
inalterados; quem filtra por direção usa `.filter(c => c.direction === dir)`.

### `lib/finance/default-categories.ts`

`DefaultCategoryTree` continua só com as categorias de **despesa**. O seed de
receita vive na função SQL `ensure_finance_income_seed` (chamada via RPC por
`ensureFinanceCategories`), então o helper de espelho o garante indiretamente
via `ensureFinanceCategories`. Documentar o espelhamento dos nomes PF/PJ de
receita num comentário neste arquivo, para quem for editar o seed SQL achar.

### `lib/finance/entry-validation.ts`

`EntryInput` ganha `direction: 'in' | 'out'`. `findRoot` passa a rejeitar (ou
o chamador filtra) nós cujo `node.direction !== input.direction`. Novo código
`category_direction_mismatch` em `EntryValidationError`. `validateEntryInput`:
se `categoryId` resolve para um nó de direção diferente de `input.direction`,
retorna `{ code: 'category_direction_mismatch' }` (checado antes de
`category_kind_mismatch`).

### `lib/finance/provision.ts`

`ensureFinanceCategories` passa a chamar também
`rpc('ensure_finance_income_seed', ...)` depois do provision principal
(mesma degradação graciosa se a função ainda não existe no banco).

### `lib/revenue/cycle.ts`

Nenhuma mudança de lógica. `saoPauloDateOnly` (já exportado) é reusado por
`finance-mirror.ts`. Um comentário próximo às transições de `payment_status`
aponta para `lib/revenue/finance-mirror.ts`.

## Rotas API

### `POST /api/finance/entries`

- Body aceita `direction` (`'in'`/`'out'`, default `'out'` se ausente — mantém
  compat).
- `validateEntryInput` recebe `direction`.
- `rootCategoryName` resolve no sub-array certo.
- Sem mudança de permissão (owner, módulo `finance`).

### `PATCH /api/finance/entries/[id]` e `DELETE /api/finance/entries/[id]`

- Antes de alterar/excluir: `select revenue_entry_id`. Se não-nulo → `409`
  `{ error: 'Lançamento gerido pelo ciclo de receita', code: 'revenue_mirror_locked' }`.
- PATCH: se o body muda `direction`, revalidar categoria contra a nova direção.

## Tela `/finance`

### `app/(dashboard)/finance/page.tsx`

`getFinanceCategoryTree` já traz os nós com `direction`. Passa `workspaces`
como hoje. Sem outra mudança (a query de `finance_entries` já é `select *`,
então `direction`/`revenue_entry_id` vêm juntos).

### `FinanceClient.tsx`

- `filtered` divide em `receitas` (`direction === 'in'`) e `despesas`
  (`direction === 'out'`), para **as duas abas**.
- `byCategory`/`FinanceCategoryChart`: segmento "Despesas | Receitas" acima do
  gráfico (estado local, default Despesas), agrupando o lado escolhido.
- `roots` para o formulário e o gráfico saem de
  `categoryTree[kind].filter(c => c.direction === direction)`.
- `uncategorized` conta só o lado visível.

### `FinanceSummaryCards.tsx`

Novas props `receitas`, `despesas` (o `topCategory` continua). Três cards,
iguais para PF e PJ:
- **Receitas do mês** (verde) · **Despesas do mês** · **Saldo** (Σin − Σout,
  verde se ≥ 0, vermelho se < 0).
- O card de Despesas mostra a maior categoria (`topCategory`) como texto
  auxiliar embaixo do valor. O card "Maior gasto" separado que existe hoje é
  removido.

### `FinanceEntryForm.tsx`

- Toggle **Receita / Despesa** no topo (default Despesa). Controla `direction`.
- `FinanceCategoryPicker` recebe `direction` e lista só os nós dessa direção.
- Ao trocar o toggle: zera `categoryId`/`subcategoryId`.
- `payload` inclui `direction`.
- Edição de espelho não acontece aqui (a tabela esconde a ação).

### `FinanceCategoryPicker.tsx`

Nova prop `direction`; `roots`/`subs` filtram `c.direction === direction`
além de `!c.isArchived`.

### `FinanceEntryTable.tsx`

- Badge de direção: "Receita" (verde) / "Despesa" (neutro). Valor de receita
  em verde com prefixo `+`; despesa mantém o estilo atual (sem prefixo).
- Linha com `revenue_entry_id != null`: sem menu de ações; coluna origem/
  descrição indica "Ciclo de receita".
- `names()` resolve categoria no sub-array de `direction`.

### `FinanceCategoryManager.tsx`

Gerencia categorias de receita também: segmento "Despesas | Receitas" (ou
reaproveita o toggle da aba). CRUD passa `direction` para
`POST /api/finance/categories`. Rotas de categoria (`route.ts`,
`[id]/route.ts`) aceitam e validam `direction` (default `'out'`); a validação
de profundidade/kind da árvore em `lib/finance/category-validation.ts` ganha
`direction`.

## Agente WhatsApp (`lib/finance/`)

### `parser.ts` (atalhos com barra)

Sintaxe atual: `/pf <valor> <descrição>`, `/pj ...`. Adicionar receita sem
quebrar o que existe:
- `/pf+ <valor> <descrição>` e `/pj+ <valor> <descrição>` → `direction: 'in'`.
- `/pf` e `/pj` sem `+` seguem `direction: 'out'`.
Documentar no help (`respond.ts` / `buildHelpMessage`).

### `interpret.ts` (linguagem natural via Claude)

- Prompt e schema da tool ganham `direction` (`'in'`/`'out'`) no intent
  `entry`, e `direction` opcional no `query`.
- Exemplos: "recebi 500 de aluguel" → `entry, direction:'in'`; "paguei 200 de
  luz" → `entry, direction:'out'`; "quanto recebi esse mês" → `query,
  direction:'in'`.

### `categorize.ts`

Categoriza contra os nós de `tree[type]` cuja `direction` bate com a do
intent — o passo de categorização só considera as raízes daquela direção.

### `respond.ts`

- `buildConfirmationMessage`: "Receita registrada" vs "Gasto registrado";
  total do mês da mesma direção.
- `buildHelpMessage`: documenta `/pf+` / `/pj+` e os exemplos de receita.
- Mensagens de consulta ("quanto recebi", "quanto gastei") pela `direction`.

### `agent.ts`

- `getEntries(accountId, filters)`: `filters` ganha `direction`; quando
  presente, `query.eq('direction', ...)`. Consulta de gasto e o total pós-
  lançamento passam `direction` conforme o intent.
- `handleUndo`: `select ... .is('revenue_entry_id', null)` — o "desfazer"
  nunca pega um espelho do ciclo.
- Inserção manual (`addEntry` / caminho de linguagem natural): grava
  `direction` do intent; `category`/`category_id` resolvidos no sub-array
  certo.
- `FinanceIntent.query` com `direction` propagado até `getEntries`.

### `prompts/`

Atualizar o(s) prompt(s) do agente financeiro e
`prompts/CICLO_RECEITA_COMO_FUNCIONA.md` (nota de que `paid` agora espelha em
`finance_entries`). `prompts/FINANCEIRO_*` — exemplos de receita.

## Tratamento de erro

| Situação | Comportamento |
|----------|---------------|
| Pagamento confirmado antes de `/finance` ter sido aberto p/ a conta | `mirrorPaidRevenueToFinance` chama `ensureFinanceCategories` (que roda o RPC de seed) antes de ler a árvore; se o seed degrada, insere o espelho com `category_id = null` + `category = 'Consultas particulares'` |
| Insert do espelho falha (RLS, constraint, rede) | `console.error('[revenue-mirror] …')` e retorna — **nunca** derruba a confirmação do pagamento. `revenue_entry_id UNIQUE` evita duplicata se um retry parcial ocorreu |
| Re-confirmar pagamento (idempotência) | `select id from finance_entries where revenue_entry_id = X` já retorna linha → helper faz no-op |
| `confirmAppointmentPayment` numa entrada já paga | O `update ... .in('payment_status', ['pending','realized'])` não casa linha → helper não é chamado |
| `revenue_entry` deletada | Espelho some via FK `on delete cascade` |
| PATCH/DELETE de espelho pela API `/api/finance/entries` | `409 revenue_mirror_locked` |
| Categoria de direção errada num lançamento manual | `400 category_direction_mismatch` (`validateEntryInput`); `enforce_finance_entry_category` no banco é o backstop |
| `direction` ausente em body/insert antigo | Default `'out'` na coluna e nos readers de body |

## Testes

**Helper — `tests/revenue/finance-mirror.test.ts` (`createSupabaseMock`):**
- `mirrorPaidRevenueToFinance` com dados de um pagamento → 1 `insert` em
  `finance_entries` com `direction:'in'`, `type:'pj'`, `amount`/`workspace_id`
  da origem, `entry_date` = `saoPauloDateOnly(paidAtIso)`, `revenue_entry_id`
  setado, `category`/`category_id` da raiz "Consultas particulares",
  `recorded_by_phone:'revenue-cycle'`, `raw_message:'(ciclo de receita)'`.
- Espelho já existe (`select` devolve linha) → nenhum `insert`.
- Árvore sem a categoria de receita → `insert` com `category_id: null`,
  `category: 'Consultas particulares'`.
- `insert` retorna `error` → não lança; loga.
- `unmirrorPaidRevenue` → `delete` filtrado por `revenue_entry_id`.

**Sites de chamada (`tests/finance/*`, `tests/revenue/*`):**
- `POST /api/revenue-entries/[id]/confirm` bem-sucedido chama o mirror com os
  campos da linha atualizada.
- `POST /api/revenue` com `status:'confirmado'` chama o mirror; com
  `status:'previsto'` **não** chama.
- `confirmAppointmentPayment` chama o mirror só quando o `update` casou linha.

**Rotas — `tests/finance/api-entries.test.ts`:**
- `POST` sem `direction` grava `'out'`; com `'in'` + categoria de receita
  válida grava e valida; com categoria de despesa → `400
  category_direction_mismatch`.
- `PATCH`/`DELETE` em linha com `revenue_entry_id` → `409`.

**Validação — `tests/finance/entry-validation.test.ts`:**
- categoria `'out'` com lançamento `'in'` → `category_direction_mismatch`.
- subcategoria de outra direção → erro.

**Categorias — `tests/finance/*`:**
- `ensure_finance_income_seed` idempotente; não recria se já há `direction='in'`.
- árvore construída com `in`/`out` separados; `buildTree` cobre.
- CRUD de categoria de receita pela rota.

**Agente — `tests/finance/agent-*.test.ts`:**
- `getEntries` com `direction:'out'` ignora receitas; com `'in'` só receitas.
- `handleUndo` pula `revenue_entry_id != null`.
- `parser` reconhece `/pf+` / `/pj+` → `direction:'in'`.
- `interpret` (mock do modelo) devolve `direction` e é persistido.

**Migration:**
- default `'out'` cobre linha nova sem o campo.
- `select ensure_finance_income_seed` roda para todas as contas sem erro.

## Ordem de implementação

**Plano 1 — dados + tela + espelho (este ciclo):**

1. Migration SQL + mesmas mudanças em `schema.sql` + tipos `database.ts`.
2. `lib/finance/categories.ts` (`direction` no nó) + consumidores + testes.
3. `entry-validation.ts` + `category-validation.ts` + `provision.ts` + testes.
4. Rotas `/api/finance/entries` e `/api/finance/categories` — `direction` e
   trava do espelho (`409 revenue_mirror_locked`) + testes.
5. `lib/revenue/finance-mirror.ts` + testes + fiação nos 3 sites de `paid`.
6. Tela `/finance` — form com toggle, cards Receitas/Despesas/Saldo, tabela,
   gráfico com segmento, `FinanceCategoryManager`.
7. Revisão final + `security-review`.

**Plano 2 — agente WhatsApp (ciclo seguinte, PR separado):** `parser.ts`,
`interpret.ts`, `categorize.ts`, `respond.ts`, `agent.ts` (`getEntries`
`direction`, `handleUndo` guard), prompts.

## Fora de escopo

- Backfill de `revenue_entries` já pagas.
- Lançamento negativo de estorno (o espelho é apagado, não estornado).
- Subcategorias no seed de receita (owner cria pela tela).
- Espelhar despesa do ciclo de receita (não existe hoje) ou parcelas
  (`installments`) como linhas separadas — o espelho é um lançamento único
  pelo `amount` total.
- Relatórios consolidados PF+PJ ou DRE.
