# Design — `/finance`: Categorias e subcategorias (Bloco A)

**Data:** 2026-09-01
**Status:** aprovado para plano de implementação
**Escopo desta spec:** Bloco A de uma reformulação maior da tela `/finance`. Blocos
B (planilha CNPJ — margem de lucro) e C (planilha PF — patrimônio, projeções e
metas) terão specs próprias e reusam o que este bloco define.

---

## 1. Objetivo

Hoje a tela `/finance` (`app/(dashboard)/finance/page.tsx`, título "Financeiro") é
somente-leitura: mostra `finance_entries` dos últimos 12 meses em abas PF/PJ, com
cards, gráfico por categoria e tabela. Lançamentos entram **só pelo WhatsApp**
(`lib/finance/agent.ts`), que categoriza contra listas fixas no código
(`PF_CATEGORIES` / `PJ_CATEGORIES` em `lib/finance/categorize.ts`).
`finance_entries.category` é texto livre; não há tabela de categorias nem
subcategorias.

Este bloco entrega:

1. Uma árvore de **categorias e subcategorias** (exatamente 2 níveis), separada
   por PF/PJ, no nível da **conta** (`account_id`).
2. **CRUD** completo dessa árvore, dentro da própria tela `/finance`.
3. **Seed automático**: uma árvore curada padrão criada na primeira vez + as
   categorias derivadas do histórico de lançamentos da conta.
4. **Lançamentos na tela**: criar, editar e excluir qualquer lançamento (inclusive
   os que vieram do WhatsApp), escolhendo categoria e subcategoria.
5. **Agente do WhatsApp** passa a categorizar contra a árvore personalizada da
   conta, resolvendo também a subcategoria.

Fora de escopo: remover a coluna `finance_entries.category` (texto); planilhas B/C;
qualquer mudança em `revenue_entries` / `/ciclo-receita`.

---

## 2. Modelo de dados

### 2.1 Nova tabela `finance_categories`

| coluna | tipo | nota |
|---|---|---|
| `id` | `uuid` pk default `uuid_generate_v4()` | |
| `account_id` | `uuid` → `accounts(id)` on delete cascade, not null | |
| `kind` | `text` not null, check `in ('pf','pj')` | árvore separada PF/PJ |
| `parent_id` | `uuid` → `finance_categories(id)` on delete cascade, null | null = categoria-raiz; preenchido = subcategoria |
| `name` | `text` not null | |
| `sort_order` | `int` not null default 0 | ordem na tela |
| `is_archived` | `boolean` not null default false | soft-delete |
| `created_at` | `timestamptz` not null default `now()` | |

**Índices:**
- `idx_finance_categories_tree` em `(account_id, kind, parent_id, sort_order)`.
- Índice de expressão único:
  `unique (account_id, kind, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))`
  — impede duas irmãs de mesmo nome (case-insensitive), permite mesmo nome em
  ramos diferentes.

**RLS e grants** (mesmo padrão de `finance_entries`):
- `alter table public.finance_categories enable row level security;`
- `create policy "finance_categories: owner only" on public.finance_categories
   for all using (public.is_account_owner(account_id));`
- `grant all on public.finance_categories to authenticated, service_role;`

**Trigger `enforce_finance_category_depth`** (estilo `enforce_workspace_account`,
já presente em `schema.sql`) — roda `before insert or update`:
- Se `NEW.parent_id is not null`:
  - a linha pai tem que existir, ter `parent_id is null` (proibe 3º nível),
    mesmo `account_id` e mesmo `kind` que `NEW`; senão `raise exception`.
- Impede também que uma categoria que já é pai (tem filhos) receba `parent_id`
  (viraria neto para os filhos existentes).

### 2.2 Alterações em `finance_entries`

- `+ category_id uuid references public.finance_categories(id) on delete set null`
- `+ subcategory_id uuid references public.finance_categories(id) on delete set null`
- `category text` **permanece**: passa a ser snapshot/raw (nome que o agente ou a
  migração entendeu) e fallback visual — quando `category_id is null` a tela
  mostra "Sem categoria".
- `+ index idx_finance_entries_category on public.finance_entries(account_id, category_id, entry_date desc)`

**Trigger `enforce_finance_entry_category`** — `before insert or update`:
- Se `NEW.subcategory_id is not null`: a linha referida tem que ter
  `parent_id = NEW.category_id`.
- Se `NEW.category_id is not null`: `finance_categories.kind` da linha referida tem
  que ser igual a `NEW.type` (`pf`→`pf`, `pj`→`pj`).

### 2.3 Onde vive o SQL

- **Novo:** `supabase/migration_finance_categories.sql` — aditivo, no padrão dos
  outros `migration_*.sql`, com o mesmo cabeçalho de aviso ("NÃO rode
  `schema.sql`"). Contém: `create table`, índices, RLS, grants, os dois triggers,
  e os `alter table` de `finance_entries`.
- **Espelhado** em `supabase/schema.sql` (fonte de verdade para reset do zero).
- `types/database.ts` — `finance_categories` (Row/Insert/Update) e as duas colunas
  novas em `finance_entries`.

A migração **não roda sozinha**: o owner roda o SQL no Supabase SQL Editor e abre
o PR (convenção do projeto).

---

## 3. Seed, derivação do histórico e migração de dados

### 3.1 Árvore curada padrão

Em `lib/finance/default-categories.ts` (novo) — editável pelo owner depois de
criada. Os nomes das raízes reaproveitam os das constantes atuais para o backfill
casar bem.

**PF:**
- Alimentação → Mercado, Restaurante, Delivery
- Moradia → Aluguel, Condomínio, Contas (luz/água/gás), Internet
- Filhos → Escola, Saúde, Atividades
- Saúde → Plano, Farmácia, Consultas
- Transporte → Combustível, App/Táxi, Manutenção
- Lazer → Viagem, Streaming, Restaurantes
- Vestuário
- Assinaturas
- Investimentos
- Impostos e taxas
- Outros

**PJ:**
- Aluguel
- Salários e encargos
- Marketing
- Software e assinaturas
- Equipamentos
- Materiais médicos
- Contabilidade
- Impostos
- Manutenção
- Outros

### 3.2 `ensureFinanceCategories(accountId)`

Novo módulo `lib/finance/provision.ts`. Provisionamento **lazy e idempotente**,
numa transação, protegido por `pg_advisory_xact_lock(hashtext(accountId::text))`
para não duplicar em carregamentos simultâneos.

Passos, só se `select count(*) from finance_categories where account_id = ?` for 0:

1. **Seed curado:** insere a árvore da §3.1 para `kind='pf'` e `kind='pj'`,
   `sort_order` sequencial na ordem listada.
2. **Derivação do histórico:** `select distinct category from finance_entries
   where account_id = ? and category is not null`, separado por `type`. Todo nome
   que não casa (case-insensitive, sem acento) com uma raiz curada do mesmo
   `kind` vira **categoria-raiz nova** naquele `kind`. Nunca vira subcategoria.
3. **Backfill dos lançamentos:** para cada `finance_entries` da conta com
   `category` texto e `category_id is null`, acha a raiz de mesmo `kind` cujo nome
   casa (case/acento-insensitive) e seta `category_id`. Sem match → `category_id`
   fica null. `subcategory_id` sempre null no backfill (dado antigo não tem esse
   nível).

**Chamadas:**
- `app/(dashboard)/finance/page.tsx` (server component), antes de ler os dados.
- `lib/finance/agent.ts`, depois de resolver `accountId` — cobre o médico que usa
  o WhatsApp antes de abrir a tela. Custo quando já provisionado: uma query de
  count.

---

## 4. Tela `/finance` reformulada

`role` continua **owner-only**; módulo `finance` continua o gate. Estrutura:

- Topo: **segmented control Pessoal (PF) / Clínica (PJ)** + seletor de mês
  (`FinanceMonthPicker`, inalterado). PF/PJ é o eixo de tudo e persiste entre as
  visões.
- Barra de abas por visão: **Visão geral · Lançamentos · Categorias**.
  (Blocos B/C adicionam **Planilha** aqui.)

### 4.1 Visão geral (evolução da tela atual)

- Cards *Total do mês* e *Maior gasto* — "Maior gasto" mostra
  "Categoria — Subcategoria" quando houver subcategoria.
- Gráfico por categoria-raiz; clicar numa barra abre o detalhe por subcategoria
  e filtra a tabela da aba Lançamentos.
- Se houver lançamentos "Sem categoria" no período, uma faixa destacada com
  atalho para a aba Lançamentos filtrada nesses itens.

### 4.2 Lançamentos (aba nova)

- Toolbar: **+ Novo lançamento**, filtro por categoria, busca por descrição.
- Tabela: Data · Descrição · Categoria · Subcategoria · Unidade *(coluna só na
  aba PJ)* · Valor · menu ⋯ (Editar / Excluir).
- Form (dialog, `FinanceEntryForm`): data, descrição, valor, **categoria**
  (select), **subcategoria** (select filtrado pela categoria escolhida, opcional),
  **unidade** (só PJ; select das workspaces da conta; vazio = consolidado /
  `workspace_id` null). `type` vem fixo da aba ativa.
- Criar: mesmo form vazio. Editar: pré-preenchido. Excluir: dialog de
  confirmação. Vale para qualquer linha, inclusive as originadas no WhatsApp.
- Escopo do mês selecionado, sem paginação (mantém a premissa atual de volume
  baixo; `MONTHS_OF_HISTORY = 12` no server component continua).
- Após qualquer mutação: `router.refresh()` para repuxar os dados do server
  component.

### 4.3 Categorias (o gerenciador)

Mostra a árvore do `kind` ativo no segmented control (PF ou PJ) — trocar o
control troca a árvore exibida.

- Lista em 2 níveis: raízes expansíveis com suas subcategorias; contador de
  lançamentos ao lado de cada nó.
- Ações da raiz: Renomear · **+ Subcategoria** · Arquivar · reordenar (botões
  ↑/↓, sem lib de drag-and-drop).
- Ações da subcategoria: Renomear · Arquivar · **Mover para outra categoria**
  (select de raízes do mesmo `kind`).
- **+ Nova categoria.**
- Toggle "Mostrar arquivadas" → itens arquivados aparecem esmaecidos, com
  "Reativar".
- Arquivar raiz com subcategorias: dialog de confirmação mostrando o que será
  escondido; a subárvore inteira recebe `is_archived = true`.

### 4.4 Componentes em `components/finance/`

| arquivo | mudança |
|---|---|
| `FinanceClient.tsx` | reestrutura: segmented control + abas de visão |
| `FinanceEntryTable.tsx` | menu de ações, colunas Subcategoria e Unidade |
| `FinanceEntryForm.tsx` | **novo** — dialog criar/editar lançamento |
| `FinanceCategoryManager.tsx` | **novo** — a aba Categorias |
| `FinanceCategoryPicker.tsx` | **novo** — select categoria + subcategoria reutilizável (form e reclassificação inline) |
| `FinanceSummaryCards.tsx` | "Maior gasto" com subcategoria |
| `FinanceCategoryChart.tsx` | drill-down categoria → subcategoria |
| `FinanceMonthPicker.tsx` | inalterado |

---

## 5. APIs

Tudo em `app/api/finance/`. **Owner-only + módulo `finance`**, no padrão de
`app/api/revenue-settings/route.ts`: `requireWorkspaceSession` +
`requireModule(session, 'finance')` + `requireOwner(session)`. Escrita com
`createClient()` RLS-scoped (a policy de owner é o guarda). A `session` carrega
`accountId`.

### 5.1 `finance/categories/route.ts`

- `GET` — árvore da conta. `?kind=pf|pj` opcional (sem o param, devolve as duas).
  Cada nó traz `is_archived` e `entry_count` (contagem de `finance_entries` que
  referenciam o nó por `category_id` **ou** `subcategory_id`).
- `POST` — cria categoria ou subcategoria. Body `{ kind, name, parent_id? }`.
  Valida: `kind ∈ pf|pj`; se `parent_id`, o pai é raiz, mesmo `kind` e mesma
  conta; nome não-vazio e único entre irmãs (case/acento-insensitive). Erros →
  `400` com mensagem amigável.

### 5.2 `finance/categories/[id]/route.ts`

- `PATCH` — `{ name?, parent_id?, sort_order?, is_archived? }`. Cobre renomear,
  mover subcategoria (novo `parent_id` tem que resolver para uma raiz do mesmo
  `kind`), reordenar, arquivar/reativar. Arquivar uma raiz cascateia
  `is_archived` para os filhos; reativar a raiz **não** reativa os filhos
  automaticamente (o owner reativa o que quiser).
- `DELETE` — exclusão real. Permitida **só** quando o nó tem zero filhos e zero
  lançamentos referenciando (`category_id` ou `subcategory_id`). Caso contrário
  `409` com payload indicando a contagem e orientando a arquivar.

### 5.3 `finance/entries/route.ts`

- `POST` — lançamento manual. Body `{ type, entry_date, description?, amount,
  category_id?, subcategory_id?, workspace_id? }`. Servidor preenche
  `recorded_by_phone = 'web'` e `raw_message = '(lançado na tela)'` (colunas
  `not null`). Valida: `amount > 0`; `finance_categories.kind` de `category_id` =
  `type`; `subcategory_id.parent_id = category_id`; `workspace_id`, se informado,
  pertence à conta. (Os triggers da §2 são a segunda linha de defesa.)
- Sem `GET`: a tela é server component e refaz a query; o cliente chama
  `router.refresh()`.

### 5.4 `finance/entries/[id]/route.ts`

- `PATCH` — edita `{ entry_date?, description?, amount?, category_id?,
  subcategory_id?, workspace_id? }`. Mesma validação do POST. Não permite trocar
  `type` (mudaria a aba; se precisar, exclui e recria).
- `DELETE` — remove o lançamento.

---

## 6. Agente do WhatsApp

### 6.1 `lib/finance/categories.ts` (novo)

- `getFinanceCategoryTree(supabase, accountId)` → `{ pf: Node[], pj: Node[] }`,
  `Node = { id, name, children: Node[] }`, só não-arquivadas, ordenado por
  `sort_order`.
- `resolveCategoryPair(tree, type, catName, subName)` →
  `{ categoryId, categoryName, subcategoryId, subcategoryName }`. Casa por nome
  sem acento/case dentro do `kind` = `type`. `subName` só resolve se pertencer à
  categoria resolvida; senão `subcategoryId = null`. Nada casa →
  `categoryId = null`.

### 6.2 `lib/finance/default-categories.ts` (novo)

Passa a ser a dona das listas curadas. `lib/finance/categorize.ts` deixa de
exportar `PF_CATEGORIES` / `PJ_CATEGORIES`.

### 6.3 `lib/finance/categorize.ts`

`categorizeEntry(description, type, tree)` — o prompt lista as opções como
`Categoria > Subcategoria` (e as raízes sozinhas); o modelo escolhe a folha ou a
raiz mais adequada. Retorna `{ categoryName, subcategoryName | null }`. Continua
em `claude-sonnet-4-5`. Sem árvore utilizável → devolve `{ 'Outros', null }`.

### 6.4 `lib/finance/interpret.ts`

- `interpretMessage(messageText, today, tree)` — `buildSystem` injeta os nomes de
  categoria/subcategoria da conta em vez das constantes.
- `INTENT_TOOL` ganha a propriedade `subcategoria` (`type: ['string','null']`),
  adicionada também ao `required` (o schema é `strict: true`).
- Continua em `claude-opus-5`.
- A resolução nome→id **não** acontece aqui — `toIntent` só carrega os nomes.
  `FinanceIntent.entry` ganha `subcategory: string | null`; `FinanceIntent.query`
  ganha `subcategory: string | null`. `validCategory` sai; quem resolve é o
  agente (vale para o caminho de atalho e o de linguagem natural).

### 6.5 `lib/finance/agent.ts`

- Depois de resolver `accountId`: `await ensureFinanceCategories(accountId)` e
  `const tree = await getFinanceCategoryTree(supabase, accountId)`.
- Passa `tree` para `interpretMessage(...)` e para `categorizeEntry(...)`.
- Resolução do lançamento: `resolveCategoryPair(tree, intent.type,
  intent.category, intent.subcategory)`. Se nada resolve, chama
  `categorizeEntry(intent.description, intent.type, tree)` e resolve o resultado
  de novo pela árvore (fluxo espelha o atual, onde o caminho de atalho já
  dependia de `categorizeEntry`).
- `persistEntryAndConfirm` grava `category_id`, `subcategory_id` **e**
  `category` = `categoryName` resolvido (snapshot; não quebra leitor antigo).
- Intent `query`: `QueryFilters` ganha `categoryId` / `subcategoryId`;
  `getEntries` filtra por id em vez de `eq('category', ...)`; `buildQueryMessage`
  em `lib/finance/respond.ts` usa o **nome** para a frase e o id para o filtro.
- `handlePendingChooseWorkspace` (fluxo PJ de duas mensagens) passa a carregar
  `category_id` / `subcategory_id` no `pending_entry` além do texto.

---

## 7. Testes

Vitest, no padrão de `tests/finance/` (funções puras, Supabase mockado via
`tests/helpers/supabase-mock.ts`).

- `tests/finance/category-depth.test.ts` — validação de profundidade 2 (rejeita
  3º nível), match de `kind` e `account` no `parent_id`, unicidade entre irmãs
  (case/acento). Testa a função de validação do app (o trigger é coberto na
  validação manual).
- `tests/finance/provision.test.ts` — `ensureFinanceCategories`: idempotência
  (2ª chamada não duplica), árvore curada criada nos dois `kind`, derivação
  (string nova do histórico vira raiz; string conhecida não duplica), backfill
  (casa por nome sem acento; sem match → `category_id` null).
- `tests/finance/resolve-category-pair.test.ts` — `resolveCategoryPair`: casa
  categoria e subcategoria; subcategoria de outra categoria é ignorada; nada
  casa → nulls; respeita `kind` vs `type`.
- `tests/finance/categorize-prompt.test.ts` — montagem do prompt de
  `categorizeEntry` a partir da árvore (lista `Categoria > Subcategoria`,
  inclui raízes sozinhas, só não-arquivadas).
- `tests/finance/resolve-unit.test.ts` — sem mudança (assinatura de
  `resolveUnit` não muda); rodar para garantir que não quebrou.

### Validação manual (checklist do fim do plano)

1. Rodar `supabase/migration_finance_categories.sql` no Supabase SQL Editor.
2. Abrir `/finance` numa conta com lançamentos antigos: conferir árvore curada,
   categorias derivadas do histórico, backfill, faixa "Sem categoria".
3. CRUD de categoria e subcategoria; reordenar; mover subcategoria; arquivar raiz
   com filhos (confirma cascata); reativar; "Mostrar arquivadas".
4. `DELETE` de categoria em uso → `409`; de categoria vazia → ok.
5. Criar / editar / excluir lançamento nas abas PF e PJ, com e sem subcategoria,
   PJ com e sem unidade.
6. Mandar um gasto pelo WhatsApp (linguagem natural e atalho `/pj ...`) e conferir
   `category_id` / `subcategory_id` preenchidos.
7. `/resumo pf` e uma consulta por categoria no WhatsApp — resposta correta com o
   filtro por id.

---

## 8. Pontos de atenção

- `schema.sql` é "drop and recreate": a migração vai num `migration_*.sql`
  aditivo **e** é espelhada em `schema.sql`. Mesmo aviso do topo de
  `migration_finance.sql`.
- Seed lazy: a primeira abertura de `/finance` numa conta grande faz
  seed + derivação + backfill numa transação com advisory lock — pode levar ~1s,
  uma única vez.
- `finance_entries.category` (texto) **não** é removida nesta fase; sai num spec
  futuro, quando nada mais depender dela.
- Blocos B e C penduram abas **Planilha** nesta mesma tela; a estrutura de abas
  já contempla.
- A migração SQL não roda automaticamente — o owner roda e abre o PR (convenção
  do projeto).
