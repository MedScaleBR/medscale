# Custos por cliente + filtro de período — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin/costs` ganha abas Geral | Por cliente, um filtro de período (7/30/90 dias, um dia ou intervalo) e o detalhe de custo de um cliente (funcionalidades, uso, por dia/hora, por unidade, métricas por conversa e por resposta da Clara).

**Architecture:** Toda a regra fica em funções puras testáveis (`lib/admin/cost-range.ts` para o período, `lib/costs/account-detail.ts` para a agregação do cliente), no mesmo padrão de `lib/costs/aggregate.ts` + `buildCostOverview`. As consultas continuam em `cost_events` com `fetchAllPages` e `MAX_EVENTS`. A página continua server component; só o seletor de período, o calendário e o gráfico são client components.

**Tech Stack:** Next.js 16 (App Router, `searchParams` é Promise), React, Supabase, Vitest (`environment: 'node'`; componentes testados com `renderToStaticMarkup`), Tailwind com tokens `--navy-*`/`--cyan*`, `recharts`, `date-fns`.

**Spec:** `docs/superpowers/specs/2026-11-12-custos-por-cliente-design.md`

## Global Constraints

- Nenhuma migration; nada muda em como `cost_events` é gravado.
- Nunca ler conteúdo de mensagem de paciente. Nada de consultar `messages`.
- Resposta da Clara = 1 linha `claude_agendamento`. Conversa = `related_id` distinto entre `claude_agendamento` e `whatsapp_conversation`.
- Por resposta da Clara = custo `claude_agendamento` ÷ respostas. Por conversa = (`claude_agendamento` + Whisper da Clara + `whatsapp_conversation`) ÷ conversas. Divisão por zero → `null`, exibido "—".
- Datas personalizadas são dias de São Paulo (`America/Sao_Paulo`): `from` 00:00 BRT, `to` 23:59:59.999 BRT. `days=N` continua "últimos N×24h".
- URL: `?days=7|30|90` ou `?from=YYYY-MM-DD&to=YYYY-MM-DD` (`from/to` vence). Inválido, invertido, no futuro ou > 366 dias → padrão 30 dias.
- Aba: `?tab=cliente&account=<uuid>`; ausente = Geral. Trocar de aba preserva o período.
- Cores: Claude `bg-[var(--navy-dark)]`, Whisper `bg-[var(--cyan)]`, WhatsApp `bg-[var(--navy)]/20` (o `GROUP_BAR` atual).
- `react-day-picker` não entra; calendário é componente próprio.
- Copy em pt-BR. Rótulos das funcionalidades (exatos): "Clara (agendamento)", "Clara — áudio", "Transcrição de consulta", "Prontuário (SOAP)", "Simulador da Clara", "Agente financeiro", "WhatsApp (Meta)". "Sem unidade" vem por último com "Clara antes de o paciente escolher a unidade".
- Testes rodam com `npx vitest run <arquivo>`; lint com `npx eslint <arquivos>` (não `npm run lint` — estoura memória).

## Review Focus

1. Evento às 23:30 BRT (02:30 UTC do dia seguinte) tem de cair no dia BRT certo no gráfico e no filtro `from/to` — teste na Task 1 e na Task 3.
2. `?from=2026-11-12&to=2026-11-03` (invertido), `from=2099-01-01`, `from=lixo` → cai em 30 dias sem quebrar a página — teste na Task 1.
3. Cliente da URL sem custo no período → "Nenhum custo deste cliente no período", sem trocar de cliente — teste na Task 6.
4. `/admin` (dashboard) e a fila continuam chamando `getCostOverview(supabase, 30)` e `getCostTotals(supabase, 30, now)` com o mesmo resultado — teste de regressão na Task 2.
5. Período de um dia só → gráfico por hora com 24 pontos (0–23), não por dia — teste na Task 3.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `lib/admin/cost-range.ts` (novo) | Interpretar a URL em um `CostWindow`, período anterior, atalhos do calendário, montar hrefs |
| `lib/admin/cost-alerts.ts` (mod) | `getCostOverview`/`getCostTotals` aceitam `number \| CostWindow` |
| `lib/admin/clara-cache-trend.ts` (mod) | `getClaraCacheTrend` aceita `number \| CostWindow` |
| `lib/costs/account-detail.ts` (novo) | Agregação pura do cliente: funcionalidades, uso, métricas, série, unidades |
| `lib/admin/account-cost-detail.ts` (novo) | Consulta `cost_events` de um cliente no período → `buildAccountCostDetail` |
| `lib/admin/calendar-grid.ts` (novo) | Grade de mês (semanas começando no domingo) e estado da seleção — puro |
| `components/admin/costs/CostPeriodPicker.tsx` (novo, client) | Botões 7/30/90 + botão do calendário + popover |
| `components/admin/costs/DateRangeCalendar.tsx` (novo, client) | Popover: atalhos, dois meses, rodapé Limpar/Aplicar |
| `components/admin/costs/AccountStrip.tsx` (novo) | Faixa de clientes estilo abas |
| `components/admin/costs/CostSeriesChart.tsx` (novo, client) | Barras empilhadas por dia/hora (recharts) |
| `components/admin/costs/AccountCostDetail.tsx` (novo) | Resumo, tabela de funcionalidades, gráfico, unidades |
| `components/admin/costs/CostsTabs.tsx` (novo) | Links Geral / Por cliente preservando o período |
| `app/(admin)/admin/costs/page.tsx` (mod) | Lê a URL, escolhe a aba, monta tudo |

---

### Task 1: Período a partir da URL

**Files:**
- Create: `lib/admin/cost-range.ts`
- Test: `tests/admin/cost-range.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MAX_CUSTOM_DAYS = 366
  export type CostWindow =
    | { kind: 'days'; days: number; since: string; until: null }
    | { kind: 'custom'; from: string; to: string; since: string; until: string }
  // since/until: ISO UTC. until exclusivo (= 00:00 BRT do dia seguinte a `to`).
  export function parseCostWindow(params: { days?: string; from?: string; to?: string }, now?: Date): CostWindow
  export function windowFromDays(days: number, now?: Date): CostWindow
  export function previousWindow(w: CostWindow, now?: Date): { since: string; until: string }
  export function windowDayCount(w: CostWindow): number   // days, ou to-from+1
  export function isSingleDay(w: CostWindow): boolean     // custom com from === to
  export function costWindowQuery(w: CostWindow): Record<string, string> // {days} ou {from,to}
  export type CalendarPreset = 'hoje' | 'ontem' | 'esta_semana' | 'este_mes' | 'mes_passado'
  export function presetRange(p: CalendarPreset, now?: Date): { from: string; to: string }
  ```
- Reuse `saoPauloDate` e `daysBetween` de `lib/admin/queue.ts`; `normalizeCostDays` de `lib/admin/cost-alerts.ts` para `days`.

- [ ] **Step 1: Write failing tests** em `tests/admin/cost-range.test.ts`, com `now = new Date('2026-11-12T15:00:00Z')` (12/11, quinta, 12:00 BRT):
  - `parseCostWindow({})` → `{ kind: 'days', days: 30 }`, `since` = now − 30×24h.
  - `parseCostWindow({ days: '7' })` → days 7. `{ days: '8' }` → 30.
  - `parseCostWindow({ from: '2026-11-03', to: '2026-11-11' })` → `since === '2026-11-03T03:00:00.000Z'`, `until === '2026-11-12T03:00:00.000Z'`.
  - Um dia: `{ from: '2026-11-11', to: '2026-11-11' }` → `isSingleDay` true, `windowDayCount` 1.
  - `from/to` vence `days`: `{ days: '7', from: '2026-11-03', to: '2026-11-04' }` → kind `custom`.
  - Invertido `{ from: '2026-11-12', to: '2026-11-03' }`, futuro `{ from: '2026-11-13', to: '2026-11-13' }`, lixo `{ from: 'x', to: 'y' }`, só `from`, e > 366 dias (`from: '2025-01-01', to: '2026-11-12'`) → todos `kind: 'days', days: 30`.
  - `to` = hoje é válido.
  - `previousWindow` de custom 03–11/11 → `{ since: '2026-10-25T03:00:00.000Z', until: '2026-11-03T03:00:00.000Z' }`; de days 7 → [now−14d, now−7d).
  - `presetRange`: hoje `11-12/11-12`, ontem `11-11/11-11`, esta_semana `2026-11-08`→`2026-11-12` (domingo), este_mes `2026-11-01`→`2026-11-12`, mes_passado `2026-10-01`→`2026-10-31`.
  - `costWindowQuery` → `{ days: '30' }` ou `{ from, to }`.

- [ ] **Step 2:** `npx vitest run tests/admin/cost-range.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3: Implement** `lib/admin/cost-range.ts`. 00:00 BRT de `YYYY-MM-DD` = `Date.parse(`${d}T03:00:00Z`)` (BRT é UTC−3 fixo, sem horário de verão desde 2019). Validar formato com `/^\d{4}-\d{2}-\d{2}$/` e checar que a data existe (`toISOString().slice(0,10) === d`).
- [ ] **Step 4:** `npx vitest run tests/admin/cost-range.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(admin): período de custos a partir da URL (dias, um dia ou intervalo)`.

---

### Task 2: Consultas do painel aceitam o período

**Files:**
- Modify: `lib/admin/cost-alerts.ts` (`getCostOverview`, `getCostTotals`, `buildCostOverview`, interface `CostOverview`)
- Modify: `lib/admin/clara-cache-trend.ts` (`getClaraCacheTrend`)
- Test: `tests/admin/cost-alerts.test.ts`, `tests/admin/clara-cache-trend.test.ts`

**Interfaces:**
- Consumes: `CostWindow`, `windowFromDays`, `previousWindow`, `windowDayCount` (Task 1).
- Produces:
  ```ts
  getCostOverview(supabase, period: number | CostWindow = DEFAULT_COST_DAYS, now?: Date): Promise<CostOverview>
  getCostTotals(supabase, period: number | CostWindow, now?: Date): Promise<CostPeriodTotals>
  getClaraCacheTrend(supabase, period: number | CostWindow, now?: Date): Promise<ClaraCacheTrend>
  // CostOverview ganha: window: CostWindow  (days continua = windowDayCount(window))
  buildCostOverview({ events, previousEvents, window, now, truncated?, error? })  // `days` sai, `window` entra
  ```
  Número é convertido com `windowFromDays(n, now)`. Quando `window.until` não é null, todas as consultas ganham `.lt('created_at', until)`; o período anterior usa `previousWindow`.

- [ ] **Step 1: Write failing tests.** Nos testes existentes de `buildCostOverview`, troque `days: 30` por `window: windowFromDays(30, now)` e assegure `overview.days === 30` e `overview.since` igual ao de antes (regressão do Review Focus 4). Adicione: com `window` custom de 1 dia, `overview.days === 1`. Para as funções `get*`, use o padrão de mock de supabase já usado em `tests/admin/clara-cache-trend.test.ts`/`queue.test.ts` e verifique que, com `CostWindow` custom, a consulta recebe `gte('created_at', since)` e `lt('created_at', until)`; com número, não recebe `lt` no período atual.
- [ ] **Step 2:** `npx vitest run tests/admin/cost-alerts.test.ts tests/admin/clara-cache-trend.test.ts` → FAIL.
- [ ] **Step 3: Implement** as mudanças acima. Os chamadores atuais (`app/(admin)/admin/page.tsx`, `lib/admin/queue.ts`, `lib/admin/dashboard.ts`) passam número e não mudam.
- [ ] **Step 4:** `npx vitest run tests/admin` → PASS (todos, inclusive queue e dashboard).
- [ ] **Step 5: Commit** `feat(admin): consultas de custo aceitam intervalo personalizado`.

---

### Task 3: Agregação do cliente

**Files:**
- Create: `lib/costs/account-detail.ts`
- Test: `tests/costs/account-detail.test.ts`

**Interfaces:**
- Consumes: `whisperSourceOf`, `PROVIDER_GROUP`, `NO_UNIT_LABEL`, `ProviderGroup` de `lib/costs/aggregate.ts`; `CostWindow`, `isSingleDay` (Task 1); `saoPauloDate` de `lib/admin/queue.ts`.
- Produces:
  ```ts
  export type CostFeature = 'clara' | 'clara_audio' | 'consulta' | 'soap' | 'simulador' | 'financeiro' | 'whatsapp'
  export const COST_FEATURE_LABELS: Record<CostFeature, string>   // rótulos exatos das Global Constraints
  export const COST_FEATURE_GROUP: Record<CostFeature, ProviderGroup>
  export function featureOf(row: Pick<AccountCostRow, 'provider' | 'related_id'>): CostFeature

  export interface AccountCostRow {
    provider: CostProvider; cost_brl: number | string; workspace_id: string | null
    related_id: string | null; quantity: number | string | null; created_at: string
    workspaces?: { name: string } | null
  }
  export interface FeatureUsage {
    feature: CostFeature; cost: number; share: number   // share = cost / total do escopo
    events: number          // linhas
    conversations: number   // related_id distintos (clara, whatsapp); 0 nos demais
    minutes: number         // Σquantity/60 (clara_audio, consulta); 0 nos demais
  }
  export interface SeriesPoint { key: string; label: string; claude: number; whisper: number; whatsapp: number; total: number }
  export interface UnitDetail { workspaceId: string | null; name: string; total: number; features: FeatureUsage[] }
  export interface AccountCostDetail {
    total: number; perDay: number | null; perConversation: number | null; perClaraResponse: number | null
    claraResponses: number; conversations: number
    features: FeatureUsage[]                 // custo > 0, desc
    series: { mode: 'day' | 'hour'; points: SeriesPoint[] }
    units: UnitDetail[]                      // desc; "Sem unidade" por último
  }
  export function buildAccountCostDetail(rows: AccountCostRow[], window: CostWindow, now?: Date): AccountCostDetail
  ```
  Uso exibido por feature (montado na view, Task 6): clara "N conversas · N respostas"; clara_audio "N áudios · N min"; consulta "N consultas · N min"; soap "N prontuários"; simulador "N respostas"; financeiro "N chamadas"; whatsapp "N janelas de 24h".

- [ ] **Step 1: Write failing tests** em `tests/costs/account-detail.test.ts`:
  - `featureOf`: whisper sem related_id → `clara_audio`; com → `consulta`; cada provider no seu feature.
  - Totais e métricas: 4 linhas `claude_agendamento` (R$ 1 cada, conversas c1,c1,c2,c2), 1 whisper clara R$ 0,50, 1 `whatsapp_conversation` c3 R$ 0,50, 1 `claude_soap` R$ 5 → `total 11`, `claraResponses 4`, `conversations 3`, `perClaraResponse 1`, `perConversation 5/3`, soap fora do por-conversa.
  - Sem `claude_agendamento` → `perClaraResponse null`; sem conversas → `perConversation null`.
  - `perDay = total / windowDayCount(window)`.
  - Minutos: whisper `quantity: '90.00'` + `30` → `minutes 2`.
  - Série por dia em window custom 03–05/11: 3 pontos `key` `2026-11-03..05`, inclusive dia vazio com zeros; evento `2026-11-04T02:30:00Z` (23:30 BRT de 03/11) cai em `2026-11-03` (Review Focus 1). Em window `days`, pontos do primeiro ao último dia BRT do intervalo.
  - Série por hora em window de um dia: 24 pontos, `key` `'00'..'23'`; evento `2026-11-11T13:10:00Z` soma na hora `'10'` (Review Focus 5).
  - Agrupamento por cor na série: soap soma em `claude`, consulta em `whisper`.
  - Unidades: linha com `workspace_id null` → bloco `NO_UNIT_LABEL` sempre por último mesmo sendo o mais caro; cada bloco com suas próprias `features` e `share` relativo ao total da unidade.
  - `rows` vazio → total 0, features `[]`, units `[]`, série com pontos zerados.
- [ ] **Step 2:** `npx vitest run tests/costs/account-detail.test.ts` → FAIL.
- [ ] **Step 3: Implement** `lib/costs/account-detail.ts`. Hora BRT: `new Date(iso).toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' })`. `label` do dia: `dd/MM`; da hora: `HHh`.
- [ ] **Step 4:** `npx vitest run tests/costs` → PASS.
- [ ] **Step 5: Commit** `feat(costs): agregação de custo e uso por cliente`.

---

### Task 4: Consulta do cliente

**Files:**
- Create: `lib/admin/account-cost-detail.ts`
- Test: `tests/admin/account-cost-detail.test.ts`

**Interfaces:**
- Consumes: `buildAccountCostDetail`, `AccountCostRow` (Task 3); `CostWindow` (Task 1); `fetchAllPages`; `MAX_EVENTS`.
- Produces:
  ```ts
  export interface AccountCostDetailResult { detail: AccountCostDetail; truncated: boolean; error: string | null }
  export async function getAccountCostDetail(supabase, accountId: string, window: CostWindow, now?: Date): Promise<AccountCostDetailResult>
  ```
  Select: `provider, cost_brl, workspace_id, related_id, quantity, created_at, workspaces(name)`, `.eq('account_id', accountId)`, `.gte('created_at', since)`, `.lt('created_at', until)` quando houver, `.order('created_at').order('id')`.

- [ ] **Step 1: Write failing test** com supabase mockado (mesmo padrão dos testes de Task 2): filtra pelo `account_id` certo, aplica `lt` só em custom, repassa `truncated`/`error` de `fetchAllPages`.
- [ ] **Step 2:** `npx vitest run tests/admin/account-cost-detail.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(admin): consulta de custos de um cliente`.

---

### Task 5: Seletor de período e calendário

**Files:**
- Create: `lib/admin/calendar-grid.ts`, `components/admin/costs/DateRangeCalendar.tsx`, `components/admin/costs/CostPeriodPicker.tsx`
- Test: `tests/admin/calendar-grid.test.ts`, `tests/admin/cost-period-picker.test.tsx`

**Interfaces:**
- Consumes: `CostWindow`, `presetRange`, `CalendarPreset`, `MAX_CUSTOM_DAYS`, `costWindowQuery` (Task 1); `date-fns` (locale `ptBR`).
- Produces:
  ```ts
  // calendar-grid.ts (puro)
  export function monthGrid(year: number, month0: number): (string | null)[][]  // semanas D..S, YYYY-MM-DD ou null fora do mês
  export type RangeDraft = { start: string | null; end: string | null }
  export function clickDay(draft: RangeDraft, day: string): RangeDraft
  // 1º clique: {day,null}; 2º: ordena start/end; 3º: recomeça {day,null}
  export function draftToRange(d: RangeDraft): { from: string; to: string } | null  // start sozinho = um dia
  export function dayState(day: string, d: RangeDraft, today: string): 'start' | 'end' | 'single' | 'in' | 'future' | 'today' | 'normal'
  export function draftTooLong(d: RangeDraft): boolean   // > MAX_CUSTOM_DAYS

  // CostPeriodPicker.tsx ('use client')
  export function CostPeriodPicker(props: { window: CostWindow; basePath: string; extraQuery: Record<string, string>; today: string }): JSX.Element
  ```
  O picker navega com `useRouter().push` montando `basePath?` + `extraQuery` (tab/account) + `costWindowQuery`. Visual exatamente o do esboço aprovado `.superpowers/brainstorm/295-1794530363/content/datas-v1.html`: botões `7 dias`·`30 dias`·`90 dias`; botão `📅 dd/MM` ou `📅 dd/MM – dd/MM` (ou "Escolher dia" quando o período é `days`), com borda ciano e fundo ciano claro quando ativo; popover com atalhos à esquerda (Hoje, Ontem, Esta semana, Este mês, Mês passado), dois meses (mês do `to` e o anterior) com ‹ ›, início/fim navy, miolo ciano claro, hoje com contorno ciano, futuros desabilitados; rodapé "3 nov – 11 nov · 9 dias", Limpar e Aplicar (desabilitado sem seleção ou com `draftTooLong`). Fecha com Esc e clique fora. Atalho aplica direto.

- [ ] **Step 1: Write failing tests:**
  - `monthGrid(2026, 10)` (novembro): primeira semana `['2026-11-01', ...]` (1/11/2026 é domingo), última termina com `'2026-11-30'` e `null`s.
  - `clickDay`: sequência 11 → 03 dá `{start:'2026-11-03', end:'2026-11-11'}`; terceiro clique recomeça.
  - `draftToRange({start:'2026-11-11', end:null})` → `{from:'2026-11-11', to:'2026-11-11'}`.
  - `dayState`: futuro → `future`; hoje → `today`; dentro → `in`.
  - `cost-period-picker.test.tsx` com `renderToStaticMarkup` (mockando `next/navigation` com `vi.mock`): `days 30` marca `30 dias` com `aria-current="page"`; window custom 03–11/11 mostra `03/11 – 11/11`; um dia mostra `11/11`.
- [ ] **Step 2:** `npx vitest run tests/admin/calendar-grid.test.ts tests/admin/cost-period-picker.test.tsx` → FAIL.
- [ ] **Step 3: Implement** os três arquivos.
- [ ] **Step 4:** → PASS; `npx eslint lib/admin/calendar-grid.ts components/admin/costs` sem erros.
- [ ] **Step 5: Commit** `feat(admin): seletor de período com calendário de dia e intervalo`.

---

### Task 6: Aba "Por cliente"

**Files:**
- Create: `components/admin/costs/AccountStrip.tsx`, `components/admin/costs/CostSeriesChart.tsx`, `components/admin/costs/AccountCostDetail.tsx`
- Test: `tests/admin/account-cost-detail-view.test.tsx`

**Interfaces:**
- Consumes: `AccountCostDetail`, `FeatureUsage`, `COST_FEATURE_LABELS`, `COST_FEATURE_GROUP` (Task 3); `CostOverviewAccount` (`lib/admin/cost-alerts.ts`); `formatBRL` (`lib/finance/summary`).
- Produces:
  ```ts
  export function AccountStrip(props: { accounts: { accountId: string; name: string; total: number }[]; selectedId: string | null; hrefFor: (accountId: string) => string }): JSX.Element
  export function CostSeriesChart(props: { mode: 'day' | 'hour'; points: SeriesPoint[] }): JSX.Element  // 'use client', recharts
  export function AccountCostDetailView(props: { name: string; detail: AccountCostDetail | null; truncated: boolean; error: string | null }): JSX.Element
  export function featureUsageText(u: FeatureUsage): string   // textos de uso da Task 3
  ```
  `AccountStrip`: faixa `bg-[var(--navy-dark)]` com rolagem horizontal; chip = círculo com inicial (cor escolhida por hash estável do `accountId` numa lista fixa de 6 cores), nome truncado, custo; selecionado `bg-white/15 text-white` e `aria-current="page"`; cada chip é `<Link>`. `AccountCostDetailView`: 4 cards (Total, Por conversa, Por mensagem da Clara, Média por dia — `null` → "—"), tabela de funcionalidades (Funcionalidade · Uso · Custo · %), seção "Por dia"/"Por hora" com `CostSeriesChart` e legenda das 3 cores, seção "Por unidade" com um bloco por unidade (nome, total, tabela Uso · Custo). `detail.total === 0` → "Nenhum custo deste cliente no período". `truncated` → mesmo aviso de valores subestimados do painel.

- [ ] **Step 1: Write failing tests** (`renderToStaticMarkup`, normalizando o espaço não separável como em `clara-cache-trend-section.test.tsx`; mock de `recharts` não é necessário se `CostSeriesChart` renderizar o `ResponsiveContainer` sem dados de layout — se quebrar, `vi.mock('@/components/admin/costs/CostSeriesChart', () => ({ CostSeriesChart: () => null }))`):
  - `featureUsageText`: clara 3 conversas/4 eventos → "3 conversas · 4 respostas"; consulta 2 eventos/22,7 min → "2 consultas · 22,7 min"; whatsapp 1 → "1 janela de 24h" (singular).
  - View com detail do teste "Totais e métricas" da Task 3 mostra "R$ 11,00", "Prontuário (SOAP)" e "Por mensagem da Clara".
  - `perConversation null` → "—".
  - `detail` com total 0 → "Nenhum custo deste cliente no período" (Review Focus 3).
  - Unidades: "Sem unidade" aparece depois das demais e com "Clara antes de o paciente escolher a unidade".
  - `AccountStrip` marca o selecionado com `aria-current="page"`.
- [ ] **Step 2:** `npx vitest run tests/admin/account-cost-detail-view.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** → PASS; eslint nos novos arquivos.
- [ ] **Step 5: Commit** `feat(admin): detalhe de custo por cliente`.

---

### Task 7: Página com abas

**Files:**
- Create: `components/admin/costs/CostsTabs.tsx`
- Modify: `app/(admin)/admin/costs/page.tsx`

**Interfaces:**
- Consumes: tudo acima.
- Produces:
  ```ts
  export function CostsTabs(props: { active: 'geral' | 'cliente'; periodQuery: Record<string, string> }): JSX.Element
  ```
  Página: `searchParams: Promise<{ days?, from?, to?, tab?, account? }>`. `window = parseCostWindow(params)`. Sempre `getCostOverview(supabase, window)` (dá a faixa de clientes e a aba Geral). Aba Geral: o conteúdo de hoje, com o `nav` de períodos trocado por `CostPeriodPicker`, `getClaraCacheTrend(supabase, window)` e o texto "vs. período anterior" no lugar de "vs. N dias anteriores" quando custom. Aba cliente: `account` da URL ou, se ausente, `overview.accounts[0]`; se não houver nenhum cliente no período, a mensagem vazia atual; `getAccountCostDetail(supabase, accountId, window)` só nessa aba; nome vem de `overview.accounts` ou, se o cliente não tiver custo no período, de `accounts.name` por id. Os nomes de cliente na aba Geral passam a linkar para `?tab=cliente&account=<id>` mantendo o período (antes: `/admin/accounts/<id>`).

- [ ] **Step 1: Implement** `CostsTabs` e a página.
- [ ] **Step 2: Verify:** `npx tsc --noEmit -p .` sem erros nos arquivos tocados; `npx eslint "app/(admin)/admin/costs/page.tsx" components/admin/costs lib/admin lib/costs`; `npx vitest run tests/admin tests/costs` → PASS.
- [ ] **Step 3: Verify no navegador** (`npm run dev`, logado como admin): Geral com 7/30/90 e com um intervalo; Por cliente trocando de cliente na faixa; um dia só mostra gráfico por hora; URL com `from` inválido cai em 30 dias; trocar de aba mantém o período.
- [ ] **Step 4: Commit** `feat(admin): abas Geral e Por cliente no painel de custos`.
