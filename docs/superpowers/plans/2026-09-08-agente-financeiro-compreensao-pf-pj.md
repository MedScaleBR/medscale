# Agente financeiro — compreensão de texto livre + PF/PJ automático — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O agente financeiro do WhatsApp entende texto livre (vários gastos numa mensagem, valor faltando), pergunta PF/PJ quando é ambíguo em vez de chutar, e responde nos dead-ends apontando o próximo passo — mantendo o tom sério.

**Architecture:** O interpretador (`interpret.ts`, Opus) passa a devolver `lancamentos[]` — um item por gasto/receita. O agente (`agent.ts`) drena essa fila: cada item que precisa de resposta do owner (tipo ambíguo, valor faltando, unidade PJ) estaciona o lote num único registro `finance_sessions.pending_entry` (`kind: 'entry_batch'`, `awaiting: 'type' | 'amount' | 'unit'`) e pergunta; o que já estava pronto é gravado e confirmado antes. Um handler de retomada consome a resposta e continua drenando. Substitui o fluxo `choose_workspace` de hoje; `handlePendingPaymentConfirm` fica intocado. Sem migração — `pending_entry` é `jsonb`.

**Tech Stack:** TypeScript, Next.js, `@anthropic-ai/sdk`, Supabase (via `createAdminClient`), Vitest. Testes em `tests/finance/`, com `tests/helpers/agent-harness.ts` e `tests/helpers/supabase-mock.ts`.

**Spec:** `docs/superpowers/specs/2026-09-08-agente-financeiro-compreensao-pf-pj-design.md`

## Global Constraints

- **Modelo do interpretador:** `interpretMessage` continua em `claude-opus-5`. Não trocar.
- **Modelo da categorização:** `categorizeEntry` continua em `claude-sonnet-4-5`. Não trocar.
- **Copy determinística (sem chamada de LLM):** `buildUnknownMessage`, `buildChooseTypeMessage`, `buildAskAmountMessage`, `buildBatchConfirmationMessage`, `buildChooseWorkspaceMessage`.
- **Tom da copy:** sério, profissional; sem markdown; no máximo 1 emoji por mensagem; valores no formato `R$ X.XXX,XX` via `formatBRL` (pt-BR). Todo texto em português.
- **`handlePendingPaymentConfirm` e o fluxo de `confirm_payment` não mudam.** Nenhuma alteração em rotas web / API / env vars.
- **Sem migração de banco.** `finance_sessions.pending_entry` é `jsonb`.
- **TTL da pendência:** `PENDING_TTL_MS` (30 min) inalterado.
- **`NEGATIVE` / `AFFIRMATIVE`:** regex já existentes em `agent.ts`, reutilizar.
- **Comando de teste:** `npx vitest run <caminho>` (ou `npm test` para tudo).

---

## File Structure

| Arquivo | Responsabilidade | Tasks |
|---|---|---|
| `lib/finance/types.ts` | `EntryDraft`; `FinanceIntent.entry` vira `{ entries: EntryDraft[] }` | 1 |
| `lib/finance/interpret.ts` | Tool `registrar_intencao` com `lancamentos[]`; prompt (multi-entry, buckets PF/PJ); `toIntent` iterando itens | 1, 3, 4, 5 |
| `lib/finance/parser.ts` | Atalho `/pf …` embrulha o hit em `entries: [draft]` | 1 |
| `lib/finance/agent.ts` | `persistEntry` extraído; `drainEntryQueue`; `entry_batch` + `handlePendingEntryBatch` (remove `handlePendingChooseWorkspace`) | 1, 2 |
| `lib/finance/respond.ts` | `buildChooseTypeMessage`, `buildAskAmountMessage`, `buildBatchConfirmationMessage`, `parseEntryType`; `buildUnknownMessage` reescrito; linha nova no `SYSTEM` | 2, 6 |
| `tests/finance/interpret.test.ts` | Shape `lancamentos[]`; multi-item; `tipo: null`; `valor: null`; prompt | 1, 3, 4, 5 |
| `tests/finance/parser.test.ts` | Atalho devolve `entries: [one]` | 1 |
| `tests/finance/agent-category.test.ts` | Intents migrados para `entries: []` | 1 |
| `tests/finance/agent-entry-batch.test.ts` | **Novo** — drain, park, resume, batch confirm, migração choose_workspace | 2 |
| `tests/finance/entry-type-parse.test.ts` | **Novo** — `parseEntryType` puro | 2 |
| `tests/finance/respond.test.ts` | `buildUnknownMessage` novo texto | 6 |

`lib/finance/categorize.ts` **não muda** — é chamado por draft dentro do laço.

---

## Task 1: Interface — `lancamentos[]` no interpretador, `EntryDraft` no intent

Muda só a **forma** dos dados. Comportamento idêntico ao de hoje: 1 lançamento por mensagem, `tipo` nulo vira `pf`, mensagem sem valor claro vira `unknown`. Nenhuma pergunta nova.

**Files:**
- Modify: `lib/finance/types.ts`
- Modify: `lib/finance/interpret.ts`
- Modify: `lib/finance/parser.ts`
- Modify: `lib/finance/agent.ts:298-353` (laço em volta do corpo de registro)
- Test: `tests/finance/interpret.test.ts`, `tests/finance/parser.test.ts`, `tests/finance/agent-category.test.ts`

**Interfaces:**
- Produces:
  - `EntryDraft` (em `lib/finance/types.ts`):
    ```ts
    export interface EntryDraft {
      type: FinanceEntryType | null
      direction: 'in' | 'out'
      description: string | null
      amount: number | null
      category: string | null
      subcategory: string | null
      workspaceHint: string | null
    }
    ```
  - `FinanceIntent` variante `entry` agora: `{ kind: 'entry'; entries: EntryDraft[] }` (array sempre com ≥ 1 item quando `kind === 'entry'`).
  - `interpretMessage(messageText, today, tree)` e `parseCommand(raw)` continuam devolvendo `FinanceIntent`; a variante `entry` tem o novo shape.

- [ ] **Step 1: Escrever o teste que falha — `toIntent` devolve `entries[]`**

Em `tests/finance/interpret.test.ts`, o helper `toolResponse` hoje monta um objeto plano. Trocar `BASE_INPUT` e `toolResponse` para o shape novo e ajustar as asserts para olhar `intent.entries[0]`:

```ts
interface LancamentoItem {
  tipo: 'pf' | 'pj' | null
  descricao: string | null
  valor: number | null
  categoria: string | null
  subcategoria: string | null
  unidade: string | null
  direcao: 'entrada' | 'saida' | null
}

interface ToolInput {
  intencao: 'lancamento' | 'consulta' | 'confirmar_pagamento' | 'desfazer' | 'ajuda' | 'conversa' | 'desconhecido'
  lancamentos: LancamentoItem[]
  tipo: 'pf' | 'pj' | null
  categoria: string | null
  subcategoria: string | null
  unidade: string | null
  direcao: 'entrada' | 'saida' | null
  mes: string | null
  paciente: string | null
  horario: string | null
  forma_pagamento: string | null
}

const ITEM: LancamentoItem = {
  tipo: 'pf', descricao: 'Mercado', valor: 50,
  categoria: null, subcategoria: null, unidade: null, direcao: 'saida',
}

const BASE_INPUT: ToolInput = {
  intencao: 'lancamento',
  lancamentos: [ { ...ITEM } ],
  tipo: null, categoria: null, subcategoria: null, unidade: null, direcao: null,
  mes: null, paciente: null, horario: null, forma_pagamento: null,
}

function toolResponse(overrides: Partial<ToolInput>) {
  return {
    content: [{ type: 'tool_use', id: 't1', name: 'registrar_intencao', input: { ...BASE_INPUT, ...overrides } }],
  }
}
```

Adicionar um teste novo no bloco `describe('interpretMessage — direction'`:

```ts
it('lancamento vira entry com um item em entries[]', async () => {
  createMock.mockResolvedValue(
    toolResponse({ lancamentos: [{ ...ITEM, descricao: 'Mercado', valor: 50, direcao: 'saida' }] })
  )
  const intent = await interpretMessage('gastei 50 no mercado', '2026-09-04', TREE)
  expect(intent).toMatchObject({ kind: 'entry' })
  if (intent.kind !== 'entry') throw new Error('esperava entry')
  expect(intent.entries).toHaveLength(1)
  expect(intent.entries[0]).toMatchObject({ type: 'pf', direction: 'out', amount: 50, description: 'Mercado' })
})
```

Ajustar os testes existentes desse bloco que hoje fazem `expect(intent).toMatchObject({ kind: 'entry', direction: 'in', amount: 3000 })` para `expect(intent.entries[0]).toMatchObject({ direction: 'in', amount: 3000 })` (com o guard `if (intent.kind !== 'entry') throw`). Os testes de `consulta` e `confirmar_pagamento` **não mudam** (leem do topo).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/finance/interpret.test.ts`
Expected: FAIL — `toIntent` ainda lê `input.tipo`/`input.valor` do topo; `intent.entries` é `undefined`.

- [ ] **Step 3: `types.ts` — `EntryDraft` + `FinanceIntent.entry`**

Em `lib/finance/types.ts`, adicionar `EntryDraft` (bloco acima) e trocar a variante `entry` da união `FinanceIntent`:

```ts
export type FinanceIntent =
  | { kind: 'entry'; entries: EntryDraft[] }
  | { kind: 'query'; type: FinanceEntryType | null; direction: 'in' | 'out'; category: string | null; subcategory: string | null; month: string | null; workspace: string | null }
  | { kind: 'confirm_payment'; patient: string | null; time: string | null; method: RevenuePaymentMethod | null }
  | { kind: 'undo' }
  | { kind: 'help' }
  | { kind: 'smalltalk'; raw: string }
  | { kind: 'unknown'; raw: string }
```

Remover o comentário antigo sobre `category`/`subcategory`/`workspaceHint` da variante velha e recolocá-lo em `EntryDraft` (uma linha por campo).

- [ ] **Step 4: `interpret.ts` — tool schema com `lancamentos[]`**

Em `lib/finance/interpret.ts`, antes de `INTENT_TOOL`, definir o item:

```ts
const LANCAMENTO_ITEM = {
  type: 'object' as const,
  properties: {
    tipo: {
      anyOf: [{ type: 'string', enum: ['pf', 'pj'] }, { type: 'null' }],
      description: 'pf = gasto/receita pessoal do médico. pj = da clínica. null quando a mensagem não deixa claro.',
    },
    descricao: { type: ['string', 'null'], description: 'O que foi comprado/recebido, curto (ex: "Netflix", "Aluguel"). null se não der.' },
    valor: { type: ['number', 'null'], description: 'Valor em reais, positivo. null quando a mensagem não traz um número claro.' },
    categoria: { type: ['string', 'null'], description: 'A categoria EXATA da lista fornecida para o tipo/direção do item. null se não der.' },
    subcategoria: { type: ['string', 'null'], description: 'A subcategoria EXATA da árvore, quando fizer sentido. null se não houver.' },
    unidade: { type: ['string', 'null'], description: 'Nome (ou trecho) da unidade/clínica, se o médico citar. null se não citar.' },
    direcao: {
      anyOf: [{ type: 'string', enum: ['entrada', 'saida'] }, { type: 'null' }],
      description: 'entrada = o médico RECEBEU dinheiro. saida = o médico GASTOU. null é tratado como saida.',
    },
  },
  required: ['tipo', 'descricao', 'valor', 'categoria', 'subcategoria', 'unidade', 'direcao'],
  additionalProperties: false,
}
```

Reescrever `INTENT_TOOL.input_schema.properties` para: manter `intencao`; adicionar `lancamentos`; manter `tipo`, `categoria`, `subcategoria`, `unidade`, `direcao`, `mes`, `paciente`, `horario`, `forma_pagamento` **no topo** (são o que `consulta`/`confirmar_pagamento` leem). Ajustar as descrições do topo para dizer "Em consulta:" / "Em confirmar_pagamento:".

```ts
      lancamentos: {
        type: 'array',
        items: LANCAMENTO_ITEM,
        description:
          'Em intencao "lancamento": um item para cada gasto ou receita citado na ' +
          'mensagem (pode ser mais de um). Vazio ([]) em qualquer outra intenção.',
      },
```

`required` do topo passa a ser:
```ts
required: [
  'intencao', 'lancamentos',
  'tipo', 'categoria', 'subcategoria', 'unidade', 'direcao',
  'mes', 'paciente', 'horario', 'forma_pagamento',
],
```

- [ ] **Step 5: `interpret.ts` — tipos e `toIntent`**

Trocar `IntentToolInput`:

```ts
type LancamentoItem = {
  tipo: FinanceEntryType | null
  descricao: string | null
  valor: number | null
  categoria: string | null
  subcategoria: string | null
  unidade: string | null
  direcao: 'entrada' | 'saida' | null
}

type IntentToolInput = {
  intencao: 'lancamento' | 'consulta' | 'confirmar_pagamento' | 'desfazer' | 'ajuda' | 'conversa' | 'desconhecido'
  lancamentos: LancamentoItem[]
  tipo: FinanceEntryType | null
  categoria: string | null
  subcategoria: string | null
  unidade: string | null
  direcao: 'entrada' | 'saida' | null
  mes: string | null
  paciente: string | null
  horario: string | null
  forma_pagamento: PaymentMethodValue | null
}
```

`toIntent` — só o `case 'lancamento'` muda. `case 'consulta'` e `case 'confirmar_pagamento'` passam a ler `input.tipo` / `input.categoria` / `input.subcategoria` / `input.unidade` / `input.direcao` do topo (já era assim — os nomes não mudaram):

```ts
    case 'lancamento': {
      const drafts: EntryDraft[] = []
      for (const item of input.lancamentos) {
        // Task 1: comportamento de hoje — sem número claro, a mensagem inteira é unknown.
        if (typeof item.valor !== 'number' || !isFinite(item.valor) || item.valor <= 0) {
          return { kind: 'unknown', raw }
        }
        drafts.push({
          // Sem tipo explícito, PF é o padrão menos danoso (gasto pessoal é o caso comum).
          type: item.tipo ?? 'pf',
          direction: item.direcao === 'entrada' ? 'in' : 'out',
          description: item.descricao?.trim() || null,
          amount: item.valor,
          category: item.categoria?.trim() || null,
          subcategory: item.subcategoria?.trim() || null,
          // Só PJ pertence a uma unidade; PF ignora esse campo mais adiante.
          workspaceHint: item.unidade?.trim() || null,
        })
      }
      if (drafts.length === 0) return { kind: 'unknown', raw }
      return { kind: 'entry', entries: drafts }
    }
```

Importar `EntryDraft` de `./types` no topo do arquivo.

- [ ] **Step 6: Rodar o teste do interpretador**

Run: `npx vitest run tests/finance/interpret.test.ts`
Expected: PASS.

- [ ] **Step 7: `parser.ts` — embrulhar o atalho**

Em `lib/finance/parser.ts`, no ramo `entryMatch`, trocar o `return { kind: 'entry', type, direction, description, amount, category: null, subcategory: null, workspaceHint: null }` por:

```ts
        return {
          kind: 'entry',
          entries: [
            {
              type,
              direction,
              description: descRaw.length > 0 ? descRaw : null,
              amount,
              category: null,
              subcategory: null,
              workspaceHint: null,
            },
          ],
        }
```

- [ ] **Step 8: `parser.test.ts` — asserts no novo shape**

Nos testes que hoje fazem `expect(parseCommand('/pf Netflix 35')).toEqual({ kind: 'entry', type: 'pf', ... })`, trocar para:

```ts
it('/pf Netflix 35 → entry com um item', () => {
  const intent = parseCommand('/pf Netflix 35')
  expect(intent).toMatchObject({ kind: 'entry' })
  if (intent.kind !== 'entry') throw new Error('esperava entry')
  expect(intent.entries).toEqual([
    { type: 'pf', direction: 'out', description: 'Netflix', amount: 35, category: null, subcategory: null, workspaceHint: null },
  ])
})
```

Aplicar o mesmo ajuste (`.entries[0]`) aos outros casos de `entry` do arquivo (`/pj`, `/pf+`, `/pj+`, `/pf 35`). Casos `query`/`help`/`undo`/`unknown` não mudam.

- [ ] **Step 9: `agent.ts` — laço em volta do corpo de registro**

Em `lib/finance/agent.ts`, dentro de `processFinancialMessage`, o trecho que hoje vai da linha ~298 (`// 4. Categorizar.`) até a chamada de `persistEntryAndConfirm` (~353) assume um `intent` único. Envolver em `for (const draft of intent.entries) { … }`, trocando `intent.type` → `draft.type`, `intent.description` → `draft.description`, `intent.amount` → `draft.amount`, `intent.category` → `draft.category`, `intent.subcategory` → `draft.subcategory`, `intent.workspaceHint` → `draft.workspaceHint`. Onde o tipo exige não-nulo, usar `draft.type as FinanceEntryType` e `draft.amount as number` (nesta task `toIntent` nunca emite null; a Task 2 remove os casts). Um `return` dentro do laço (fluxo `choose_workspace`) continua abortando a mensagem inteira — comportamento de hoje, aceitável enquanto o array tem 1 item.

- [ ] **Step 10: `agent-category.test.ts` — migrar os intents**

Em `tests/finance/agent-category.test.ts`, os `h.intent = { kind: 'entry', type: 'pf', direction: 'out', description: ..., amount: ..., category: ..., subcategory: ..., workspaceHint: null }` viram:

```ts
h.intent = {
  kind: 'entry',
  entries: [
    { type: 'pf', direction: 'out', description: 'Escola do João', amount: 200, category: 'Filhos', subcategory: 'Escola', workspaceHint: null },
  ],
}
```

Os intents `kind: 'query'` do mesmo arquivo não mudam. As asserts sobre `finance_entries` insert continuam iguais.

- [ ] **Step 11: Rodar a suíte de finance inteira**

Run: `npx vitest run tests/finance/`
Expected: PASS (todos). Se algum outro teste de `agent-*` montava `h.intent` com o shape velho de `entry`, migrar igual ao Step 10.

- [ ] **Step 12: Commit**

```bash
git add lib/finance/types.ts lib/finance/interpret.ts lib/finance/parser.ts lib/finance/agent.ts tests/finance/
git commit -m "refactor(finance): interpretador devolve lancamentos[] e intent carrega entries[]

Só muda a forma dos dados — 1 lançamento por mensagem, mesmo comportamento.
Prepara o terreno para multi-lançamento e pergunta de PF/PJ.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Mecanismo de conversa no agente — drain, park, resume, batch confirm

Implementa **todo o lado do agente**: laço de drenagem com as três perguntas (tipo / valor / unidade), registro `entry_batch` unificado (substitui `choose_workspace`), retomada, confirmação em lote, e os builders de copy + `parseEntryType`. Testado alimentando `h.intent` com arrays multi-item e com `type`/`amount` nulos direto (os testes do agente mockam o interpretador inteiro), então esta task não depende das Tasks 3-5.

**Files:**
- Modify: `lib/finance/agent.ts` (extrair `persistEntry`, `monthTotalFor`, `batchTotals`; `drainEntryQueue`; `handlePendingEntryBatch`; remover `handlePendingChooseWorkspace`, `PendingChooseWorkspace`, `persistEntryAndConfirm`)
- Modify: `lib/finance/respond.ts` (novos builders + `parseEntryType`)
- Create: `tests/finance/entry-type-parse.test.ts`
- Create: `tests/finance/agent-entry-batch.test.ts`
- Modify: `tests/finance/agent-category.test.ts` (asserts que dependiam do texto de confirmação continuam via `claudeCreate` mock)

**Interfaces:**
- Consumes (da Task 1): `EntryDraft`, `FinanceIntent.entry = { entries: EntryDraft[] }`.
- Produces:
  - `parseEntryType(text: string): 'pf' | 'pj' | null` — em `lib/finance/respond.ts`.
  - `buildChooseTypeMessage(description: string | null, amount: number | null): string`
  - `buildAskAmountMessage(description: string | null): string`
  - `buildBatchConfirmationMessage(entries: FinanceEntry[], totals: BatchTotal[]): string` onde
    `type BatchTotal = { type: FinanceEntryType; direction: 'in' | 'out'; total: number }` (exportado de `respond.ts`).
  - Registro de pendência (em `finance_sessions.pending_entry`):
    ```ts
    interface PendingEntryBatch {
      kind: 'entry_batch'
      awaiting: 'type' | 'amount' | 'unit'
      rawMessage: string
      current: PendingDraft
      queue: PendingDraft[]
    }
    type PendingDraft = {
      type: FinanceEntryType | null
      direction: 'in' | 'out'
      description: string | null
      amount: number | null
      category: string | null
      subcategory: string | null
      workspaceHint: string | null
      categoryId?: string | null
      subcategoryId?: string | null
      workspaceId?: string | null
    }
    ```

- [ ] **Step 1: `parseEntryType` — teste que falha**

Create `tests/finance/entry-type-parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseEntryType } from '@/lib/finance/respond'

describe('parseEntryType', () => {
  it.each(['pf', 'PF', 'pessoal', 'é pessoal', 'meu', 'pessoa física'])('"%s" → pf', (t) => {
    expect(parseEntryType(t)).toBe('pf')
  })
  it.each(['pj', 'PJ', 'da clínica', 'clinica', 'empresa', 'cnpj', 'do consultório'])('"%s" → pj', (t) => {
    expect(parseEntryType(t)).toBe('pj')
  })
  it.each(['sim', 'talvez', 'não sei', '35', 'aluguel'])('"%s" → null', (t) => {
    expect(parseEntryType(t)).toBeNull()
  })
  it('"minha clínica" → pj (pj ganha de pf)', () => {
    expect(parseEntryType('minha clínica')).toBe('pj')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/finance/entry-type-parse.test.ts`
Expected: FAIL — `parseEntryType` não existe.

- [ ] **Step 3: `parseEntryType` + builders em `respond.ts`**

Em `lib/finance/respond.ts`, adicionar (perto de `parsePaymentMethod` não — este está em `agent.ts`; colocar junto dos outros `build*` e `formatBRL`):

```ts
// Casa a resposta do owner à pergunta "PF ou PJ?". pj é checado primeiro para
// "minha clínica" não cair em pf pelo "minha".
export function parseEntryType(text: string): 'pf' | 'pj' | null {
  const t = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  if (/\b(pj|clinica|empresa|cnpj|consultorio|escritorio|juridica)\b/.test(t)) return 'pj'
  if (/\b(pf|pessoal|pessoa fisica|fisica|meu|minha|particular)\b/.test(t)) return 'pf'
  return null
}

export function buildChooseTypeMessage(description: string | null, amount: number | null): string {
  const desc = description ?? 'esse lançamento'
  const valor = amount != null ? ` (${formatBRL(amount)})` : ''
  return `O gasto com ${desc}${valor} é pessoal (PF) ou da clínica (PJ)?`
}

export function buildAskAmountMessage(description: string | null): string {
  const desc = description ? `com ${description}` : 'desse lançamento'
  return `Quanto foi o gasto ${desc}? Me manda só o valor, ex: 35.`
}

export type BatchTotal = { type: FinanceEntryType; direction: 'in' | 'out'; total: number }

export function buildBatchConfirmationMessage(entries: FinanceEntry[], totals: BatchTotal[]): string {
  const linhas = entries.map((e) => {
    const t = e.type === 'pf' ? 'PF' : 'PJ'
    const d = e.direction === 'in' ? 'receita' : 'despesa'
    return `• ${e.description ?? 'Sem descrição'} — ${formatBRL(e.amount)} (${t}, ${d})`
  })
  const totaisLinhas = totals.map((tt) => {
    const t = tt.type === 'pf' ? 'PF' : 'PJ'
    const d = tt.direction === 'in' ? 'Receitas' : 'Despesas'
    return `${d} ${t} em ${monthLabel(null)}: ${formatBRL(tt.total)}`
  })
  return `Registrei ${entries.length} lançamentos:\n${linhas.join('\n')}\n${totaisLinhas.join('\n')}`
}
```

`monthLabel` já existe no arquivo (privada) — reutilizar. `FinanceEntryType` já é importado.

- [ ] **Step 4: Rodar `parseEntryType`**

Run: `npx vitest run tests/finance/entry-type-parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Teste que falha — multi-lançamento grava N linhas e confirma em lote**

Create `tests/finance/agent-entry-batch.test.ts` (header de mocks completo — não depende de outros arquivos de teste):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetAgentHarness, mergeSupabaseConfig, state, PARAMS, sentMessages, lastSentMessage } from '../helpers/agent-harness'

const h = vi.hoisted(() => ({ intent: null as unknown }))

vi.mock('@/lib/supabase/server', async () => {
  const harness = await import('../helpers/agent-harness')
  return { createAdminClient: () => harness.state.supabase.client, createClient: async () => harness.state.supabase.client }
})
vi.mock('@/lib/whatsapp/send', async () => {
  const harness = await import('../helpers/agent-harness')
  return { sendWhatsAppMessage: harness.sendWhatsAppMessage }
})
vi.mock('@anthropic-ai/sdk', async () => {
  const harness = await import('../helpers/agent-harness')
  return { default: class { messages = { create: harness.claudeCreate } } }
})
vi.mock('@/lib/finance/provision', () => ({ ensureFinanceCategories: vi.fn() }))
vi.mock('@/lib/finance/interpret', () => ({ interpretMessage: vi.fn(async () => h.intent) }))
vi.mock('@/lib/finance/categorize', () => ({ categorizeEntry: vi.fn(async () => ({ categoryName: null, subcategoryName: null })) }))

const CAT_ROWS = [
  { id: 'ali', account_id: PARAMS.accountId, kind: 'pf', direction: 'out', parent_id: null, name: 'Alimentação', sort_order: 0, is_archived: false, created_at: '' },
]

function financeConfig(over: Record<string, unknown> = {}) {
  return mergeSupabaseConfig({
    memberships: { select: { data: [{ account_id: PARAMS.accountId, user_id: 'u1' }] } },
    profiles: { select: { data: [{ id: 'u1', phone: PARAMS.patientPhone }] } },
    accounts: { select: { data: { modules: ['finance'] } } },
    finance_categories: { select: { data: CAT_ROWS } },
    finance_sessions: { select: { data: null }, upsert: { data: null }, update: { data: null } },
    finance_entries: { select: { data: [] }, insert: { data: { id: 'e1', type: 'pf', direction: 'out', description: 'x', amount: 1, category: null, category_id: null, subcategory_id: null, entry_date: '2026-09-08', workspace_id: null } } },
    workspaces: { select: { data: [{ id: 'w1', name: 'Unidade A' }] } },
    ...over,
  })
}

beforeEach(() => {
  resetAgentHarness()
  h.intent = null
  process.env.FINANCE_PHONE_NUMBER_ID = 'pn-fin'
  process.env.FINANCE_META_TOKEN = 'tok-fin'
})

describe('processFinancialMessage — lote de lançamentos', () => {
  it('dois lançamentos prontos → dois inserts + uma confirmação em lote', async () => {
    financeConfig()
    h.intent = {
      kind: 'entry',
      entries: [
        { type: 'pf', direction: 'out', description: 'iFood', amount: 35, category: null, subcategory: null, workspaceHint: null },
        { type: 'pf', direction: 'out', description: 'Uber', amount: 50, category: null, subcategory: null, workspaceHint: null },
      ],
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'gastei 35 no ifood e 50 no uber')

    expect(state.supabase.callsTo('finance_entries', 'insert')).toHaveLength(2)
    const msgs = sentMessages()
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toContain('Registrei 2 lançamentos')
    expect(msgs[0]).toContain('iFood')
    expect(msgs[0]).toContain('Uber')
  })
})
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run tests/finance/agent-entry-batch.test.ts`
Expected: FAIL — hoje o laço da Task 1 chama `persistEntryAndConfirm` por item, gerando 2 mensagens e nenhuma "Registrei 2 lançamentos".

- [ ] **Step 7: `agent.ts` — extrair `persistEntry` / `monthTotalFor` / `batchTotals`**

Substituir `persistEntryAndConfirm` por duas peças. `persistEntry` faz só o insert + tracking e devolve a linha (ou null):

```ts
async function persistEntry(
  supabase: ReturnType<typeof createAdminClient>,
  args: {
    accountId: string; senderPhone: string; userId: string
    type: FinanceEntry['type']; direction: 'in' | 'out'
    description: string | null; amount: number
    categoryName: string | null; categoryId: string | null; subcategoryId: string | null
    workspaceId: string | null; rawMessage: string; today: string
  }
): Promise<FinanceEntry | null> {
  const { data: entry, error } = await supabase
    .from('finance_entries')
    .insert({
      account_id: args.accountId, workspace_id: args.workspaceId, recorded_by_phone: args.senderPhone,
      type: args.type, direction: args.direction, description: args.description, amount: args.amount,
      category: args.categoryName, category_id: args.categoryId, subcategory_id: args.subcategoryId,
      raw_message: args.rawMessage, entry_date: args.today,
    })
    .select('*')
    .single()
  if (error || !entry) return null
  await trackFinanceEntryCreatedViaWhatsApp(args.userId, {
    account_id: args.accountId, category: args.categoryName ?? null, amount: entry.amount,
  })
  return entry
}

// Total do mês atual de um bucket (type + direction), account-wide.
async function monthTotalFor(accountId: string, type: FinanceEntry['type'], direction: 'in' | 'out'): Promise<number> {
  const rows = await getEntries(accountId, {
    type, direction, category: null, categoryId: null, subcategoryId: null,
    month: null, workspaceId: null, unitLabel: null,
  })
  return rows.reduce((s, e) => s + e.amount, 0)
}

async function batchTotals(accountId: string, entries: FinanceEntry[]): Promise<BatchTotal[]> {
  const seen = new Map<string, BatchTotal>()
  for (const e of entries) {
    const key = `${e.type}:${e.direction}`
    if (seen.has(key)) continue
    seen.set(key, { type: e.type, direction: e.direction, total: await monthTotalFor(accountId, e.type, e.direction) })
  }
  return [...seen.values()]
}
```

Importar `BatchTotal`, `buildBatchConfirmationMessage`, `buildChooseTypeMessage`, `buildAskAmountMessage`, `parseEntryType` de `./respond`. `getEntries` já existe no arquivo.

- [ ] **Step 8: `agent.ts` — `drainEntryQueue` + `persistAndConfirm` + `parkAndAsk`**

Adicionar os tipos `PendingDraft` / `PendingEntryBatch` (bloco do Interfaces acima) e:

```ts
interface EntryCtx {
  accountId: string
  senderPhone: string
  userId: string
  categoryTree: FinanceCategoryTree
  rawMessage: string
  today: string
}

function toPendingDraft(d: EntryDraft): PendingDraft {
  return { ...d }
}

// Resolve categoria (nome -> id, com fallback no categorizeEntry) uma vez que o
// tipo é conhecido. Muta o draft.
async function resolveDraftCategory(ctx: EntryCtx, d: PendingDraft): Promise<void> {
  if (d.type == null || d.categoryId !== undefined) return
  let pair = resolveCategoryPair(ctx.categoryTree, d.type, d.category, d.subcategory, d.direction)
  if (!pair.categoryId && d.description) {
    const guess = await categorizeEntry(d.description, d.type, d.direction, ctx.categoryTree)
    pair = resolveCategoryPair(ctx.categoryTree, d.type, guess.categoryName, guess.subcategoryName, d.direction)
  }
  d.category = pair.categoryName
  d.categoryId = pair.categoryId
  d.subcategoryId = pair.subcategoryId
}

async function persistAndConfirm(
  supabase: ReturnType<typeof createAdminClient>,
  ctx: EntryCtx,
  drafts: PendingDraft[]
): Promise<void> {
  const saved: FinanceEntry[] = []
  for (const d of drafts) {
    const entry = await persistEntry(supabase, {
      accountId: ctx.accountId, senderPhone: ctx.senderPhone, userId: ctx.userId,
      type: d.type as FinanceEntry['type'], direction: d.direction,
      description: d.description, amount: d.amount as number,
      categoryName: d.category ?? null, categoryId: d.categoryId ?? null, subcategoryId: d.subcategoryId ?? null,
      workspaceId: d.workspaceId ?? null, rawMessage: ctx.rawMessage, today: ctx.today,
    })
    if (entry) saved.push(entry)
  }
  if (saved.length === 0) {
    await sendFinanceReply(ctx.senderPhone, `Erro ao registrar o lançamento. Tente novamente.`)
    return
  }
  if (saved.length === 1) {
    const total = await monthTotalFor(ctx.accountId, saved[0].type, saved[0].direction)
    await sendFinanceReply(ctx.senderPhone, await buildConfirmationMessage(saved[0], total))
    return
  }
  await sendFinanceReply(ctx.senderPhone, buildBatchConfirmationMessage(saved, await batchTotals(ctx.accountId, saved)))
}

async function parkAndAsk(
  supabase: ReturnType<typeof createAdminClient>,
  ctx: EntryCtx,
  ready: PendingDraft[],
  awaiting: PendingEntryBatch['awaiting'],
  current: PendingDraft,
  queue: PendingDraft[],
  question: string
): Promise<void> {
  if (ready.length > 0) await persistAndConfirm(supabase, ctx, ready)
  await setPendingFinanceSession(supabase, ctx.accountId, ctx.senderPhone, {
    kind: 'entry_batch', awaiting, rawMessage: ctx.rawMessage, current, queue,
  })
  await sendFinanceReply(ctx.senderPhone, question)
}

// Drena a fila de lançamentos. O primeiro item que precisa de resposta do owner
// estaciona o resto e pergunta; o que já está pronto é gravado + confirmado antes.
async function drainEntryQueue(
  supabase: ReturnType<typeof createAdminClient>,
  ctx: EntryCtx,
  drafts: PendingDraft[]
): Promise<void> {
  const ready: PendingDraft[] = []
  const queue = [...drafts]

  while (queue.length > 0) {
    const draft = queue.shift() as PendingDraft
    await resolveDraftCategory(ctx, draft)

    if (draft.type == null) {
      await parkAndAsk(supabase, ctx, ready, 'type', draft, queue, buildChooseTypeMessage(draft.description, draft.amount))
      return
    }
    if (draft.amount == null) {
      await parkAndAsk(supabase, ctx, ready, 'amount', draft, queue, buildAskAmountMessage(draft.description))
      return
    }
    if (draft.type === 'pj') {
      const units = await listAccountUnits(supabase, ctx.accountId)
      const resolved = resolveUnit(units, draft.workspaceHint)
      if (resolved.status === 'one') {
        draft.workspaceId = resolved.unit.id
      } else {
        await parkAndAsk(
          supabase, ctx, ready, 'unit', draft, queue,
          buildChooseWorkspaceMessage(units, draft.direction, draft.description, draft.amount)
        )
        return
      }
    } else {
      draft.workspaceId = null
    }
    ready.push(draft)
  }

  await persistAndConfirm(supabase, ctx, ready)
}
```

`FinanceCategoryTree` já é importado (via `getFinanceCategoryTree`); se não, importar de `./categories`.

- [ ] **Step 9: `agent.ts` — ligar `processFinancialMessage` no `drainEntryQueue`**

Trocar o laço `for (const draft of intent.entries) { … }` da Task 1 (todo o bloco "// 4. Categorizar" até o fim do `for`) por:

```ts
  const entryCtx: EntryCtx = {
    accountId,
    senderPhone,
    userId: membership.user_id,
    categoryTree,
    rawMessage: messageText,
    today,
  }
  await drainEntryQueue(supabase, entryCtx, intent.entries.map(toPendingDraft))
```

Remover `persistEntryAndConfirm` (não é mais chamada).

- [ ] **Step 10: `agent.ts` — `entry_batch` substitui `choose_workspace`**

Trocar `PendingChooseWorkspace` por `PendingEntryBatch` na união de `setPendingFinanceSession` e no tipo de `pending_entry`. Reescrever `handlePendingChooseWorkspace` como `handlePendingEntryBatch`:

```ts
async function handlePendingEntryBatch(
  supabase: ReturnType<typeof createAdminClient>,
  accountId: string,
  senderPhone: string,
  messageText: string,
  userId: string,
  categoryTree: FinanceCategoryTree,
  today: string
): Promise<boolean> {
  const { data: fsession } = await supabase
    .from('finance_sessions')
    .select('pending_entry, last_message_at')
    .eq('phone', senderPhone)
    .maybeSingle()

  const pending = fsession?.pending_entry as PendingEntryBatch | null | undefined
  if (!pending || pending.kind !== 'entry_batch') return false

  if (fsession?.last_message_at && Date.now() - new Date(fsession.last_message_at).getTime() > PENDING_TTL_MS) {
    await clearPendingFinanceSession(supabase, senderPhone)
    return false
  }

  const text = messageText.trim()
  if (NEGATIVE.test(text)) {
    await clearPendingFinanceSession(supabase, senderPhone)
    await sendFinanceReply(senderPhone, 'Ok, não registrei o restante. Me chama de novo quando quiser.')
    return true
  }

  const ctx: EntryCtx = { accountId, senderPhone, userId, categoryTree, rawMessage: pending.rawMessage, today }
  const current = pending.current

  if (pending.awaiting === 'type') {
    const t = parseEntryType(text)
    if (!t) {
      await sendFinanceReply(senderPhone, buildChooseTypeMessage(current.description, current.amount))
      return true
    }
    current.type = t
    current.categoryId = undefined // força re-resolver categoria com o tipo certo
  } else if (pending.awaiting === 'amount') {
    const valor = parseAmount(text)
    if (valor == null) {
      await sendFinanceReply(senderPhone, 'Não peguei o valor. Me manda só o número, ex: 35.')
      return true
    }
    current.amount = valor
  } else {
    const units = await listAccountUnits(supabase, accountId)
    const resolved = resolveUnit(units, text)
    if (resolved.status !== 'one') {
      await sendFinanceReply(senderPhone, buildWorkspaceNotMatchedMessage(units))
      return true
    }
    current.workspaceId = resolved.unit.id
  }

  await clearPendingFinanceSession(supabase, senderPhone)
  await drainEntryQueue(supabase, ctx, [current, ...pending.queue])
  return true
}
```

`parseAmount` — helper novo em `agent.ts` (perto de `parsePaymentMethod`):

```ts
function parseAmount(text: string): number | null {
  const m = text.replace(/\s/g, '').match(/r?\$?([\d]+(?:[.,]\d{1,2})?)(?:reais?)?$/i)
  if (!m) return null
  const n = parseFloat(m[1].replace(',', '.'))
  return isFinite(n) && n > 0 ? n : null
}
```

Na secção 2.5 de `processFinancialMessage`, trocar a chamada:

```ts
  if (await handlePendingEntryBatch(supabase, accountId, senderPhone, messageText, membership.user_id, categoryTree, today)) return
```

(`today` já é calculado logo abaixo hoje — mover a linha `const today = ...` para antes da secção 2.5, ou recalcular. Preferir mover para cima.)

- [ ] **Step 11: Rodar o teste do lote**

Run: `npx vitest run tests/finance/agent-entry-batch.test.ts`
Expected: PASS (o caso "dois lançamentos prontos").

- [ ] **Step 12: Testes de park + resume**

Adicionar a `tests/finance/agent-entry-batch.test.ts`:

```ts
it('tipo ambíguo estaciona o lote e pergunta PF/PJ, sem gravar', async () => {
  financeConfig()
  h.intent = {
    kind: 'entry',
    entries: [{ type: null, direction: 'out', description: 'aluguel', amount: 2600, category: null, subcategory: null, workspaceHint: null }],
  }
  const { processFinancialMessage } = await import('@/lib/finance/agent')
  await processFinancialMessage(PARAMS.patientPhone, 'gastei 2600 no aluguel')

  expect(state.supabase.callsTo('finance_entries', 'insert')).toHaveLength(0)
  const up = state.supabase.callsTo('finance_sessions', 'upsert')[0]
  expect((up.payload as { pending_entry: { kind: string; awaiting: string } }).pending_entry).toMatchObject({ kind: 'entry_batch', awaiting: 'type' })
  expect(lastSentMessage()).toContain('pessoal (PF) ou da clínica (PJ)')
})

it('resposta "pessoal" retoma e grava como PF', async () => {
  financeConfig({
    finance_sessions: {
      select: {
        data: {
          pending_entry: {
            kind: 'entry_batch', awaiting: 'type', rawMessage: 'gastei 2600 no aluguel',
            current: { type: null, direction: 'out', description: 'aluguel', amount: 2600, category: null, subcategory: null, workspaceHint: null },
            queue: [],
          },
          last_message_at: new Date().toISOString(),
        },
      },
      upsert: { data: null }, update: { data: null },
    },
  })
  h.intent = { kind: 'unknown', raw: 'pessoal' } // não deve ser usado — o handler intercepta antes
  const { processFinancialMessage } = await import('@/lib/finance/agent')
  await processFinancialMessage(PARAMS.patientPhone, 'pessoal')

  const ins = state.supabase.callsTo('finance_entries', 'insert')[0]
  expect((ins.payload as { type: string }).type).toBe('pf')
})

it('item pronto antes do ambíguo é gravado e confirmado; a pergunta vem depois', async () => {
  financeConfig()
  h.intent = {
    kind: 'entry',
    entries: [
      { type: 'pf', direction: 'out', description: 'iFood', amount: 35, category: null, subcategory: null, workspaceHint: null },
      { type: null, direction: 'out', description: 'aluguel', amount: 2600, category: null, subcategory: null, workspaceHint: null },
    ],
  }
  const { processFinancialMessage } = await import('@/lib/finance/agent')
  await processFinancialMessage(PARAMS.patientPhone, 'gastei 35 no ifood e 2600 no aluguel')

  expect(state.supabase.callsTo('finance_entries', 'insert')).toHaveLength(1)
  const msgs = sentMessages()
  expect(msgs.length).toBe(2)
  expect(msgs[1]).toContain('pessoal (PF) ou da clínica (PJ)')
})

it('valor faltando pergunta o valor e depois grava', async () => {
  financeConfig({
    finance_sessions: {
      select: {
        data: {
          pending_entry: {
            kind: 'entry_batch', awaiting: 'amount', rawMessage: 'paguei o almoço',
            current: { type: 'pf', direction: 'out', description: 'almoço', amount: null, category: null, subcategory: null, workspaceHint: null },
            queue: [],
          },
          last_message_at: new Date().toISOString(),
        },
      },
      upsert: { data: null }, update: { data: null },
    },
  })
  const { processFinancialMessage } = await import('@/lib/finance/agent')
  await processFinancialMessage(PARAMS.patientPhone, '32')

  const ins = state.supabase.callsTo('finance_entries', 'insert')[0]
  expect((ins.payload as { amount: number }).amount).toBe(32)
})

it('PJ multi-unidade encadeia a pergunta de unidade depois do tipo', async () => {
  financeConfig({ workspaces: { select: { data: [{ id: 'w1', name: 'Unidade A' }, { id: 'w2', name: 'Unidade B' }] } } })
  h.intent = {
    kind: 'entry',
    entries: [{ type: null, direction: 'out', description: 'material', amount: 400, category: null, subcategory: null, workspaceHint: null }],
  }
  const { processFinancialMessage } = await import('@/lib/finance/agent')
  await processFinancialMessage(PARAMS.patientPhone, 'gastei 400 em material')
  // responde "clínica"
  applyPendingFromLastUpsert() // helper abaixo
  await processFinancialMessage(PARAMS.patientPhone, 'clínica')

  expect(lastSentMessage()).toMatch(/unidade/i)
})

it('NEGATIVE descarta current + queue mas mantém o que já entrou', async () => {
  financeConfig({
    finance_sessions: {
      select: {
        data: {
          pending_entry: {
            kind: 'entry_batch', awaiting: 'type', rawMessage: 'x',
            current: { type: null, direction: 'out', description: 'aluguel', amount: 2600, category: null, subcategory: null, workspaceHint: null },
            queue: [{ type: null, direction: 'out', description: 'energia', amount: 300, category: null, subcategory: null, workspaceHint: null }],
          },
          last_message_at: new Date().toISOString(),
        },
      },
      upsert: { data: null }, update: { data: null },
    },
  })
  const { processFinancialMessage } = await import('@/lib/finance/agent')
  await processFinancialMessage(PARAMS.patientPhone, 'deixa')

  expect(state.supabase.callsTo('finance_entries', 'insert')).toHaveLength(0)
  expect(lastSentMessage()).toContain('não registrei o restante')
})
```

Para o caso encadeado, adicionar ao topo do arquivo um helper que relê o `pending_entry` do último upsert e o injeta como `select.data` de `finance_sessions`:

```ts
function applyPendingFromLastUpsert() {
  const up = state.supabase.callsTo('finance_sessions', 'upsert').at(-1)
  const pending = (up?.payload as { pending_entry: unknown })?.pending_entry
  mergeSupabaseConfig({
    finance_sessions: {
      select: { data: { pending_entry: pending, last_message_at: new Date().toISOString() } },
      upsert: { data: null }, update: { data: null },
    },
  })
}
```

- [ ] **Step 13: Rodar e ver falhar (os novos)**

Run: `npx vitest run tests/finance/agent-entry-batch.test.ts`
Expected: os 6 novos casos falham onde o comportamento ainda não existe (encadeamento, mensagem de NEGATIVE nova, etc.), ou passam se a implementação do Step 8-10 já cobrir. Ajustar a implementação até todos passarem.

- [ ] **Step 14: Migrar os testes de `choose_workspace`**

Procurar por `choose_workspace` e `handlePendingChooseWorkspace` em `tests/finance/`:

Run: `npx vitest run tests/finance/ 2>&1 | grep -i "fail\|choose_workspace"` (ou rodar a suíte e ler os vermelhos).

Onde um teste montava `pending_entry: { kind: 'choose_workspace', entry: {...} }`, trocar para `{ kind: 'entry_batch', awaiting: 'unit', rawMessage: '<raw>', current: { type: 'pj', direction, description, amount, category, subcategory: null, workspaceHint: null, categoryId: <id ou null>, subcategoryId: null }, queue: [] }`. A assert de que grava na unidade escolhida continua igual.

- [ ] **Step 15: Rodar a suíte inteira de finance**

Run: `npx vitest run tests/finance/`
Expected: PASS (tudo). `handlePendingPaymentConfirm` e seus testes não foram tocados.

- [ ] **Step 16: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint lib/finance/`
Expected: sem erros. Remover imports órfãos (`PendingChooseWorkspace`, `buildChooseWorkspaceMessage` continua usado).

- [ ] **Step 17: Commit**

```bash
git add lib/finance/agent.ts lib/finance/respond.ts tests/finance/
git commit -m "feat(finance): agente drena lote de lançamentos e pergunta tipo/valor/unidade

entry_batch unifica a pendência (substitui choose_workspace); o que já está
pronto é gravado e confirmado antes de cada pergunta. Confirmação em lote
quando há mais de um lançamento. handlePendingPaymentConfirm intocado.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Interpretador — vários lançamentos numa mensagem

O mecanismo já existe (Task 2). Aqui o prompt passa a **produzir** `lancamentos` com mais de um item.

**Files:**
- Modify: `lib/finance/interpret.ts` (`buildSystem`)
- Test: `tests/finance/interpret.test.ts`

**Interfaces:**
- Consumes: `interpretMessage` / `toIntent` da Task 1 (já iteram `input.lancamentos`).
- Produces: nenhuma assinatura nova.

- [ ] **Step 1: Teste que falha — dois itens**

Em `tests/finance/interpret.test.ts`:

```ts
it('mensagem com dois gastos vira dois itens em entries', async () => {
  createMock.mockResolvedValue(
    toolResponse({
      lancamentos: [
        { tipo: 'pf', descricao: 'iFood', valor: 35, categoria: null, subcategoria: null, unidade: null, direcao: 'saida' },
        { tipo: 'pf', descricao: 'Uber', valor: 50, categoria: null, subcategoria: null, unidade: null, direcao: 'saida' },
      ],
    })
  )
  const intent = await interpretMessage('gastei 35 no ifood e 50 no uber', '2026-09-04', TREE)
  if (intent.kind !== 'entry') throw new Error('esperava entry')
  expect(intent.entries.map((e) => e.description)).toEqual(['iFood', 'Uber'])
})

it('prompt instrui um item por gasto e não manda usar desconhecido para vários', async () => {
  createMock.mockResolvedValue(toolResponse({}))
  await interpretMessage('x', '2026-09-04', TREE)
  const system = createMock.mock.calls[0][0].system as string
  expect(system).toMatch(/um item .*para cada|mais de um lançamento/i)
  expect(system).not.toContain('use "desconhecido" — o registro é de um por vez')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/finance/interpret.test.ts`
Expected: FAIL — o segundo teste falha (o prompt ainda tem a regra "um por vez"). O primeiro já deve passar (Task 1 iterou o array), mas mantém-se como guarda de regressão.

- [ ] **Step 3: `buildSystem` — regra de múltiplos**

Em `lib/finance/interpret.ts`, dentro do template de `buildSystem`, trocar a linha:

```
- Se a mensagem misturar vários gastos/receitas de uma vez, use "desconhecido" — o registro é de um por vez.
```

por:

```
- A mensagem pode conter mais de um lançamento (ex.: "gastei 35 no ifood e 50 no uber"). Devolva um item em "lancamentos" para cada gasto ou receita. Use "desconhecido" apenas quando não dá para identificar nenhum lançamento.
```

- [ ] **Step 4: Rodar o teste**

Run: `npx vitest run tests/finance/interpret.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/finance/interpret.ts tests/finance/interpret.test.ts
git commit -m "feat(finance): interpretador aceita vários lançamentos numa mensagem só

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Interpretador — PF/PJ ambíguo devolve `null` (agente pergunta)

**Files:**
- Modify: `lib/finance/interpret.ts` (`buildSystem` + `toIntent` — remover `?? 'pf'`)
- Test: `tests/finance/interpret.test.ts`

**Interfaces:**
- Consumes: mecanismo `awaiting: 'type'` da Task 2.
- Produces: `toIntent` passa a emitir `EntryDraft.type === null` quando `item.tipo` é `null`.

- [ ] **Step 1: Teste que falha**

Em `tests/finance/interpret.test.ts`:

```ts
it('tipo null no item passa como type null (não vira pf)', async () => {
  createMock.mockResolvedValue(
    toolResponse({
      lancamentos: [{ tipo: null, descricao: 'aluguel', valor: 2600, categoria: null, subcategoria: null, unidade: null, direcao: 'saida' }],
    })
  )
  const intent = await interpretMessage('gastei 2600 no aluguel', '2026-09-04', TREE)
  if (intent.kind !== 'entry') throw new Error('esperava entry')
  expect(intent.entries[0].type).toBeNull()
})

it('prompt tem os três buckets pf/pj/null e não tem o tiebreak clínico antigo', async () => {
  createMock.mockResolvedValue(toolResponse({}))
  await interpretMessage('x', '2026-09-04', TREE)
  const system = createMock.mock.calls[0][0].system as string
  expect(system).toContain('genuinamente ambíguo')
  expect(system).toContain('NÃO chute')
  expect(system).not.toContain('escolha pelo contexto clínico')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/finance/interpret.test.ts`
Expected: FAIL — `toIntent` ainda faz `item.tipo ?? 'pf'`; prompt ainda tem o tiebreak.

- [ ] **Step 3: `toIntent` — remover o default `?? 'pf'`**

Em `lib/finance/interpret.ts`, no `case 'lancamento'`, trocar:

```ts
          type: item.tipo ?? 'pf',
```

por:

```ts
          // null = ambíguo; o agente pergunta PF ou PJ antes de gravar.
          type: item.tipo,
```

- [ ] **Step 4: `buildSystem` — buckets PF/PJ**

Trocar a linha final de "Regras:" (`- Na dúvida entre pf e pj num lançamento, escolha pelo contexto clínico: …`) por:

```
Classifique cada lançamento em "tipo":
- pf: gasto/receita pessoal do médico. Ex.: iFood, mercado, streaming, farmácia, escola dos filhos, viagem, salário/pró-labore, aluguel que ELE recebe, investimentos.
- pj: da clínica. Ex.: "escritório", sala/consultório, equipamento médico, material de consultório, secretária/funcionário, sistema/CRM da clínica, imposto da clínica, receita de consulta/procedimento.
- null: genuinamente ambíguo — dá para ser pessoal ou da clínica e a mensagem não decide (ex.: aluguel, energia, água, internet, telefone, carro, contador, seguro, sem nada no texto apontando para um lado). NÃO chute; devolva null e o agente pergunta.
```

- [ ] **Step 5: Ajustar o teste de "default" da Task 1**

O teste da Task 1 "lancamento vira entry com um item em entries[]" usa `ITEM` com `tipo: 'pf'` — continua válido. Se algum teste dependia de `tipo: null → pf`, trocar a expectativa para `type: null`. Rodar:

Run: `npx vitest run tests/finance/interpret.test.ts`
Expected: PASS.

- [ ] **Step 6: Suíte de finance (garantir que o agente lida com `type: null`)**

Run: `npx vitest run tests/finance/`
Expected: PASS — a Task 2 já cobre `type: null` no `drainEntryQueue`.

- [ ] **Step 7: Commit**

```bash
git add lib/finance/interpret.ts tests/finance/interpret.test.ts
git commit -m "feat(finance): PF/PJ ambíguo devolve null e o agente pergunta em vez de chutar

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Interpretador — valor faltando vira `amount: null` (agente pergunta)

**Files:**
- Modify: `lib/finance/interpret.ts` (`buildSystem` + `toIntent` — `valor` inválido → `null`, não `unknown`)
- Test: `tests/finance/interpret.test.ts`

**Interfaces:**
- Consumes: mecanismo `awaiting: 'amount'` da Task 2.
- Produces: `toIntent` emite `EntryDraft.amount === null` quando há descrição mas não há número; sem descrição **e** sem valor, o item é descartado; nenhum item → `unknown`.

- [ ] **Step 1: Teste que falha**

```ts
it('descrição sem valor vira item com amount null', async () => {
  createMock.mockResolvedValue(
    toolResponse({
      lancamentos: [{ tipo: 'pf', descricao: 'almoço', valor: null, categoria: null, subcategoria: null, unidade: null, direcao: 'saida' }],
    })
  )
  const intent = await interpretMessage('paguei o almoço', '2026-09-04', TREE)
  if (intent.kind !== 'entry') throw new Error('esperava entry')
  expect(intent.entries[0]).toMatchObject({ description: 'almoço', amount: null })
})

it('item sem descrição e sem valor é descartado; nada sobra → unknown', async () => {
  createMock.mockResolvedValue(
    toolResponse({
      lancamentos: [{ tipo: 'pf', descricao: null, valor: null, categoria: null, subcategoria: null, unidade: null, direcao: 'saida' }],
    })
  )
  const intent = await interpretMessage('gastei um dinheiro aí', '2026-09-04', TREE)
  expect(intent.kind).toBe('unknown')
})

it('num lote, o item sem valor não derruba o item completo', async () => {
  createMock.mockResolvedValue(
    toolResponse({
      lancamentos: [
        { tipo: 'pf', descricao: 'iFood', valor: 35, categoria: null, subcategoria: null, unidade: null, direcao: 'saida' },
        { tipo: 'pf', descricao: 'estacionamento', valor: null, categoria: null, subcategoria: null, unidade: null, direcao: 'saida' },
      ],
    })
  )
  const intent = await interpretMessage('35 no ifood e o estacionamento', '2026-09-04', TREE)
  if (intent.kind !== 'entry') throw new Error('esperava entry')
  expect(intent.entries.map((e) => [e.description, e.amount])).toEqual([['iFood', 35], ['estacionamento', null]])
})
```

Ajustar/remover o teste da Task 1 que assumia "valor inválido → `unknown` da mensagem inteira" quando há descrição (agora o comportamento é `amount: null`). Manter um caso de `valor` inválido **sem** descrição → `unknown`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/finance/interpret.test.ts`
Expected: FAIL — `toIntent` faz `return { kind: 'unknown', raw }` no primeiro `valor` inválido.

- [ ] **Step 3: `toIntent` — `valor` inválido vira `null`**

No `case 'lancamento'`, trocar o corpo do laço:

```ts
      for (const item of input.lancamentos) {
        const amount =
          typeof item.valor === 'number' && isFinite(item.valor) && item.valor > 0 ? item.valor : null
        const description = item.descricao?.trim() || null
        // Sem valor E sem descrição não há o que perguntar nem o que gravar.
        if (amount == null && description == null) continue
        drafts.push({
          type: item.tipo,
          direction: item.direcao === 'entrada' ? 'in' : 'out',
          description,
          amount,
          category: item.categoria?.trim() || null,
          subcategory: item.subcategoria?.trim() || null,
          workspaceHint: item.unidade?.trim() || null,
        })
      }
      if (drafts.length === 0) return { kind: 'unknown', raw }
      return { kind: 'entry', entries: drafts }
```

- [ ] **Step 4: `buildSystem` — regra de valor**

Trocar `- Em "lancamento", nunca invente valor: se a mensagem não tiver um número claro, use intencao "desconhecido".` por:

```
- Em "lancamento", nunca invente valor. Se um lançamento tem o que foi gasto mas não um número claro, devolva esse item com "valor": null — o agente pergunta o valor. Só use "desconhecido" quando não há nenhum lançamento identificável.
```

- [ ] **Step 5: Rodar**

Run: `npx vitest run tests/finance/interpret.test.ts && npx vitest run tests/finance/`
Expected: PASS (tudo).

- [ ] **Step 6: Commit**

```bash
git add lib/finance/interpret.ts tests/finance/interpret.test.ts
git commit -m "feat(finance): lançamento sem valor claro pergunta o valor em vez de desistir

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Copy — dead-end aponta o próximo passo + linha no SYSTEM

**Files:**
- Modify: `lib/finance/respond.ts` (`buildUnknownMessage`, `SYSTEM`)
- Test: `tests/finance/respond.test.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: `buildUnknownMessage()` com texto novo (assinatura igual).

- [ ] **Step 1: Teste que falha**

Em `tests/finance/respond.test.ts`:

```ts
import { buildUnknownMessage } from '@/lib/finance/respond'

describe('buildUnknownMessage', () => {
  it('sério mas com um exemplo concreto e a saída de consulta', () => {
    const m = buildUnknownMessage()
    expect(m).toMatch(/almoço|aluguel/)
    expect(m.toLowerCase()).toContain('quanto gastei')
    expect(m).not.toContain('Não consegui entender')
    expect(m).not.toContain('*') // sem markdown
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/finance/respond.test.ts`
Expected: FAIL — texto atual é "Não consegui entender…".

- [ ] **Step 3: Reescrever `buildUnknownMessage` e adicionar a linha no `SYSTEM`**

Em `lib/finance/respond.ts`:

```ts
export function buildUnknownMessage(): string {
  return `Não peguei essa. Me diz o gasto com o valor e onde foi — por exemplo "35 no almoço" ou "2600 de aluguel" — ou pergunte "quanto gastei esse mês".`
}
```

No `const SYSTEM`, acrescentar ao fim do template:

```
Você entende o médico falando do jeito dele: texto livre, com rodeio, e até
vários gastos numa mensagem só. Responda direto, sem reclamar do formato.
```

- [ ] **Step 4: Rodar**

Run: `npx vitest run tests/finance/respond.test.ts && npx vitest run tests/finance/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/finance/respond.ts tests/finance/respond.test.ts
git commit -m "feat(finance): resposta de dead-end aponta o próximo passo, tom sério mantido

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage**

| Spec | Task |
|---|---|
| Decisão 1 (julgamento do modelo, sem lista) | 4 (buckets no prompt) |
| Decisão 2 (`tipo: null` = perguntar; sem tiebreak, sem `?? 'pf'`) | 4 |
| Decisão 3 (`lancamentos[]`, `entries[]`, parser embrulha) | 1 |
| Decisão 4 (`valor: null` em vez de `unknown`) | 5 |
| Decisão 5 (`entry_batch` + `awaiting`, substitui `choose_workspace`, payment intocado) | 2 |
| Decisão 6 (copy determinística com próximo passo) | 6 (+ builders na 2) |
| Decisão 7 (modelos inalterados; `categorizeEntry` por draft) | Global Constraints; `resolveDraftCategory` na 2 |
| Prompt buckets PF/PJ | 4 |
| `EntryDraft` / `FinanceIntent` | 1 |
| Laço de drenagem + persist-before-park + confirmar | 2 |
| `handlePendingEntryBatch` (type/amount/unit, re-drain, NEGATIVE, TTL) | 2 |
| `buildBatchConfirmationMessage` (linha por item + total por bucket) | 2 |
| `parseEntryType` | 2 |
| `buildUnknownMessage` + linha no SYSTEM | 6 |
| Testes: interpret / entry-batch / parser / parseEntryType | 1, 2, 3, 4, 5 |
| Sem migração / sem mudança web-API | respeitado (nenhuma task toca `app/` ou `supabase/`) |
| Fase posterior (contexto de consulta encadeada) | fora de escopo — não planejado |

Sem lacunas.

**2. Placeholder scan** — sem "TBD"/"TODO"/"handle edge cases". Todo passo de código tem bloco de código; todo passo de teste tem o teste. O comentário `// Task 1: comportamento de hoje` e `// não deve ser usado` são explicativos, não placeholders.

**3. Type consistency**
- `EntryDraft` (Task 1) — 7 campos; `PendingDraft` (Task 2) = `EntryDraft` + `categoryId?`/`subcategoryId?`/`workspaceId?`. `toPendingDraft` faz o spread. ✓
- `parseEntryType` devolve `'pf' | 'pj' | null`; `current.type` é `FinanceEntryType | null` — compatível. ✓
- `BatchTotal` exportado de `respond.ts` (Task 2 Step 3), importado em `agent.ts` (Step 7). Mesmo nome nos dois. ✓
- `buildChooseTypeMessage(description, amount)` / `buildAskAmountMessage(description)` — assinaturas idênticas na criação (respond.ts Step 3) e nas chamadas (`drainEntryQueue`, `handlePendingEntryBatch`). ✓
- `drainEntryQueue(supabase, ctx: EntryCtx, drafts: PendingDraft[])` — mesma assinatura no fluxo direto (Step 9) e na retomada (Step 10). ✓
- `monthTotalFor(accountId, type, direction)` — 3 args na definição (Step 7) e nas chamadas (`persistAndConfirm`, `batchTotals`). ✓
- `parseAmount` (agent.ts, Step 10) — só usado no `awaiting: 'amount'`. ✓
- `handlePendingEntryBatch(...)` recebe `categoryTree` e `today`; a chamada na secção 2.5 (Step 10) passa os dois — exige mover `const today` para antes da 2.5 (anotado no passo). ✓

Consistente.
