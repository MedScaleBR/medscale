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
| 5 | Edição do espelho | Read-only na tela e na API. Categoria de receita fixa atribuída pelo trigger |
| 6 | Ponto único do espelho | Trigger no Postgres em `revenue_entries` (não helper TS) |
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

### Trigger novo — espelho do pagamento

```sql
create or replace function public.mirror_paid_revenue_to_finance()
returns trigger language plpgsql security definer as $$
declare
  v_income_cat uuid;
  v_paid_date  date;
begin
  -- entrou em 'paid'
  if (tg_op = 'INSERT' and new.payment_status = 'paid')
     or (tg_op = 'UPDATE' and new.payment_status = 'paid'
         and old.payment_status is distinct from 'paid') then

    if exists (select 1 from public.finance_entries
               where revenue_entry_id = new.id) then
      return new; -- idempotente
    end if;

    -- categoria de receita padrão da conta (PJ, direction 'in', raiz
    -- "Consultas particulares"). Garante o seed caso o owner nunca tenha
    -- aberto /finance ainda.
    perform public.ensure_finance_income_seed(new.account_id);
    select id into v_income_cat
      from public.finance_categories
      where account_id = new.account_id and kind = 'pj' and direction = 'in'
        and parent_id is null
        and public.normalize_category_name(name)
            = public.normalize_category_name('Consultas particulares')
      limit 1;

    v_paid_date := (coalesce(new.paid_at, now())
                    at time zone 'America/Sao_Paulo')::date;

    insert into public.finance_entries (
      account_id, workspace_id, recorded_by_phone, type, direction,
      description, amount, category, category_id, subcategory_id,
      raw_message, entry_date, revenue_entry_id
    ) values (
      new.account_id, new.workspace_id, 'revenue-cycle', 'pj', 'in',
      coalesce(new.procedure_name, 'Consulta'),
      new.amount, 'Consultas particulares', v_income_cat, null,
      '(ciclo de receita)', v_paid_date, new.id
    );
    return new;
  end if;

  -- saiu de 'paid' (refunded, cancelled, pending, realized…)
  if tg_op = 'UPDATE' and old.payment_status = 'paid'
     and new.payment_status is distinct from 'paid' then
    delete from public.finance_entries where revenue_entry_id = new.id;
  end if;

  return new;
end;
$$;

create trigger trg_mirror_paid_revenue
  after insert or update of payment_status on public.revenue_entries
  for each row execute procedure public.mirror_paid_revenue_to_finance();
```

Notas:

- `security definer` porque `revenue_entries` é gravada com service role e
  `finance_entries` tem RLS owner-only; o trigger precisa inserir
  independentemente da sessão.
- `after ... of payment_status` — só dispara quando a coluna relevante muda.
- O `delete` do espelho ao sair de `'paid'` é o caminho de reembolso
  (`refunded`) e de correção (voltou para `pending`/`realized`). Não há
  lançamento negativo de estorno — a linha some, mantendo `/finance` alinhado
  ao ciclo (decisão 3).
- A trigger `enforce_finance_entry_category` valida a linha inserida:
  `category_id` é raiz PJ `direction='in'`, coerente com `type='pj'` e
  `direction='in'`.

### Provisionamento de categorias de receita

O RPC `provision_finance_categories` tem guarda "se já existe qualquer
categoria da conta, retorna". Contas que já provisionaram despesa **não**
ganhariam o seed de receita. Solução: função idempotente dedicada, chamada
(a) pelo trigger acima, (b) por `ensureFinanceCategories` no carregamento de
`/finance` e no agente.

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
2. `alter table finance_entries add column direction ..., add column
   revenue_entry_id ...`.
3. Recriar índice único de irmãos com `direction`; criar índices novos.
4. `create or replace` das duas funções de trigger de categoria.
5. `create function ensure_finance_income_seed`.
6. `create function mirror_paid_revenue_to_finance` + `create trigger`.
7. `select ensure_finance_income_seed(id) from accounts` — semeia receita em
   todas as contas existentes (uma vez).
8. Espelhar `schema.sql` (fonte de verdade para reconstrução) com as mesmas
   mudanças.

Sem backfill de `revenue_entries` já pagas (decisão 4).

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

`CategoryNode` inalterado. `FinanceCategoryTree` passa a separar por direção:

```ts
interface FinanceCategoryTree {
  pf: { in: CategoryNode[]; out: CategoryNode[] }
  pj: { in: CategoryNode[]; out: CategoryNode[] }
}
```

`buildTree` agrupa por `(kind, direction)`. `rootCategoryName(tree, id)`
procura em ambos os sub-arrays (só precisa do id → nome). `resolveCategoryPair`
ganha parâmetro `direction: 'in' | 'out'` (default `'out'` para os chamadores
atuais) e resolve em `tree[kind][direction]`. Chamadas atualizadas em todos os
consumidores (rotas, agente).

### `lib/finance/default-categories.ts`

`DefaultCategoryTree` continua só com as categorias de **despesa** (o seed de
receita vive na função SQL `ensure_finance_income_seed`, para o trigger
poder garanti-lo sem passar pelo TS). Documentar o espelhamento dos nomes.

### `lib/finance/entry-validation.ts`

`EntryInput` ganha `direction`. `findRoot` procura no sub-array
`tree[kind][direction]`. Novo código de erro `category_direction_mismatch`.
`validateEntryInput` valida que a categoria/subcategoria pertence à direção do
lançamento.

### `lib/finance/provision.ts`

`ensureFinanceCategories` passa a chamar também
`rpc('ensure_finance_income_seed', ...)` depois do provision principal
(mesma degradação graciosa se a função ainda não existe no banco).

### `lib/revenue/cycle.ts`

Nenhuma mudança — o espelho é 100% trigger. Comentar no topo do arquivo que a
transição para `'paid'` dispara `trg_mirror_paid_revenue`.

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

`getFinanceCategoryTree` já traz a árvore nova (com `in`/`out`). Passa
`workspaces` como hoje. Sem outra mudança (a query de `finance_entries` já é
`select *`, então `direction`/`revenue_entry_id` vêm juntos).

### `FinanceClient.tsx`

- `filtered` divide em `receitas` (`direction === 'in'`) e `despesas`
  (`direction === 'out'`), para **as duas abas**.
- `byCategory`/`FinanceCategoryChart`: segmento "Despesas | Receitas" acima do
  gráfico (estado local, default Despesas), agrupando o lado escolhido.
- `roots` para o formulário e o gráfico vêm de `categoryTree[kind][direction]`.
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
- `FinanceCategoryPicker` recebe `direction` e lista
  `tree[kind][direction]`.
- Ao trocar o toggle: zera `categoryId`/`subcategoryId`.
- `payload` inclui `direction`.
- Edição de espelho não acontece aqui (a tabela esconde a ação).

### `FinanceCategoryPicker.tsx`

Nova prop `direction`; troca `tree[kind]` por `tree[kind][direction]`.

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

Categoriza contra `tree[type][direction]` — o passo de categorização recebe a
direção do intent e só considera as raízes daquela direção.

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
| Pagamento confirmado antes de `/finance` existir p/ a conta | Trigger chama `ensure_finance_income_seed`; se falhar o seed, insere espelho com `category_id = null` + `category = 'Consultas particulares'` (não bloqueia o `paid`) |
| `enforce_finance_entry_category` recusa o espelho | Exceção propaga e **aborta a confirmação do pagamento** — indesejado. Mitigação: o trigger monta o insert já coerente; teste de integração cobre. Fallback `category_id = null` se a categoria não for encontrada |
| Re-confirmar pagamento / update idempotente | `where revenue_entry_id = new.id` já existe → `return` sem inserir |
| `refunded` → depois volta a `paid` | Espelho foi apagado na saída; volta a ser criado na reentrada |
| PATCH/DELETE de espelho pela API | `409 revenue_mirror_locked` |
| Categoria de direção errada num lançamento manual | `400 category_direction_mismatch` (validação TS) + exceção da trigger como backstop |
| `direction` ausente em body/insert antigo | Default `'out'` |

## Testes

**Trigger — `tests/finance/revenue-mirror.test.ts` (integração):**
- `paid` (via `POST /api/revenue-entries/[id]/confirm`) cria 1 `finance_entry`
  `direction='in'`, `type='pj'`, `amount`/`workspace_id` da origem,
  `entry_date` = data de `paid_at` em SP, `revenue_entry_id` setado,
  `category_id` = raiz PJ "Consultas particulares".
- `POST /api/revenue` avulso já `confirmado` → espelha na hora.
- Confirmar duas vezes / update sem trocar status → continua 1 linha.
- `paid → refunded` → espelho apagado. `paid → cancelled` idem.
  `paid → pending` idem.
- `delete revenue_entry` → espelho some (cascade).
- Conta sem categorias provisionadas → seed criado, espelho com categoria.

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

1. Migration SQL + espelho em `schema.sql` + tipos `database.ts`.
2. `lib/finance/categories.ts` (árvore `in`/`out`) + consumidores + testes.
3. `entry-validation.ts` + `provision.ts` + testes.
4. Rotas `/api/finance/entries` (+ categorias) — `direction` e trava do
   espelho + testes.
5. Trigger do espelho + `tests/finance/revenue-mirror.test.ts`.
6. Tela `/finance` — form com toggle, cards, tabela, gráfico, manager.
7. Agente WhatsApp — parser, interpret, categorize, respond, agent, prompts.
8. Revisão final + `security-review`.

## Fora de escopo

- Backfill de `revenue_entries` já pagas.
- Lançamento negativo de estorno (o espelho é apagado, não estornado).
- Subcategorias no seed de receita (owner cria pela tela).
- Espelhar despesa do ciclo de receita (não existe hoje) ou parcelas
  (`installments`) como linhas separadas — o espelho é um lançamento único
  pelo `amount` total.
- Relatórios consolidados PF+PJ ou DRE.
