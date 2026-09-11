# Patrimônio no /finance — reservas, investimentos, projeções, metas e sugestões

Data: 2026-09-11
Status: design aprovado (aguardando revisão do spec)

## Problema

O `/finance` hoje responde uma pergunta só: **quanto entrou e quanto saiu**.
`finance_entries` registra o passado, `finance_categories` organiza esse
passado, e a tela mostra o mês. Nada no módulo sabe o que o médico **tem
guardado**, o que ele **pretende gastar**, nem o que ele **quer juntar** — e
sem isso não dá para avisar quando um gasto sai da linha.

Objetivo, em cinco pedaços que se encadeiam:

1. **Reservas** — dinheiro guardado, por caixinha nomeada, com histórico.
2. **Investimentos** — o que está aplicado, com rendimento estimado quando
   houver taxa informada.
3. **Projeções** — quanto o owner planeja gastar por categoria no mês.
4. **Metas** — quanto quer juntar, manual ou derivado das projeções.
5. **Sugestões** — alerta de gasto excessivo em categoria não essencial,
   comparando o realizado contra a projeção ou contra a média histórica.

As quatro primeiras são bidirecionais: tudo que nasce no WhatsApp aparece e é
editável no painel, e vice-versa. A quinta é derivada — só leitura nos dois
canais.

## O que já existe (confirmado no schema)

Estas são as âncoras do design; foram verificadas em `supabase/schema.sql`
antes de qualquer decisão.

| Peça | Fato |
|------|------|
| `finance_entries` | `type` (`pf`/`pj`), `direction` (`in`/`out`), `amount numeric(12,2)`, `entry_date date`, `category_id`, `subcategory_id` |
| `finance_categories` | **Tabela única auto-referenciada**: `parent_id` null = raiz, preenchido = subcategoria. Profundidade 2 travada por `trg_enforce_finance_category_depth`. Tem `kind` (pf/pj) e `direction` (in/out) |
| Owner-only | `public.is_account_owner(uuid)` — `security definer`, membership `role='owner'` + `status='active'`. Já usada em `finance_entries: owner only` |
| Painel | `app/(dashboard)/finance/page.tsx` → `components/finance/FinanceClient.tsx`, com toggle PF/PJ e `FinanceMonthPicker` |
| Agente | `interpret.ts` já devolve **nomes** de categoria deduzidos da árvore; `resolveCategoryPair()` resolve nome→id; `categorizeEntry()` é só fallback |
| API | `requireWorkspaceSession` + `requireModule(session,'finance')` + `requireRole(session,['owner'])` |

Consequência direta: `category_id` e `subcategory_id` das tabelas novas
apontam **ambos** para `finance_categories(id)` — não existe tabela separada de
subcategoria.

## Decisões

| # | Tema | Decisão |
|---|------|---------|
| 1 | PF/PJ | Reservas, investimentos e metas ganham `kind` (`pf`/`pj`, default `pf`) e entram no toggle já existente. Projeções **não** têm coluna `kind`: ela vem implícita do `category_id` |
| 2 | Navegação | `/finance` segue sendo Lançamentos. As cinco áreas viram sub-rotas com `layout.tsx` compartilhado carregando o guard owner-only e o nav |
| 3 | Rendimento | Juros **compostos** sobre a fração de ano decorrida. Sem `rate_type`/`rate_value`/`start_date` completos → `null`, nunca uma taxa chutada |
| 4 | CDI / IPCA | Índices ficam em constantes versionadas em `lib/finance/investments.ts`, com a data da referência no comentário. Sem integração externa nesta versão |
| 5 | Meta automática | `requiredTotal = (soma das projeções do mês) × months_of_expenses − patrimônio atual`. `months_of_expenses` default `1` = fórmula literal do prompt; o campo existe para virar reserva de N meses sem migração nova |
| 6 | Meta automática nunca congela | Recalculada a cada leitura por `calculateGoalStatus()`. O banco guarda só os parâmetros |
| 7 | `is_essential` | Coluna em `finance_categories`, default `true`, sem herança: um nó é não essencial só se ele próprio estiver marcado. Só vale para `direction = 'out'` |
| 8 | Base de comparação | Projeção do período > média dos últimos 3 meses > **silêncio**. Menos de 2 meses de histórico e sem projeção = nenhum alerta |
| 9 | Descarte de alerta | Linha em `finance_suggestion_dismissals` com `period_month`; some só até o fim do mês |
| 10 | Lógica pura | `investments.ts`, `goals.ts` e `suggestions.ts` não tocam o banco — recebem dados e devolvem resultado, testáveis com vitest sem mock de Supabase |

## Modelo de dados

Migração incremental em `supabase/migration_finance_patrimonio.sql`
(só `create`/`alter`), com o mesmo conteúdo incorporado a `supabase/schema.sql`,
que segue sendo a fonte de verdade para reconstruções.

### Reservas

```sql
create table public.finance_reserves (
  id          uuid default uuid_generate_v4() primary key,
  account_id  uuid references public.accounts(id) on delete cascade not null,
  kind        text not null default 'pf' check (kind in ('pf','pj')),
  name        text not null,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);

create table public.finance_reserve_movements (
  id          uuid default uuid_generate_v4() primary key,
  reserve_id  uuid references public.finance_reserves(id) on delete cascade not null,
  account_id  uuid references public.accounts(id) on delete cascade not null,
  amount      numeric(12,2) not null check (amount > 0),
  type        text not null check (type in ('deposit','withdrawal')),
  source      text not null default 'web' check (source in ('web','whatsapp')),
  note        text,
  occurred_at date not null default current_date,
  created_at  timestamptz not null default now()
);
```

- `account_id` **duplicado** em `finance_reserve_movements`: a policy do
  movimento fica `is_account_owner(account_id)` direto, sem subquery na
  reserva — mesmo motivo pelo qual a policy de `finance_entries` é trivial.
  Coerência com a reserva garantida por trigger.
- `amount > 0` sempre; o sinal está em `type`. Saldo = Σ depósitos − Σ retiradas.
- `occurred_at date` (não `timestamptz`): todo o módulo trabalha em dia, não
  em instante — `finance_entries.entry_date` é `date` pelo mesmo motivo, e
  isso evita a classe de bug de fuso em borda de mês.
- `source` `'web'`/`'whatsapp'` espelha o sentinela `recorded_by_phone: 'web'`
  já usado em `finance_entries`.

### Investimentos

```sql
create table public.finance_investments (
  id              uuid default uuid_generate_v4() primary key,
  account_id      uuid references public.accounts(id) on delete cascade not null,
  kind            text not null default 'pf' check (kind in ('pf','pj')),
  name            text not null,
  type            text not null check (type in ('renda_fixa','renda_variavel','cripto','outro')),
  invested_amount numeric(12,2) not null check (invested_amount > 0),
  current_value   numeric(12,2),
  rate_type       text check (rate_type in ('fixed_annual','pct_cdi','ipca_plus')),
  rate_value      numeric(8,2),
  start_date      date not null default current_date,
  maturity_date   date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
```

- `rate_value numeric(8,2)` e não `(6,2)`: `pct_cdi` aceita valores como
  `110.00`, e `(6,2)` já caberia, mas 8 dá folga sem custo.
- `current_value` é o valor **informado manualmente** pelo owner. O valor
  estimado pelo cálculo nunca é gravado — é derivado na leitura.

### Projeções

```sql
create table public.finance_projections (
  id               uuid default uuid_generate_v4() primary key,
  account_id       uuid references public.accounts(id) on delete cascade not null,
  category_id      uuid references public.finance_categories(id) on delete cascade not null,
  subcategory_id   uuid references public.finance_categories(id) on delete cascade,
  period_month     date not null,
  projected_amount numeric(12,2) not null check (projected_amount >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index idx_finance_projections_unique
  on public.finance_projections(
    account_id, category_id,
    coalesce(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_month
  );
```

- `unique` via índice com `coalesce`, não `unique (…)` na tabela: `NULL` em
  constraint unique é sempre distinto de `NULL`, então duas projeções de
  categoria sem subcategoria passariam. Mesmo truque de
  `idx_finance_categories_unique_sibling`.
- `on delete cascade` na categoria (e não `set null` como em
  `finance_entries`): uma projeção sem categoria não significa nada, enquanto
  um lançamento sem categoria ainda é um gasto que aconteceu.
- `period_month` = dia 1 do mês, garantido por trigger de normalização
  (`date_trunc('month', …)`), para o índice único não ser furado por
  `2026-09-01` vs `2026-09-15`.

### Metas

```sql
create table public.finance_goals (
  id                 uuid default uuid_generate_v4() primary key,
  account_id         uuid references public.accounts(id) on delete cascade not null,
  kind               text not null default 'pf' check (kind in ('pf','pj')),
  name               text not null,
  mode               text not null check (mode in ('manual','auto')),
  target_amount      numeric(12,2),
  target_date        date,
  months_of_expenses numeric(5,2) not null default 1,
  linked_reserve_id  uuid references public.finance_reserves(id) on delete set null,
  status             text not null default 'active' check (status in ('active','completed','archived')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint finance_goals_manual_needs_target
    check (mode <> 'manual' or target_amount is not null)
);
```

- A `check` de ponte garante no banco o que o prompt pede em prosa:
  meta manual **precisa** de `target_amount`; meta automática pode não ter.
- `linked_reserve_id` null = a meta acompanha o patrimônio inteiro do `kind`
  (todas as reservas + investimentos). Preenchido = acompanha só aquela
  caixinha. Essa é a diferença entre "quero 30 mil guardados" e "quero 30 mil
  na caixinha Viagem".

### Sugestões

```sql
alter table public.finance_categories
  add column is_essential boolean not null default true;

create table public.finance_suggestion_dismissals (
  id             uuid default uuid_generate_v4() primary key,
  account_id     uuid references public.accounts(id) on delete cascade not null,
  category_id    uuid references public.finance_categories(id) on delete cascade not null,
  subcategory_id uuid references public.finance_categories(id) on delete cascade,
  period_month   date not null,
  dismissed_at   timestamptz not null default now()
);

create unique index idx_finance_dismissals_unique
  on public.finance_suggestion_dismissals(
    account_id, category_id,
    coalesce(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_month
  );

create table public.finance_suggestion_settings (
  account_id               uuid primary key references public.accounts(id) on delete cascade,
  projection_tolerance_pct numeric(5,2) not null default 0,
  history_tolerance_pct    numeric(5,2) not null default 30,
  updated_at               timestamptz not null default now()
);
```

`finance_suggestion_settings` pode não ter linha — a leitura usa os defaults
do TypeScript (`DEFAULT_TOLERANCE`), evitando um insert de provisionamento em
toda conta que nunca abriu a aba.

### RLS

Todas as sete tabelas: `enable row level security` + policy única
`for all using (public.is_account_owner(account_id))`, e
`grant all … to authenticated, service_role`. Idêntico a
`finance_entries: owner only`. `finance_reserve_movements` usa o próprio
`account_id` (ver acima).

## Lógica pura

Três módulos sem acesso a banco, testados isoladamente.

### `lib/finance/investments.ts`

```typescript
export type InvestmentProjection = {
  estimatedCurrentValue: number
  projectedAtMaturity: number | null  // null sem maturity_date
  annualRatePct: number               // taxa anual efetiva usada
}

export function calculateInvestmentProjection(
  investment: FinanceInvestment,
  today?: Date
): InvestmentProjection | null
```

- Retorna `null` — sem exceção, sem estimativa — quando `rate_type`,
  `rate_value` ou `start_date` faltam, ou quando `start_date` é futura.
- Taxa anual efetiva por `rate_type`: `fixed_annual` → `rate_value`;
  `pct_cdi` → `CDI_ANNUAL_PCT × rate_value / 100`; `ipca_plus` →
  `IPCA_ANNUAL_PCT + rate_value`.
- Juros compostos sobre anos decorridos: `principal × (1 + r)^t`, com `t` em
  anos de 365 dias, calculado em `TZDate` de `America/Sao_Paulo`.
- `projectedAtMaturity` usa `t` de `start_date` até `maturity_date`.

### `lib/finance/goals.ts`

```typescript
export type GoalStatus = {
  currentSaved: number
  requiredTotal: number
  remaining: number
  monthsRemaining: number | null
  monthlyRequired: number | null   // null sem target_date
  progressPct: number
}

export function calculateGoalStatus(goal, context): GoalStatus
```

- `currentSaved`: se `linked_reserve_id` estiver preenchido, o saldo daquela
  reserva; senão Σ saldos das reservas ativas do `kind` + Σ valor atual dos
  investimentos do `kind`. Valor do investimento = `current_value` informado,
  senão `estimatedCurrentValue`, senão `invested_amount`.
- `requiredTotal`: `manual` → `target_amount`. `auto` →
  `Σ projeções do mês corrente × months_of_expenses`.
- `monthlyRequired` = `remaining / monthsRemaining`, `null` sem `target_date`.
  `monthsRemaining` conta meses cheios até `target_date` em `TZDate`, mínimo 1
  quando a data ainda não passou (senão dividiria por zero no mês do prazo) e
  `0` quando já passou — nesse caso `monthlyRequired` vira o `remaining`
  inteiro, que é a leitura honesta de "vence agora".

### `lib/finance/suggestions.ts`

```typescript
export function calculateSuggestions(context: {
  periodMonth: string
  entries: FinanceEntry[]
  historicalEntries: FinanceEntry[]
  projections: FinanceProjection[]
  categories: CategoryNode[]
  tolerance: { projectionPct: number; historyPct: number }
  dismissals: FinanceSuggestionDismissal[]
}): Suggestion[]
```

Por categoria não essencial de despesa, nesta ordem:

1. Projeção definida no período → alerta se
   `realizado > projeção × (1 + projectionPct/100)`. `referenceType: 'projection'`.
2. Sem projeção, ≥ 2 meses distintos com gasto nos 3 anteriores → média desses
   meses; alerta se `realizado > média × (1 + historyPct/100)`.
   `referenceType: 'history_average'`.
3. Sem projeção e sem 2 meses → **nada**. Silêncio é melhor que um alerta sem base.

A média divide pelo número de meses **com movimento**, não por 3 fixo: uma
categoria que só aparece em 2 dos 3 meses teria a média artificialmente
derrubada por um zero que não é um "mês barato", é ausência de dado.

Categoria essencial nunca gera alerta, por mais que estoure. Alertas
descartados no `period_month` são filtrados no fim.

## Agente de WhatsApp

`interpret.ts` ganha cinco intenções na ferramenta que já existe — **sem
chamada extra de LLM por mensagem**, é o mesmo `registrar_intencao`:

| Intenção | Exemplo | Campos extraídos |
|----------|---------|------------------|
| `reserva_movimento` | "guardei 500 na reserva de emergência" | nome da reserva, valor, depósito/retirada |
| `investimento` | "investi 1000 no CDB do banco X, 110% do CDI" | nome, tipo, valor, `rate_type`, `rate_value` |
| `projecao` | "projeção de mercado esse mês é 800" | categoria (nome da árvore), valor, mês |
| `consulta_meta` | "quanto falta pra minha meta de viagem?" | nome da meta |
| `consulta_sugestoes` | "tenho algum gasto fora do esperado?" | — |

Resolução de nome:

- Reserva e meta: fuzzy match por `normalizeCategoryName()` (já existe, ignora
  acento e caixa) contra os registros da conta. Sem match em reserva, o agente
  **pergunta** se quer criar — não cria calado.
- Projeção: `resolveCategoryPair()`, o mesmo resolvedor dos lançamentos. Nome
  fora da árvore → `buildCategoryNotFoundMessage()`, que já existe.

`respond.ts` ganha um formatador por intenção, no tom já usado no módulo.

## Painel

```
app/(dashboard)/finance/
  layout.tsx           ← guard owner-only + módulo + nav das seções
  page.tsx             ← Lançamentos (já existe)
  reservas/page.tsx
  investimentos/page.tsx
  projecoes/page.tsx
  metas/page.tsx
  sugestoes/page.tsx
```

Componentes em `components/finance/`, seguindo o prefixo `Finance*` do
módulo: `FinanceSectionNav`, `FinanceReserveCard`, `FinanceReserveForm`,
`FinanceReserveMovementForm`, `FinanceInvestmentTable`, `FinanceInvestmentForm`,
`FinanceInvestmentProjectionBadge`, `FinanceProjectionGrid`, `FinanceGoalCard`,
`FinanceGoalForm`, `FinanceSuggestionCard`.

O toggle `is_essential` entra no `FinanceCategoryManager` que já existe — não
ganha tela própria.

O guard mora no `layout.tsx`: `session.role !== 'owner'` ou módulo inativo →
`redirect('/dashboard')`, idêntico ao `page.tsx` atual. Assim nenhuma aba nova
renderiza para admin/member, que é a terceira camada pedida (RLS, API, UI).

## API

Sob `app/api/finance/`, todas com o mesmo `guard()` de
`app/api/finance/entries/route.ts` (`requireWorkspaceSession` +
`requireModule('finance')` + `requireRole(['owner'])`), usando o client
autenticado de `lib/supabase/server.ts` — `createAdminClient` só no webhook.

| Rota | Métodos |
|------|---------|
| `reservas/route.ts` · `reservas/[id]/route.ts` | GET/POST · PATCH/DELETE |
| `reservas/[id]/movimentos/route.ts` | POST |
| `investimentos/route.ts` · `investimentos/[id]/route.ts` | GET/POST · PATCH/DELETE |
| `projecoes/route.ts` | GET/PUT (upsert por categoria+período) |
| `metas/route.ts` · `metas/[id]/route.ts` | GET/POST · PATCH/DELETE |
| `sugestoes/route.ts` | GET (derivado) |
| `sugestoes/dismiss/route.ts` | POST |
| `categorias/[id]/essencial` | via PATCH da rota de categorias já existente |

## Privacidade

Valor financeiro pessoal não vai para log, Sentry ou PostHog — mesma regra já
aplicada a `finance_entries`. Os logs novos registram no máximo o evento
("meta criada", "reserva movimentada"), nunca o montante nem o nome da
caixinha.

## Testes

Vitest, em `tests/finance/`:

- `investments.test.ts` — sem taxa → `null`; `fixed_annual`, `pct_cdi` e
  `ipca_plus` com `start_date` no passado; `maturity_date` presente e ausente;
  `start_date` futura → `null`.
- `goals.test.ts` — manual não recalcula a partir de projeção; auto recalcula;
  sem `target_date` → `monthlyRequired` null; meta vinculada a uma reserva
  ignora as outras.
- `suggestions.test.ts` — os três cenários (projeção, média histórica, sem
  base); categoria essencial estourada não gera alerta; alerta descartado some.
- `api-patrimonio.test.ts` — admin e member tomam 403 em todas as rotas novas.
- `interpret-patrimonio.test.ts` — as cinco intenções novas.

Ponta a ponta (manual, checklist do prompt): criar reserva no painel →
"guardei 100 na reserva X" no WhatsApp → saldo bate nos dois lados.

## Fora de escopo

- Cron proativo de sugestões (`/api/cron/finance-suggestions`) — nesta versão
  a sugestão só sai sob consulta.
- CDI/IPCA vindos de API externa; ficam em constante versionada.
- Rentabilidade real de renda variável/cripto (exige cotação); esses tipos
  contam com `current_value` informado à mão.
