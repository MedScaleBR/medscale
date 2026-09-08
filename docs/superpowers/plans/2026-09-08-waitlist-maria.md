# Lista de espera pela Maria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a Maria (bot do WhatsApp) plugar na lista de espera que já existe: sem vaga no dia pedido, ela oferece o horário mais próximo OU registra o paciente na lista de espera com o dia/horário exato que ele queria, e o cron horário avisa quando aquele slot vaga.

**Architecture:** Uma migração aditiva na tabela `waitlist` (colunas `desired_date`, `desired_time`, `source`, status `expired`). Um marcador novo (`LISTA_ESPERA`) que a Maria emite e o `parse-markers.ts` lê; o `agent.ts` faz o upsert da entrada e fecha entradas `waiting` quando o paciente agenda. O `prompt-builder.ts` ganha o passo do fluxo condicionado ao módulo `waitlist`. O cron `app/api/cron/waitlist/route.ts` passa a ramificar entradas `bot` (casa só o dia desejado, template Meta novo) e `manual` (comportamento atual intacto); a lógica pura de ramificação e de texto do slot sai para `lib/waitlist/match.ts`.

**Tech Stack:** Next.js (App Router), TypeScript, Supabase (`@supabase/supabase-js`), Vitest, date-fns + `@date-fns/tz` (`TZDate`), WhatsApp Cloud API (templates Meta).

**Spec:** `docs/superpowers/specs/2026-09-08-waitlist-maria-design.md`

## Global Constraints

- Fuso de todo cálculo de horário: `America/Sao_Paulo`, sempre via `TZDate` — nunca `setHours`/`new Date(y,m,d,...)` cru (o servidor roda em UTC).
- Marcadores de controle são **linha isolada**, lidos e removidos antes de enviar ao paciente; qualquer variação de formato quebra em silêncio. `LISTA_ESPERA` **nunca** sai na mesma resposta que `AGENDAMENTO_CONFIRMADO`.
- Testes: `npm test` roda `vitest run`. Não há script de typecheck — usar `npx tsc --noEmit`.
- Sem criação de PR: só commits. O usuário abre o PR.
- Migrações SQL são idempotentes (`add column if not exists`, `create index if not exists`, `drop constraint if exists` antes de recriar). `schema.sql` reflete o estado final; o arquivo de migração é aplicado à mão no SQL Editor do Supabase.
- Aviso de vaga a paciente **sempre** via template Meta aprovado (a conversa costuma estar fora da janela de 24h do WhatsApp).
- `patients` são por `account`; `waitlist` é por `workspace_id` (unidade).
- Analytics server-side nunca quebram teste (no-op sem chave PostHog) — não precisam de mock.

---

### Task 1: Migração da tabela `waitlist` + tipos

**Files:**
- Create: `supabase/migration_waitlist_maria.sql`
- Modify: `supabase/schema.sql` (bloco `create table public.waitlist` em `:492`; índices perto de `:730`)
- Modify: `types/database.ts` (`WaitlistStatus` em `:14`; `waitlist.Row` em `:497`)

**Interfaces:**
- Consumes: nada.
- Produces: colunas `waitlist.desired_date date | null`, `waitlist.desired_time time | null`, `waitlist.source text` (default `'manual'`, check `in ('manual','bot')`); `status` passa a aceitar `'expired'`. Tipo TS: `WaitlistStatus = 'waiting' | 'scheduled' | 'cancelled' | 'expired'`; `waitlist.Row` ganha `desired_date: string | null`, `desired_time: string | null`, `source: string`.

- [ ] **Step 1: Criar o arquivo de migração**

Create `supabase/migration_waitlist_maria.sql`:

```sql
-- Lista de espera pela Maria — dia/horário desejado + origem da entrada.
-- Idempotente. Ver docs/superpowers/specs/2026-09-08-waitlist-maria-design.md
-- Aplicar no SQL Editor do Supabase.

alter table public.waitlist add column if not exists desired_date date;
alter table public.waitlist add column if not exists desired_time time;
alter table public.waitlist add column if not exists source text not null default 'manual';

alter table public.waitlist drop constraint if exists waitlist_source_check;
alter table public.waitlist add constraint waitlist_source_check
  check (source in ('manual','bot'));

-- schema.sql define o check de status inline (nome auto-gerado waitlist_status_check).
alter table public.waitlist drop constraint if exists waitlist_status_check;
alter table public.waitlist add constraint waitlist_status_check
  check (status in ('waiting','scheduled','cancelled','expired'));

-- De-dupe: um paciente, um dia desejado, uma entrada ativa por unidade.
create unique index if not exists uq_waitlist_active_desired
  on public.waitlist (workspace_id, patient_phone, desired_date)
  where status = 'waiting' and desired_date is not null;

-- Match do cron por dia desejado.
create index if not exists idx_waitlist_desired
  on public.waitlist (desired_date, status)
  where desired_date is not null;
```

- [ ] **Step 2: Refletir no `schema.sql`**

No bloco `create table public.waitlist (` (`supabase/schema.sql:492`), adicionar as três colunas logo antes de `notified_at`:

```sql
  preferred_days  text[],                             -- ['segunda','quarta']
  preferred_times text[],                             -- ['manha','tarde']
  notes           text,
  desired_date    date,                               -- dia exato que o paciente pediu (entrada da Maria)
  desired_time    time,                               -- horário exato, se o paciente nomeou um
  source          text not null default 'manual'
                  check (source in ('manual','bot')),
  status          text not null default 'waiting'
                  check (status in ('waiting','scheduled','cancelled','expired')),
  notified_at     timestamptz,                        -- último aviso de vaga (cron/waitlist)
  created_at      timestamptz not null default now()
);
```

(A linha `status ... check (...)` já existe — trocar só a lista do `check` para incluir `'expired'`. As linhas `desired_date`/`desired_time`/`source` são novas.)

Depois de `create index idx_waitlist_workspace ...` (`:730`), adicionar:

```sql
create unique index uq_waitlist_active_desired on public.waitlist(workspace_id, patient_phone, desired_date)
  where status = 'waiting' and desired_date is not null;
create index idx_waitlist_desired on public.waitlist(desired_date, status) where desired_date is not null;
```

- [ ] **Step 3: Atualizar `types/database.ts`**

`types/database.ts:14`:

```ts
export type WaitlistStatus = 'waiting' | 'scheduled' | 'cancelled' | 'expired'
```

No `waitlist.Row` (`types/database.ts:497`), adicionar após `notes`:

```ts
          notes: string | null
          desired_date: string | null
          desired_time: string | null
          source: string
          status: WaitlistStatus
```

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos (o repo compila limpo antes desta task).

- [ ] **Step 5: Commit**

```bash
git add supabase/migration_waitlist_maria.sql supabase/schema.sql types/database.ts
git commit -m "feat(waitlist): schema — desired_date/desired_time/source + status expired"
```

---

### Task 2: Marcador `LISTA_ESPERA` no `parse-markers.ts`

**Files:**
- Modify: `lib/bot/parse-markers.ts`
- Test: `tests/agent/markers.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `WAITLIST_MARKER: RegExp`; `ParsedMarkers.waitlistDesired: { date: string; time: string | null } | null`. `date` no formato `AAAA-MM-DD`; `time` no formato `HH:mm` ou `null`. A linha do marcador é removida de `cleanedMessage` e `messageForPatient`.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/agent/markers.test.ts`, dentro do `describe('parseMarkers — parsing puro dos marcadores de controle', ...)`, adicionar:

```ts
it('extrai só a data quando LISTA_ESPERA vem sem horário', () => {
  const parsed = parseMarkers('Beleza, te aviso se vagar.\nLISTA_ESPERA: 2026-09-16')
  expect(parsed.waitlistDesired).toEqual({ date: '2026-09-16', time: null })
})

it('extrai data e horário quando LISTA_ESPERA vem com horário', () => {
  const parsed = parseMarkers('Te aviso!\nLISTA_ESPERA: 2026-09-16T15:00-03:00')
  expect(parsed.waitlistDesired).toEqual({ date: '2026-09-16', time: '15:00' })
})

it('remove a linha LISTA_ESPERA da mensagem enviada ao paciente', () => {
  const parsed = parseMarkers('Te aviso se abrir vaga.\nLISTA_ESPERA: 2026-09-16T15:00-03:00')
  expect(parsed.messageForPatient).toBe('Te aviso se abrir vaga.')
  expect(parsed.messageForPatient).not.toContain('LISTA_ESPERA')
})

it('devolve waitlistDesired null quando não há marcador', () => {
  expect(parseMarkers('Oi, tudo bem?').waitlistDesired).toBeNull()
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/agent/markers.test.ts -t "LISTA_ESPERA"`
Expected: FAIL — `waitlistDesired` não existe em `ParsedMarkers`.

- [ ] **Step 3: Implementar no `parse-markers.ts`**

Após a definição de `UNIT_ID_MARKER`:

```ts
// Lista de espera — a Maria emite quando o paciente, sem vaga no dia que
// queria, opta por ser avisado. Aceita data pura ou data+hora com offset de
// São Paulo (mesmo padrão do CONFIRMATION_MARKER). Grupo 1 = AAAA-MM-DD,
// grupo 2 = HH:mm (opcional).
export const WAITLIST_MARKER =
  /LISTA_ESPERA:\s*(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::\d{2})?-03:00)?/
```

Em `ParsedMarkers`, adicionar:

```ts
  /** Dia (e horário, se o paciente nomeou um) que o paciente quer esperar, ou null. */
  waitlistDesired: { date: string; time: string | null } | null
```

Em `parseMarkers`, junto dos outros `.match(...)`:

```ts
  const waitlistMatch = rawMessage.match(WAITLIST_MARKER)
```

No encadeamento de `.replace(...)` que monta `cleanedMessage`, adicionar `.replace(WAITLIST_MARKER, '')` (antes do `.trim()`).

No objeto de retorno, adicionar:

```ts
    waitlistDesired: waitlistMatch ? { date: waitlistMatch[1], time: waitlistMatch[2] ?? null } : null,
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/agent/markers.test.ts`
Expected: PASS (todos, incluindo os pré-existentes).

- [ ] **Step 5: Commit**

```bash
git add lib/bot/parse-markers.ts tests/agent/markers.test.ts
git commit -m "feat(waitlist): marcador LISTA_ESPERA no parse-markers"
```

---

### Task 3: `prompt-builder` — passo do fluxo condicionado ao módulo

**Files:**
- Modify: `lib/bot/prompt-builder.ts` (`BuildPromptInput` em `:25`; passo 6 do fluxo em `:208`)
- Test: `tests/agent/prompt-builder.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `BuildPromptInput.waitlistEnabled?: boolean` (default `false`). Com `true`, o prompt contém a pergunta "(a) outro dia/horário, ou (b) entrar na lista de espera" e o formato exato `LISTA_ESPERA: AAAA-MM-DD`. Com `false`, o prompt **não** contém `LISTA_ESPERA`. Nos dois casos o ramo de alternativas manda "ordene pela proximidade ao horário que o paciente pediu".

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/agent/prompt-builder.test.ts`, novo bloco no fim:

```ts
describe('buildDynamicSystemPrompt — lista de espera', () => {
  it('não menciona LISTA_ESPERA quando o módulo está desligado (default)', () => {
    expect(build()).not.toContain('LISTA_ESPERA')
  })

  it('instrui a perguntar entre outro horário e a lista de espera quando habilitado', () => {
    const p = build({}, { waitlistEnabled: true })
    expect(p).toContain('lista de espera')
    expect(p).toContain('LISTA_ESPERA: AAAA-MM-DD')
    expect(p).toContain('nunca deve sair junto de AGENDAMENTO_CONFIRMADO')
  })

  it('sempre ordena as alternativas pela proximidade ao horário pedido', () => {
    expect(build()).toContain('proximidade ao horário')
    expect(build({}, { waitlistEnabled: true })).toContain('proximidade ao horário')
  })
})
```

(O helper `build(config, overrides)` já existe no arquivo e faz spread de `overrides` sobre o input — `waitlistEnabled` entra por aí.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/agent/prompt-builder.test.ts -t "lista de espera"`
Expected: FAIL — `waitlistEnabled` ignorado; strings ausentes.

- [ ] **Step 3: Implementar no `prompt-builder.ts`**

Em `BuildPromptInput` adicionar:

```ts
  // Módulo `waitlist` ativo na account — libera o passo de lista de espera.
  waitlistEnabled?: boolean
```

Na desestruturação de `buildDynamicSystemPrompt({ ... })` adicionar `waitlistEnabled = false,`.

Antes do `return`, montar os dois textos do passo:

```ts
  // Passo "dia/horário pedido não disponível": sem o módulo waitlist, só
  // oferece alternativas; com ele, pergunta se o paciente prefere alternativa
  // ou lista de espera.
  const noSlotBranch = waitlistEnabled
    ? ` Se não estiver, diga que aquele dia/horário está sem vaga e pergunte o que o paciente prefere: (a) outro dia/horário, ou (b) entrar na lista de espera para ser avisado se abrir uma vaga exatamente no dia (e horário) que ele queria.
   - Opção (a): sugira até 3 horários ordenados pela proximidade ao horário que ele tentou (mesmo dia primeiro e, dentro do dia, os horários mais perto do pedido; depois os dias vizinhos), sempre dentre os disponíveis daquela unidade. Siga com o agendamento normal.
   - Opção (b): confirme em linguagem natural ("beleza, te aviso se vagar quarta às 15h") e inclua uma linha isolada no formato exato:
LISTA_ESPERA: AAAA-MM-DD   (se o paciente deu só o dia)
LISTA_ESPERA: AAAA-MM-DDTHH:mm-03:00   (se deu um horário exato)
Inclua também a linha UNIDADE_ID da unidade escolhida. Essa linha é lida por um sistema automático, nunca deve ser mostrada ao paciente e nunca deve sair junto de AGENDAMENTO_CONFIRMADO.`
    : ` Se não estiver, sugira até 3 horários próximos — ordene pela proximidade ao horário que o paciente pediu (mesmo dia primeiro e, dentro do dia, os horários mais perto do pedido; depois os dias vizinhos) — sempre dentre os horários disponíveis daquela unidade`
```

No corpo do template, o passo do fluxo hoje é (`lib/bot/prompt-builder.ts:208`):

```ts
${multiUnit ? '6' : '5'}. Verifique se o dia/horário pedido está entre os horários disponíveis da unidade escolhida. Se estiver, siga com o agendamento. Se não estiver, sugira até 3 horários próximos — priorize o mesmo dia pedido e, se não houver, o dia seguinte — sempre dentre os horários disponíveis daquela unidade
```

Trocar por:

```ts
${multiUnit ? '6' : '5'}. Verifique se o dia/horário pedido está entre os horários disponíveis da unidade escolhida. Se estiver, siga com o agendamento.${noSlotBranch}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/agent/prompt-builder.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add lib/bot/prompt-builder.ts tests/agent/prompt-builder.test.ts
git commit -m "feat(waitlist): passo de lista de espera no prompt da Maria (gated por módulo)"
```

---

### Task 4: `agent.ts` — ler módulos, registrar a espera, fechar ao agendar

**Files:**
- Modify: `lib/analytics/posthog-server.ts` (perto de `trackWaitlistPatientNotified`, `:125`)
- Modify: `lib/llm/agent.ts` (import; passo 1.1 `:251`; `buildDynamicSystemPrompt(...)` `:376`; bloco novo após o cancelamento `:580`; dentro do `if (appt)` `:503`)
- Modify: `tests/helpers/agent-harness.ts` (`defaultSupabaseConfig` `:79`)
- Create: `tests/agent/waitlist.test.ts`

**Interfaces:**
- Consumes: `parseMarkers(...).waitlistDesired` (Task 2); `BuildPromptInput.waitlistEnabled` (Task 3); coluna `waitlist.source`/`desired_date`/`desired_time` (Task 1).
- Produces: `trackWaitlistPatientAddedByBot(accountId: string, props: { workspace_id: string; account_id: string }): void`. Comportamento em `agent.ts`: com `waitlistDesired`, módulo `waitlist` ativo, sem `confirmedDate` e com unidade resolvida → `insert` (ou `update` de entrada `waiting` do mesmo `workspace_id`+`patient_phone`+`desired_date`) em `waitlist` com `source:'bot'`, `status:'waiting'`. Ao concluir um agendamento → `update` `status:'scheduled'` em todas as linhas `waiting` daquele `patient_id`+`workspace_id`.

- [ ] **Step 1: Escrever os testes que falham**

Create `tests/agent/waitlist.test.ts` (copiar o cabeçalho de mocks de `tests/agent/scheduling.test.ts` — os mesmos `vi.mock` de `supabase/server`, `bot/config`, `whatsapp/send`, `crypto`, `google/availability`, `google/auth`, `google/calendar`, `@anthropic-ai/sdk`):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/supabase/server', async () => {
  const h = await import('../helpers/agent-harness')
  return { createAdminClient: () => h.state.supabase.client, createClient: async () => h.state.supabase.client }
})
vi.mock('@/lib/bot/config', async () => {
  const h = await import('../helpers/agent-harness')
  return { getBotConfig: async () => h.state.botConfig, getAccountUnits: async () => h.state.units, invalidateBotConfigCache: () => {} }
})
vi.mock('@/lib/whatsapp/send', async () => {
  const h = await import('../helpers/agent-harness')
  return { sendWhatsAppMessage: h.sendWhatsAppMessage }
})
vi.mock('@/lib/crypto', () => ({ decryptToken: (t: string) => `decrypted:${t}`, encryptToken: (t: string) => t }))
vi.mock('@/lib/google/availability', async () => {
  const h = await import('../helpers/agent-harness')
  return { getFreeSlotsForBot: h.getFreeSlotsForBot, isSlotAvailable: h.isSlotAvailable }
})
vi.mock('@/lib/google/auth', async () => {
  const h = await import('../helpers/agent-harness')
  return { isGoogleConnected: async () => ({ connected: h.state.googleConnected, email: h.state.googleEmail }) }
})
vi.mock('@/lib/google/calendar', async () => {
  const h = await import('../helpers/agent-harness')
  return { createEvent: h.createEvent, cancelEvent: h.cancelEvent }
})
vi.mock('@anthropic-ai/sdk', async () => {
  const h = await import('../helpers/agent-harness')
  return { default: class { messages = { create: h.claudeCreate } } }
})

import { processIncomingMessage } from '@/lib/llm/agent'
import { resetAgentHarness, mergeSupabaseConfig, state, PARAMS, UNIT_ID } from '../helpers/agent-harness'
import { filterValue } from '../helpers/supabase-mock'

const WL_ON = { accounts: { select: { data: { name: 'Clínica Teste', modules: ['waitlist'] } } } }

describe('processIncomingMessage — lista de espera', () => {
  beforeEach(() => resetAgentHarness())

  it('insere entrada bot quando LISTA_ESPERA vem com horário e a unidade é única', async () => {
    const supabase = mergeSupabaseConfig({
      ...WL_ON,
      waitlist: { select: { data: null }, insert: { data: { id: 'wl1' } }, update: { data: null } },
    })
    state.claudeResponses = ['Beleza, te aviso!\nLISTA_ESPERA: 2026-09-16T15:00-03:00']

    await processIncomingMessage(PARAMS)

    const insert = supabase.callsTo('waitlist', 'insert')[0]
    expect(insert?.payload).toMatchObject({
      workspace_id: UNIT_ID,
      account_id: PARAMS.accountId,
      patient_id: 'p1',
      patient_phone: PARAMS.patientPhone,
      desired_date: '2026-09-16',
      desired_time: '15:00',
      source: 'bot',
      status: 'waiting',
    })
  })

  it('grava desired_time null quando o paciente deu só o dia', async () => {
    const supabase = mergeSupabaseConfig({
      ...WL_ON,
      waitlist: { select: { data: null }, insert: { data: { id: 'wl1' } }, update: { data: null } },
    })
    state.claudeResponses = ['Te aviso!\nLISTA_ESPERA: 2026-09-16']

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('waitlist', 'insert')[0].payload).toMatchObject({ desired_date: '2026-09-16', desired_time: null })
  })

  it('atualiza a entrada existente em vez de criar outra (de-dupe)', async () => {
    const supabase = mergeSupabaseConfig({
      ...WL_ON,
      waitlist: { select: { data: { id: 'wl-existente' } }, insert: { data: null }, update: { data: null } },
    })
    state.claudeResponses = ['Te aviso!\nLISTA_ESPERA: 2026-09-16T16:00-03:00']

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('waitlist', 'insert')).toHaveLength(0)
    const update = supabase.callsTo('waitlist', 'update')[0]
    expect(update?.payload).toMatchObject({ desired_time: '16:00' })
    expect(filterValue(update!, 'eq', 'id')).toBe('wl-existente')
  })

  it('não toca em waitlist quando o módulo está desligado', async () => {
    const supabase = mergeSupabaseConfig({
      waitlist: { select: { data: null }, insert: { data: null }, update: { data: null } },
    })
    state.claudeResponses = ['Te aviso!\nLISTA_ESPERA: 2026-09-16']

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('waitlist', 'insert')).toHaveLength(0)
    expect(supabase.callsTo('waitlist', 'update')).toHaveLength(0)
  })

  it('fecha entradas waiting do paciente quando ele agenda', async () => {
    const supabase = mergeSupabaseConfig({
      ...WL_ON,
      appointments: { select: { data: [] }, insert: { data: { id: 'appt-1', patient_name: 'Paciente', patient_phone: PARAMS.patientPhone, type: 'consulta' } }, update: { data: null } },
      waitlist: { select: { data: null }, update: { data: null } },
    })
    state.claudeResponses = ['Confirmado!\nAGENDAMENTO_CONFIRMADO: 2025-09-15T10:00-03:00']

    await processIncomingMessage(PARAMS)

    const update = supabase.callsTo('waitlist', 'update').find((c) => (c.payload as { status?: string }).status === 'scheduled')
    expect(update).toBeDefined()
    expect(filterValue(update!, 'eq', 'patient_id')).toBe('p1')
    expect(filterValue(update!, 'eq', 'workspace_id')).toBe(UNIT_ID)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/agent/waitlist.test.ts`
Expected: FAIL — nenhuma escrita em `waitlist` acontece ainda.

- [ ] **Step 3: Adicionar `trackWaitlistPatientAddedByBot`**

Em `lib/analytics/posthog-server.ts`, ao lado de `trackWaitlistPatientNotified`:

```ts
export function trackWaitlistPatientAddedByBot(accountId: string, props: BaseProps) {
  return captureServer({
    distinctId: accountId,
    event: 'waitlist_patient_added_by_bot',
    properties: { ...props, ...NO_PERSON },
  })
}
```

- [ ] **Step 4: Ligar módulos no `agent.ts`**

Import (junto dos outros de `posthog-server`):

```ts
  trackWaitlistPatientAddedByBot,
```

Passo 1.1 — trocar o select de `accounts` (`lib/llm/agent.ts:253`):

```ts
    supabase.from('accounts').select('name, modules').eq('id', accountId).single(),
```

Logo após `const accountName = account?.name ?? 'nossa clínica'`:

```ts
  const waitlistEnabled =
    Array.isArray((account as { modules?: unknown })?.modules) &&
    (account as { modules: string[] }).modules.includes('waitlist')
```

Na chamada `buildDynamicSystemPrompt({ ... })` (`:376`), adicionar `waitlistEnabled,` ao objeto.

- [ ] **Step 5: Bloco de registro da espera**

Em `lib/llm/agent.ts`, logo após o bloco `if (markers.cancelledAppointmentId && patient) { ... }` (termina em `:580`):

```ts
  // Lista de espera — a Maria emite LISTA_ESPERA quando o paciente, sem vaga
  // no dia que queria, opta por ser avisado em vez de escolher outro horário.
  // Nunca junto de um agendamento confirmado; ignorado se o módulo waitlist
  // não estiver ativo na account.
  if (markers.waitlistDesired && waitlistEnabled && !markers.confirmedDate && patient) {
    const waitlistUnitId =
      (markers.unitId && allUnitById.has(markers.unitId) ? markers.unitId : null) ??
      currentUnitId ??
      (units.length === 1 ? units[0].id : null)

    if (waitlistUnitId) {
      const { data: existing } = await supabase
        .from('waitlist')
        .select('id')
        .eq('workspace_id', waitlistUnitId)
        .eq('patient_phone', patientPhone)
        .eq('desired_date', markers.waitlistDesired.date)
        .eq('status', 'waiting')
        .maybeSingle()

      if (existing) {
        await supabase
          .from('waitlist')
          .update({
            patient_id: patient.id,
            patient_name: patient.full_name ?? 'Paciente',
            desired_time: markers.waitlistDesired.time,
          })
          .eq('id', existing.id)
      } else {
        const { error: waitlistError } = await supabase.from('waitlist').insert({
          workspace_id: waitlistUnitId,
          account_id: accountId,
          patient_id: patient.id,
          patient_name: patient.full_name ?? 'Paciente',
          patient_phone: patientPhone,
          desired_date: markers.waitlistDesired.date,
          desired_time: markers.waitlistDesired.time,
          source: 'bot',
          status: 'waiting',
        })
        if (waitlistError) {
          console.error('waitlist insert (bot) falhou', waitlistError)
        } else {
          await trackWaitlistPatientAddedByBot(accountId, {
            workspace_id: waitlistUnitId,
            account_id: accountId,
          })
        }
      }
    }
  }
```

- [ ] **Step 6: Fechar entradas `waiting` ao agendar**

Dentro do `if (appt) {` do bloco de agendamento, logo após a chamada `await createBookingRevenueEntry(supabase, { ... })` (`lib/llm/agent.ts:519`):

```ts
          // Paciente que estava na lista de espera e acabou de agendar sai da lista.
          if (patient?.id) {
            await supabase
              .from('waitlist')
              .update({ status: 'scheduled' })
              .eq('workspace_id', bookingUnitId)
              .eq('patient_id', patient.id)
              .eq('status', 'waiting')
          }
```

- [ ] **Step 7: Ajustar o harness**

Em `tests/helpers/agent-harness.ts`, `defaultSupabaseConfig()` (`:81`):

```ts
    accounts: { select: { data: { name: 'Clínica Teste', modules: [] } } },
```

- [ ] **Step 8: Rodar os testes**

Run: `npx vitest run tests/agent/`
Expected: PASS — `waitlist.test.ts` novo + todos os pré-existentes de `tests/agent/` (nenhuma regressão; `modules: []` mantém a Maria sem lista de espera nos testes antigos).

- [ ] **Step 9: Verificar tipos e commitar**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

```bash
git add lib/analytics/posthog-server.ts lib/llm/agent.ts tests/helpers/agent-harness.ts tests/agent/waitlist.test.ts
git commit -m "feat(waitlist): Maria registra a espera e fecha entradas ao agendar"
```

---

### Task 5: `lib/waitlist/match.ts` — lógica pura de ramificação e texto do slot

**Files:**
- Create: `lib/waitlist/match.ts`
- Create: `tests/waitlist/match.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `WaitlistRow` — shape mínimo lido pelo cron (`id`, `workspace_id`, `account_id`, `patient_name`, `patient_phone`, `notified_at`, `desired_date`, `desired_time`, `source`).
  - `partitionWaitlist(rows: WaitlistRow[]): { bot: WaitlistRow[]; manual: WaitlistRow[] }` — `bot` = `source === 'bot' && desired_date != null`; resto vai pra `manual`.
  - `formatBotSlot(desiredDate: string, desiredTime: string | null, freeTimes: string[]): string` — texto pro template Meta. Com `desiredTime`: `"<dia da semana>, DD/MM às HH:mm"`. Sem: `"<dia da semana>, DD/MM — HH:mm, HH:mm, ..."`.

- [ ] **Step 1: Escrever os testes que falham**

Create `tests/waitlist/match.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { partitionWaitlist, formatBotSlot, type WaitlistRow } from '@/lib/waitlist/match'

const row = (over: Partial<WaitlistRow>): WaitlistRow => ({
  id: 'x', workspace_id: 'w1', account_id: 'a1', patient_name: 'Ana', patient_phone: '551199',
  notified_at: null, desired_date: null, desired_time: null, source: 'manual', ...over,
})

describe('partitionWaitlist', () => {
  it('manda source bot com desired_date para "bot" e o resto para "manual"', () => {
    const rows = [
      row({ id: 'a', source: 'bot', desired_date: '2026-09-16' }),
      row({ id: 'b', source: 'bot', desired_date: null }),      // bot sem data → manual
      row({ id: 'c', source: 'manual', desired_date: '2026-09-16' }), // manual com data → manual
      row({ id: 'd', source: 'manual' }),
    ]
    const { bot, manual } = partitionWaitlist(rows)
    expect(bot.map((r) => r.id)).toEqual(['a'])
    expect(manual.map((r) => r.id)).toEqual(['b', 'c', 'd'])
  })
})

describe('formatBotSlot', () => {
  it('nomeia o horário exato quando o paciente pediu um', () => {
    // 2026-09-16 é uma quarta-feira
    expect(formatBotSlot('2026-09-16', '15:00', [])).toBe('quarta-feira, 16/09 às 15:00')
  })

  it('lista os horários livres do dia quando o paciente pediu só o dia', () => {
    expect(formatBotSlot('2026-09-16', null, ['14:00', '15:30', '16:00'])).toBe(
      'quarta-feira, 16/09 — 14:00, 15:30, 16:00'
    )
  })

  it('corta o segundo do desired_time (HH:mm:ss → HH:mm)', () => {
    expect(formatBotSlot('2026-09-16', '15:00:00', [])).toBe('quarta-feira, 16/09 às 15:00')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/waitlist/match.test.ts`
Expected: FAIL — módulo `@/lib/waitlist/match` não existe.

- [ ] **Step 3: Implementar `lib/waitlist/match.ts`**

```ts
import { TZDate } from '@date-fns/tz'

const TZ = 'America/Sao_Paulo'

// Shape mínimo de uma linha de waitlist lida pelo cron.
export interface WaitlistRow {
  id: string
  workspace_id: string
  account_id: string
  patient_name: string
  patient_phone: string
  notified_at: string | null
  desired_date: string | null
  desired_time: string | null
  source: string
}

// Entradas da Maria (source 'bot' com dia desejado) casam só aquele dia; o
// resto — inclusive uma entrada 'bot' sem data, que não deveria existir —
// segue o caminho manual (próximos dias, qualquer vaga).
export function partitionWaitlist(rows: WaitlistRow[]): { bot: WaitlistRow[]; manual: WaitlistRow[] } {
  const bot: WaitlistRow[] = []
  const manual: WaitlistRow[] = []
  for (const r of rows) {
    if (r.source === 'bot' && r.desired_date) bot.push(r)
    else manual.push(r)
  }
  return { bot, manual }
}

// Texto do slot para o template Meta `waitlist_slot_specific`.
// `desiredDate` = 'AAAA-MM-DD'. Meio-dia evita qualquer efeito de borda de fuso.
export function formatBotSlot(desiredDate: string, desiredTime: string | null, freeTimes: string[]): string {
  const label = new TZDate(`${desiredDate}T12:00:00`, TZ).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  })
  if (desiredTime) return `${label} às ${desiredTime.slice(0, 5)}`
  return `${label} — ${freeTimes.join(', ')}`
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/waitlist/match.test.ts`
Expected: PASS.

> Se o `toLocaleDateString` do ambiente devolver a data com vírgula em posição diferente (ex.: `"quarta-feira, 16/09"` vs `"16/09, quarta-feira"`), ajustar as strings esperadas do teste ao formato real do Node em uso — o importante é o conteúdo (dia da semana + DD/MM), não a ordem exata imposta pela ICU.

- [ ] **Step 5: Commit**

```bash
git add lib/waitlist/match.ts tests/waitlist/match.test.ts
git commit -m "feat(waitlist): helpers puros de ramificação bot/manual e texto do slot"
```

---

### Task 6: Template Meta novo + cron ramifica `bot` / `manual`

**Files:**
- Modify: `lib/whatsapp/send.ts` (após `sendWaitlistTemplate`, `:143`)
- Modify: `app/api/cron/waitlist/route.ts` (arquivo inteiro reestruturado)
- Test: `tests/waitlist/match.test.ts` (já cobre a lógica pura; a rota é verificada por build + checagem manual, como as demais rotas de `app/api/cron/*`)

**Interfaces:**
- Consumes: `partitionWaitlist`, `formatBotSlot` (Task 5); `isSlotAvailable`, `getAvailableSlots` (`lib/google/availability.ts`); `trackWaitlistPatientNotified` (`lib/analytics/posthog-server.ts`).
- Produces: `sendWaitlistSpecificTemplate(p: { to: string; phoneNumberId: string; token: string; patientName: string; workspaceName: string; slot: string }): Promise<unknown>` — dispara o template Meta `waitlist_slot_specific` (pt_BR), body com 3 parâmetros de texto: `patientName`, `workspaceName`, `slot`.

- [ ] **Step 1: `sendWaitlistSpecificTemplate` em `send.ts`**

Após `sendWaitlistTemplate` (`lib/whatsapp/send.ts:143`):

```ts
interface SendWaitlistSpecificParams {
  to: string
  phoneNumberId: string
  token: string
  patientName: string
  workspaceName: string
  slot: string // "quarta-feira, 16/09 às 15:00" | "quarta-feira, 16/09 — 14:00, 15:30"
}

// Aviso de vaga para quem entrou na lista de espera pela Maria — nomeia o
// dia/horário específico que a pessoa queria. Template aprovado pela Meta.
export async function sendWaitlistSpecificTemplate({
  to,
  phoneNumberId,
  token,
  patientName,
  workspaceName,
  slot,
}: SendWaitlistSpecificParams) {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'waitlist_slot_specific',
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: patientName },
              { type: 'text', text: workspaceName },
              { type: 'text', text: slot },
            ],
          },
        ],
      },
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`WhatsApp API error: ${JSON.stringify(error)}`)
  }

  return response.json()
}
```

- [ ] **Step 2: Reestruturar `app/api/cron/waitlist/route.ts`**

Substituir o arquivo por:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/server'
import { sendWaitlistTemplate, sendWaitlistSpecificTemplate } from '@/lib/whatsapp/send'
import { decryptToken } from '@/lib/crypto'
import { getAvailableSlots, isSlotAvailable } from '@/lib/google/availability'
import { trackWaitlistPatientNotified } from '@/lib/analytics/posthog-server'
import { partitionWaitlist, formatBotSlot, type WaitlistRow } from '@/lib/waitlist/match'
import { addDays, format } from 'date-fns'
import { TZDate } from '@date-fns/tz'

const TZ = 'America/Sao_Paulo'
const DAYS_AHEAD = 3
const NOTIFY_COOLDOWN_HOURS = 24
const SLOT_DURATION_MIN = 30

// Disparado pelo Supabase pg_cron (ver supabase/cron.sql) uma vez por hora,
// 15min após o ponto.
// - Entradas manuais (equipe): vagas nos próximos DAYS_AHEAD dias.
// - Entradas da Maria (source 'bot'): só o dia (e horário) que o paciente
//   pediu, avisadas com o template que nomeia o slot.
// `notified_at` + cooldown de 24h evitam reenviar enquanto a vaga persistir.
export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const supabase = createAdminClient()

  // 1. Expira entradas da Maria cujo dia desejado já passou (fuso São Paulo).
  const todaySP = format(new TZDate(new Date(), TZ), 'yyyy-MM-dd')
  await supabase
    .from('waitlist')
    .update({ status: 'expired' })
    .eq('status', 'waiting')
    .not('desired_date', 'is', null)
    .lt('desired_date', todaySP)

  // 2. Entradas ainda em espera, fora do cooldown.
  const cooldownCutoff = new Date(Date.now() - NOTIFY_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString()
  const { data: entries, error } = await supabase
    .from('waitlist')
    .select(
      'id, workspace_id, account_id, patient_name, patient_phone, notified_at, desired_date, desired_time, source'
    )
    .eq('status', 'waiting')
    .or(`notified_at.is.null,notified_at.lt.${cooldownCutoff}`)
    .order('created_at') // FIFO

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!entries || entries.length === 0) return NextResponse.json({ notified: 0 })

  const { bot, manual } = partitionWaitlist(entries as WaitlistRow[])

  const workspaceIds = [...new Set(entries.map((e) => e.workspace_id))]
  const accountIds = [...new Set(entries.map((e) => e.account_id))]
  const [{ data: workspaces }, { data: botConfigs }] = await Promise.all([
    supabase.from('workspaces').select('id, name').in('id', workspaceIds),
    supabase.from('bot_config').select('account_id, phone_number_id, meta_token').in('account_id', accountIds),
  ])
  const workspaceById = new Map((workspaces ?? []).map((w) => [w.id, w]))
  const connByAccount = new Map((botConfigs ?? []).map((c) => [c.account_id, c]))

  let notified = 0
  const errors: string[] = []
  const markNotified = (id: string) =>
    supabase.from('waitlist').update({ notified_at: new Date().toISOString() }).eq('id', id)

  // 3. Entradas manuais — vagas em qualquer horário nos próximos DAYS_AHEAD dias.
  for (const entry of manual) {
    const workspace = workspaceById.get(entry.workspace_id)
    const conn = connByAccount.get(entry.account_id)
    if (!workspace || !conn?.phone_number_id || !conn?.meta_token) continue

    try {
      const slotsFound: string[] = []
      const today = new TZDate(new Date(), TZ)
      for (let i = 1; i <= DAYS_AHEAD; i++) {
        const day = addDays(today, i)
        const free = (await getAvailableSlots(entry.workspace_id, day)).filter((s) => s.available)
        if (free.length === 0) continue
        const times = free.slice(0, 3).map((s) => format(s.start, 'HH:mm')).join(', ')
        slotsFound.push(`${format(day, 'dd/MM')}: ${times}`)
      }
      if (slotsFound.length === 0) continue

      await sendWaitlistTemplate({
        to: entry.patient_phone,
        phoneNumberId: conn.phone_number_id,
        token: decryptToken(conn.meta_token),
        patientName: entry.patient_name,
        workspaceName: workspace.name,
        slots: slotsFound.join(' | '),
      })
      await markNotified(entry.id)
      await trackWaitlistPatientNotified(entry.workspace_id, {
        workspace_id: entry.workspace_id,
        account_id: entry.account_id,
      })
      notified += 1
    } catch (err) {
      errors.push(`${entry.id}: ${String(err)}`)
    }
  }

  // 4. Entradas da Maria — casa só o dia (e horário) desejado.
  for (const entry of bot) {
    const workspace = workspaceById.get(entry.workspace_id)
    const conn = connByAccount.get(entry.account_id)
    if (!workspace || !conn?.phone_number_id || !conn?.meta_token || !entry.desired_date) continue

    try {
      let slot: string | null = null
      if (entry.desired_time) {
        const at = new TZDate(`${entry.desired_date}T${entry.desired_time.slice(0, 5)}-03:00`, TZ)
        const ok = await isSlotAvailable(entry.workspace_id, at, SLOT_DURATION_MIN)
        slot = ok ? formatBotSlot(entry.desired_date, entry.desired_time, []) : null
      } else {
        const day = new TZDate(`${entry.desired_date}T12:00:00`, TZ)
        const free = (await getAvailableSlots(entry.workspace_id, day)).filter((s) => s.available)
        slot = free.length
          ? formatBotSlot(entry.desired_date, null, free.slice(0, 3).map((s) => format(s.start, 'HH:mm')))
          : null
      }
      if (!slot) continue

      await sendWaitlistSpecificTemplate({
        to: entry.patient_phone,
        phoneNumberId: conn.phone_number_id,
        token: decryptToken(conn.meta_token),
        patientName: entry.patient_name,
        workspaceName: workspace.name,
        slot,
      })
      await markNotified(entry.id)
      await trackWaitlistPatientNotified(entry.workspace_id, {
        workspace_id: entry.workspace_id,
        account_id: entry.account_id,
      })
      notified += 1
    } catch (err) {
      errors.push(`${entry.id}: ${String(err)}`)
    }
  }

  return NextResponse.json({ notified, total: entries.length, errors })
}
```

- [ ] **Step 3: Rodar a suíte e os tipos**

Run: `npx vitest run tests/waitlist/ && npx tsc --noEmit`
Expected: PASS + sem erros de tipo.

- [ ] **Step 4: Build (verificação da rota, que não tem teste próprio — padrão de `app/api/cron/*`)**

Run: `npm run build`
Expected: build conclui sem erro de tipo/lint na rota.

Checagem manual descrita (executor não roda, só registra no PR): com `waitlist` contendo (a) uma linha `source='bot'`, `desired_date` = amanhã, `desired_time` = um horário livre → `POST /api/cron/waitlist` responde `notified >= 1` e dispara `waitlist_slot_specific`; (b) a mesma com `desired_date` no passado → vira `status='expired'` e não notifica; (c) uma linha `source='manual'` → caminho antigo, `waitlist_slot_available`.

- [ ] **Step 5: Commit**

```bash
git add lib/whatsapp/send.ts app/api/cron/waitlist/route.ts
git commit -m "feat(waitlist): cron casa o slot exato das entradas da Maria + template Meta novo"
```

---

### Task 7: Tela `/lista-espera` mostra o desejo e a origem

**Files:**
- Modify: `components/waitlist/WaitlistClient.tsx`

**Interfaces:**
- Consumes: `waitlist.Row` com `desired_date`/`desired_time`/`source` (Task 1); `WaitlistStatus` com `'expired'` (Task 1).
- Produces: nada para outras tasks. UI: rótulo/estilo para `expired`; sob o nome do paciente, `"Quer DD/MM [às HH:mm]"` quando há `desired_date`, e a tag `"via WhatsApp"` quando `source === 'bot'`.

- [ ] **Step 1: `expired` nos mapas de status**

Em `components/waitlist/WaitlistClient.tsx`:

```ts
const STATUS_LABEL: Record<WaitlistStatus, string> = {
  waiting: 'Aguardando',
  scheduled: 'Agendado',
  cancelled: 'Cancelado',
  expired: 'Expirada',
}

const STATUS_STYLE: Record<WaitlistStatus, string> = {
  waiting: 'bg-[var(--cyan-10)] text-[var(--cyan-dark)]',
  scheduled: 'bg-green-100 text-green-700',
  cancelled: 'bg-[var(--navy-06)] text-[var(--navy)]',
  expired: 'bg-[var(--navy-06)] text-[var(--navy)]',
}
```

- [ ] **Step 2: Helper de formatação + célula do paciente**

Acima do componente `WaitlistClient`:

```tsx
function formatDesired(date: string, time: string | null): string {
  const [, m, d] = date.split('-')
  return `${d}/${m}${time ? ` às ${time.slice(0, 5)}` : ''}`
}
```

Trocar a `<td>` do paciente (`components/waitlist/WaitlistClient.tsx:116`):

```tsx
                  <td className="px-5 py-3 font-medium text-gray-900">
                    {e.patient_name}
                    {(e.desired_date || e.source === 'bot') && (
                      <span className="mt-0.5 block text-xs font-normal text-gray-400">
                        {e.desired_date ? `Quer ${formatDesired(e.desired_date, e.desired_time)}` : ''}
                        {e.source === 'bot' ? `${e.desired_date ? ' · ' : ''}via WhatsApp` : ''}
                      </span>
                    )}
                  </td>
```

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros — `e.desired_date`/`e.desired_time`/`e.source` existem no tipo `waitlist.Row` depois da Task 1.

- [ ] **Step 4: Commit**

```bash
git add components/waitlist/WaitlistClient.tsx
git commit -m "feat(waitlist): tela mostra dia/horário desejado, origem e status expirada"
```

---

## Fechamento

- [ ] **Suíte completa**

Run: `npm test`
Expected: PASS — nada de `tests/agent/`, `tests/waitlist/`, `tests/google/` regrediu.

- [ ] **Ação externa (fora do repo, registrar no PR)**

Submeter no Meta Business Manager o template `waitlist_slot_specific` (categoria Utility, idioma pt_BR), 3 variáveis de corpo. Texto sugerido:

> Oi {{1}}! Abriu uma vaga na {{2}} no horário que você queria: {{3}}. Quer que eu confirme? É só me responder por aqui.

O cron só entrega `bot` depois que o template estiver aprovado; enquanto isso as entradas `bot` ficam `waiting` e expiram no dia (sem efeito colateral nas entradas `manual`).

- [ ] **Aplicar a migração**

Rodar `supabase/migration_waitlist_maria.sql` no SQL Editor do Supabase (produção e staging).

---

## Self-Review

**1. Cobertura da spec:**

| Item da spec | Task |
|---|---|
| `desired_date` / `desired_time` / `source` / status `expired` / índices | Task 1 |
| `types/database.ts` (`waitlist` Row + `WaitlistStatus`) | Task 1 |
| `WAITLIST_MARKER` + `waitlistDesired` | Task 2 |
| Passo 6 reescrito, gate por `accounts.modules` | Task 3 (prompt) + Task 4 (`waitlistEnabled` no agent) |
| Ordenação por proximidade ao horário pedido (inclusive com módulo off) | Task 3 |
| Upsert da entrada (`source:'bot'`), de-dupe, multi-unidade sem unidade → no-op | Task 4 |
| Fechar linhas `waiting` ao agendar | Task 4 |
| `trackWaitlistPatientAddedByBot` | Task 4 |
| Nota de implementação: evitar `onConflict` sobre índice parcial → select-then-insert/update | Task 4 (Step 5 usa exatamente esse padrão) |
| Expiração (`desired_date < hoje` SP → `expired`) | Task 6 (Step 2, item 1 da rota) |
| Cron ramifica `bot` (só o dia desejado, `isSlotAvailable`/`getAvailableSlots`) vs `manual` (inalterado) | Task 5 (puro) + Task 6 (rota) |
| `sendWaitlistSpecificTemplate` + template `waitlist_slot_specific` | Task 6 |
| Cooldown 24h reaproveitado, para quando sai de `waiting`/dia passa | Task 6 |
| Tela: rótulo `expired`, `desired_date`/`desired_time`, tag "via WhatsApp"; form manual inalterado | Task 7 |
| Ação externa: submeter template na Meta | Fechamento |

Sem lacunas. Desvio consciente do texto da spec: a spec listava `tests/cron/waitlist.test.ts` com asserts na rota; o repositório não testa rotas de `app/api/cron/*` (ver `daily-revenue-summary`) e extrai lógica pura para libs (`lib/revenue/summary.ts` + `tests/revenue/summary.test.ts`). O plano segue esse padrão: lógica pura em `lib/waitlist/match.ts` com `tests/waitlist/match.test.ts` (ramificação + texto do slot), comportamento da rota verificado por `npm run build` + checagem manual descrita. Expiração e cooldown ficam sem teste automatizado — mesmo nível de cobertura das outras rotas de cron.

**2. Placeholders:** nenhum "TBD"/"TODO"/"handle edge cases" — todo passo tem código real ou comando concreto.

**3. Consistência de tipos:**
- `waitlistDesired: { date: string; time: string | null } | null` — definido na Task 2, consumido igual na Task 4.
- `WaitlistRow` — definido na Task 5, importado na Task 6 com o mesmo shape do `.select(...)` da rota.
- `formatBotSlot(desiredDate, desiredTime, freeTimes)` — mesma assinatura na Task 5 (def), Task 6 (2 chamadas).
- `sendWaitlistSpecificTemplate({ to, phoneNumberId, token, patientName, workspaceName, slot })` — mesma forma na Task 6 (def em `send.ts` e chamada na rota).
- `trackWaitlistPatientAddedByBot(accountId, { workspace_id, account_id })` — mesma assinatura na Task 4 (def em `posthog-server.ts` e chamada no agent).
- `waitlistEnabled` — opcional em `BuildPromptInput` (Task 3), passado pelo agent (Task 4).
- `partitionWaitlist(rows) → { bot, manual }` — Task 5 (def), Task 6 (uso).
