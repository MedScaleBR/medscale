# Conversões para a Meta (LeadSubmitted no agendamento) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toda consulta marcada por paciente que veio de anúncio Click-to-WhatsApp vira um evento `LeadSubmitted` na Conversions API for Business Messaging da Meta.

**Architecture:** Uma tabela `meta_conversion_events` guarda cada evento com `dedup_key` único por account (a Meta não deduplica). `queueLeadConversion` acha o `ctwa_clid` em `lead_attributions`, grava a linha e tenta enviar na hora; um cron reenvia o que falhou. Quatro pontos de agendamento chamam a função, sempre best-effort.

**Tech Stack:** Next.js 16 route handlers, Supabase (admin client), Vitest, PGlite (teste de migration), Graph API via `lib/meta/graph.ts`.

**Spec:** `docs/superpowers/specs/2026-11-09-meta-capi-agendamento-design.md`

## Global Constraints

- Evento único: `event_name: "LeadSubmitted"`, `action_source: "business_messaging"`, `messaging_channel: "whatsapp"`.
- Nenhum `value`/`currency`/`custom_data` no payload.
- `user_data` = `{ whatsapp_business_account_id, ctwa_clid }`; top-level `partner_agent: "medscale"`; `event_id` = `dedup_key`.
- Sem `ctwa_clid` → nada é gravado nem enviado.
- Nada daqui lança para o chamador; nenhuma falha da Meta afeta agendamento ou resposta ao paciente.
- Logs só com ids (LGPD) — nunca telefone, nome, `ctwa_clid`.
- `dedup_key`: `appt:<appointment_id>` (agenda interna e terceirizado) ou `ext:<conversation_id>:<AAAA-MM-DD São Paulo>` (agenda externa).
- Reenvio: no máximo 5 tentativas, só eventos com `event_time` nos últimos 7 dias.
- Comparação de telefone sempre via `brazilianPhoneKey` (`lib/phone.ts`).

## Review Focus

1. Paciente clicou em dois anúncios → usar o `ctwa_clid` mais recente com `occurred_at` ≤ momento do agendamento (Task 2: `pickClickId` "pega o clique mais recente anterior").
2. Telefone da consulta manual com máscara / sem nono dígito → ainda encontra o lead (Task 2: teste com `(61) 9570-4956` vs `5561995704956`).
3. Mesmo agendamento disparado duas vezes (retry, terceirizado confirmado depois) → uma linha só (Task 3: "mesmo dedup_key não reenvia").
4. Account sem `waba_id`/`meta_token` → grava `failed` com `last_error = 'not_connected'`, não lança (Task 3).
5. Token sem a permissão nova (erro 190/200 da Meta) → `failed`, sem loop no cron além de 5 tentativas (Tasks 3 e 5).

---

## File Structure

- Create `supabase/migration_meta_conversions.sql` — tabela + coluna `bot_config.meta_dataset_id`.
- Modify `types/database.ts` — tipos da tabela e da coluna.
- Create `lib/meta/conversions.ts` — partes puras (`pickClickId`, `buildLeadSubmittedPayload`, `externalRequestDedupKey`) e I/O (`queueLeadConversion`, `sendConversionEvent`, `ensureDatasetId`).
- Modify `app/api/appointments/route.ts`, `lib/llm/agent.ts` — os quatro gatilhos.
- Create `app/api/cron/meta-conversions/route.ts`; modify `supabase/cron.sql`.
- Tests: `tests/meta/conversions-migration.test.ts`, `tests/meta/conversions.test.ts`, `tests/meta/conversions-cron-route.test.ts`, mais casos nos testes existentes dos pontos de chamada.

---

### Task 1: Migration e tipos

**Files:**
- Create: `supabase/migration_meta_conversions.sql`
- Modify: `types/database.ts` (bloco `bot_config` ~linha 1230; nova tabela ao lado de `lead_attributions` ~linha 1335)
- Test: `tests/meta/conversions-migration.test.ts`

**Interfaces:**
- Produces: tabela `public.meta_conversion_events(id uuid pk default gen_random_uuid(), account_id uuid not null references accounts on delete cascade, appointment_id uuid null references appointments on delete set null, dedup_key text not null, event_name text not null default 'LeadSubmitted', ctwa_clid text not null, event_time timestamptz not null, status text not null default 'pending' check in ('pending','sent','failed'), attempts int not null default 0, last_error text null, sent_at timestamptz null, created_at timestamptz not null default now(), unique(account_id, dedup_key))`; índice parcial em `(status, event_time) where status <> 'sent'`; RLS habilitada com policy só de `select` por `account_id = any(public.my_account_ids())` (mesmo padrão de `migration_lead_attribution.sql`); `alter table public.bot_config add column if not exists meta_dataset_id text`. Tipos `Database['public']['Tables']['meta_conversion_events']` (Row/Insert/Update) e `bot_config.Row.meta_dataset_id: string | null`.

- [ ] **Step 1: Write failing test** — no padrão PGlite de `tests/outsourced/migration.test.ts` (criar `auth.uid`, `accounts`, `appointments`, `bot_config(account_id uuid)`, função `public.my_account_ids()` stub). Casos:
  - `aplica duas vezes sem erro` (idempotente).
  - `recusa dedup_key repetido na mesma account` — segundo insert `('acc','appt:1')` falha com unique violation; mesma chave em outra account passa.
  - `recusa status fora da lista` — `status = 'x'` falha.
  - `adiciona meta_dataset_id em bot_config`.
- [ ] **Step 2:** `npx vitest run tests/meta/conversions-migration.test.ts` → FAIL (arquivo não existe).
- [ ] **Step 3:** Escrever a migration (`create table if not exists`, `create index if not exists`, `drop policy if exists` antes de `create policy`) e os tipos.
- [ ] **Step 4:** Mesmo comando → PASS. `npx tsc --noEmit` sem erros novos.
- [ ] **Step 5: Commit** — `feat(meta): tabela de eventos de conversão para a Meta`

---

### Task 2: Partes puras

**Files:**
- Create: `lib/meta/conversions.ts`
- Test: `tests/meta/conversions.test.ts`

**Interfaces:**
- Produces:
  - `pickClickId(rows: { patient_phone: string; ctwa_clid: string | null; occurred_at: string }[], patientPhone: string, occurredAt: Date): string | null` — filtra por `brazilianPhoneKey` igual, `ctwa_clid` não nulo, `occurred_at <= occurredAt`; devolve o de `occurred_at` mais recente.
  - `buildLeadSubmittedPayload(e: { dedupKey: string; eventTime: Date; wabaId: string; ctwaClid: string }): { data: object[]; partner_agent: 'medscale' }` — `event_time` em segundos Unix (`Math.floor(ms/1000)`).
  - `externalRequestDedupKey(conversationId: string, at: Date): string` — `ext:<id>:<AAAA-MM-DD>` no fuso `America/Sao_Paulo` (usar `TZDate` de `@date-fns/tz` + `format`, como `app/api/cron/waitlist/route.ts`).
  - `appointmentDedupKey(appointmentId: string): string` — `appt:<id>`.

- [ ] **Step 1: Write failing tests:**
  - `pickClickId pega o clique mais recente anterior ao agendamento` — rows em 01/11 (`A`), 05/11 (`B`), 10/11 (`C`), agendamento em 06/11 → `'B'`.
  - `pickClickId casa telefone com máscara e sem nono dígito` — row `5561995704956`, consulta `(61) 9570-4956` → acha.
  - `pickClickId ignora ctwa_clid nulo e telefone de outro paciente` → `null`.
  - `buildLeadSubmittedPayload monta o evento sem valor` — `toEqual({ data: [{ event_name: 'LeadSubmitted', event_time: 1731160000, event_id: 'appt:1', action_source: 'business_messaging', messaging_channel: 'whatsapp', user_data: { whatsapp_business_account_id: 'W', ctwa_clid: 'C' } }], partner_agent: 'medscale' })` para `eventTime = new Date(1731160000_000)`.
  - `externalRequestDedupKey usa o dia de São Paulo` — `2026-11-10T02:30:00Z` → `ext:c1:2026-11-09`.
- [ ] **Step 2:** `npx vitest run tests/meta/conversions.test.ts` → FAIL.
- [ ] **Step 3:** Implementar as quatro funções.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** — `feat(meta): montagem do LeadSubmitted e escolha do clique`

---

### Task 3: Enfileirar e enviar

**Files:**
- Modify: `lib/meta/conversions.ts`
- Test: `tests/meta/conversions.test.ts`

**Interfaces:**
- Consumes: Task 1 (tabela, `meta_dataset_id`), Task 2 (funções puras), `graphFetch`/`MetaApiError` de `lib/meta/graph.ts`, `decryptToken` de `lib/crypto.ts`, `createAdminClient`.
- Produces:
  - `queueLeadConversion(input: { accountId: string; patientPhone: string; dedupKey: string; appointmentId?: string | null; occurredAt?: Date }, client = createAdminClient()): Promise<void>` — nunca lança. `occurredAt` default `new Date()`.
  - `sendConversionEvent(eventId: string, client = createAdminClient()): Promise<'sent' | 'failed'>` — nunca lança.
  - `ensureDatasetId(accountId: string, wabaId: string, token: string, client): Promise<string>` — interna, exportada só para teste.

Comportamento:
- `queueLeadConversion`: busca `lead_attributions` (`account_id`, `ctwa_clid not null`, `patient_phone like '%<últimos 8 dígitos>'`), `pickClickId`; se `null` retorna. Senão `upsert` em `meta_conversion_events` com `onConflict: 'account_id,dedup_key', ignoreDuplicates: true` e `.select('id')`; se não voltou linha (já existia) retorna sem enviar; senão chama `sendConversionEvent(id)`. Envolve tudo em try/catch com `console.error('[meta-capi] ...', { accountId })`.
- `sendConversionEvent`: lê o evento + `bot_config(waba_id, meta_token, meta_dataset_id)` da account. Sem `waba_id` ou `meta_token` → `failed`, `last_error = 'not_connected'`. Dataset: usa `meta_dataset_id`; se nulo, `graphFetch('/{waba}/dataset', { method: 'POST', token })` → `{ id }`, grava em `bot_config`. Envia `graphFetch('/{dataset}/events', { method: 'POST', token, body: buildLeadSubmittedPayload(...) })` (o `graphFetch` já serializa `data` como JSON no form). Sucesso → `status 'sent'`, `sent_at`, `attempts + 1`. `MetaApiError` → `failed`, `attempts + 1`, `last_error = \`${code}:${message}\`` truncado em 300 chars.

- [ ] **Step 1: Write failing tests** (mock de client no estilo de `tests/webhook/referral.test.ts` ou `tests/helpers/supabase-mock.ts`; `vi.mock('@/lib/meta/graph')`):
  - `não grava nada quando o paciente não tem ctwa_clid` — upsert não chamado.
  - `grava e envia quando há clique` — upsert com `{ account_id, dedup_key: 'appt:1', ctwa_clid: 'C', appointment_id: '1' }`; `graphFetch` chamado com `'/D/events'`.
  - `mesmo dedup_key não reenvia` — upsert devolve `data: []` → `graphFetch` não chamado.
  - `cria o dataset uma vez e guarda em bot_config` — `meta_dataset_id` nulo → POST `/W/dataset`, update `bot_config` com `{ meta_dataset_id: 'D' }`.
  - `account sem WhatsApp conectado marca failed not_connected`.
  - `erro da Meta marca failed com código e não lança` — `graphFetch` rejeita `new MetaApiError('no perm', 200, null, 403)` → update com `status: 'failed'`, `last_error` começando com `'200:'`; `queueLeadConversion` resolve `undefined`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** — `feat(meta): enfileira e envia LeadSubmitted para a Meta`

---

### Task 4: Gatilhos na agenda interna e no terceirizado

**Files:**
- Modify: `app/api/appointments/route.ts` (depois do insert bem-sucedido, dentro do `if (data)` ~linha 183)
- Modify: `lib/llm/agent.ts` — `bookAppointment` (depois de `if (!appt) return false` ~linha 785) e o `case 'outsourced_request'` (~linha 518, quando `result.kind === 'requested' || result.kind === 'send_failed'`)
- Test: teste existente da rota de appointments (procurar em `tests/` por `app/api/appointments/route`), `tests/agent/` (usar `tests/helpers/agent-harness.ts`)

**Interfaces:**
- Consumes: `queueLeadConversion`, `appointmentDedupKey` (Tasks 2–3).
- Chamada: `await queueLeadConversion({ accountId, patientPhone, dedupKey: appointmentDedupKey(appt.id), appointmentId: appt.id })`. Na rota manual, `patientPhone = data.patient_phone`; pular se vazio. Status `cancelado` na criação manual não dispara.

- [ ] **Step 1: Write failing tests** (`vi.mock('@/lib/meta/conversions')`):
  - rota: `agendamento manual dispara LeadSubmitted com appt:<id>`; `não dispara quando o insert falha`.
  - agente: `Clara marcando direto dispara appt:<id>`; `solicitação terceirizada dispara appt:<id>`; `already_pending não dispara`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Adicionar as chamadas.
- [ ] **Step 4:** Testes desses arquivos → PASS.
- [ ] **Step 5: Commit** — `feat(meta): agendamento interno e terceirizado avisam a Meta`

---

### Task 5: Gatilho na agenda externa

**Files:**
- Modify: `lib/llm/agent.ts` — logo depois de `executeHandoff(...)` no ramo `externalRequest.inHours` (~linha 640) e depois de `recordPendingExternalRequest(...)` (~linha 696)
- Test: `tests/agent/` (mesmo harness)

**Interfaces:**
- Chamada: `await queueLeadConversion({ accountId, patientPhone, dedupKey: externalRequestDedupKey(conversationId, ctx.now ?? new Date()) })`.

- [ ] **Step 1: Write failing tests:** `solicitação de agenda externa no horário dispara ext:<conversa>:<dia>`; `fora do horário também dispara`.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS.
- [ ] **Step 5: Commit** — `feat(meta): solicitação da agenda externa avisa a Meta`

---

### Task 6: Cron de reenvio

**Files:**
- Create: `app/api/cron/meta-conversions/route.ts`
- Modify: `supabase/cron.sql` (novo bloco no padrão de `waitlist-notify`, `'*/30 * * * *'`, url `https://medscalebr.com/api/cron/meta-conversions`)
- Test: `tests/meta/conversions-cron-route.test.ts` (padrão de `tests/meta/ads-sync-cron-route.test.ts`)

**Interfaces:**
- Consumes: `sendConversionEvent`, `requireCronAuth`.
- `POST`: `requireCronAuth`; seleciona `id` de `meta_conversion_events` com `status in ('pending','failed')`, `attempts < 5`, `event_time >= now - 7d`, limite 200; chama `sendConversionEvent` em sequência; responde `{ processed, sent, failed }`.

- [ ] **Step 1: Write failing tests:** `recusa sem CRON_SECRET (401)`; `filtra por status, attempts < 5 e janela de 7 dias`; `conta enviados e falhos`.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS.
- [ ] **Step 5:** `npm test` inteiro e `npx tsc --noEmit` verdes (não rodar `npm run lint` num worktree — estoura memória).
- [ ] **Step 6: Commit** — `feat(meta): cron reenvia conversões que falharam`

---

## Depois do código (usuário, fora do repo)

1. Aplicar `supabase/migration_meta_conversions.sql` no dev e no prod; reaplicar o bloco novo de `supabase/cron.sql` no prod.
2. Pedir `whatsapp_business_manage_events` no app da Meta e incluir no `config_id` do Embedded Signup; reconectar o WhatsApp de uma clínica de teste.
3. Fazer um agendamento de um número que veio de anúncio e conferir o `LeadSubmitted` no Gerenciador de Eventos.
