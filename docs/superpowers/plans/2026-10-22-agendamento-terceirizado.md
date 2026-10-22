# Agendamento terceirizado (clínica parceira / IAD) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Em unidades marcadas como terceirizadas, a Clara cria o agendamento como `pendente_confirmacao_externa`, envia o template `solicitacao_agendamento` à clínica parceira, interpreta a resposta "CONSULTA AGENDADA" de forma determinística e só então confirma ao paciente — tudo o que não for confirmação inequívoca vai para a equipe.

**Architecture:** Módulo novo `lib/outsourced/*` (config, parser, templates, mensagens, request, confirm, clinic-reply, notify) plugado em três pontos já existentes: o bloco `AGENDAMENTO_CONFIRMADO`/`CANCELAMENTO_CONFIRMADO` de `lib/llm/agent.ts`, um desvio no `after()` do webhook (antes de qualquer fluxo de paciente) e a rota `PATCH /api/appointments/[id]` (confirmação manual). O status novo entra no CHECK de `appointments.status`; a disponibilidade passa a tratá-lo como ocupado; crons e reconcile o protegem.

**Tech Stack:** Next.js 16 (App Router, `after()`, route handlers com `params` Promise), Supabase (Postgres + RLS, `createAdminClient` no webhook/agent/cron), Meta Cloud API (templates), Google Calendar (`googleapis`), `@date-fns/tz` (`TZDate`), Vitest (+ PGlite para SQL).

**Spec:** `docs/superpowers/specs/2026-10-22-agendamento-terceirizado-design.md` (autoridade; este plano argumenta a partir dele)

## Global Constraints

Regras do spec (valem para todas as tasks):

- **Uma Clara por account.** Nada de `bot_config` por unidade, nada de número novo. Token/número vêm de `bot_config` da account (`phone_number_id`, `meta_token` cifrado → `decryptToken`).
- **A Clara nunca responde à clínica parceira.** O único outbound para `external_clinic_phone` em todo o código é o template `solicitacao_agendamento` (Task 7). Nenhum `sendWhatsAppMessage`/`sendTemplateMessage` com `to` = telefone da clínica em nenhum outro lugar.
- **Nunca confirma por engano:** só confirma com exatamente 1 pendente correlacionado na mesma `workspace_id`. Todo o resto → equipe.
- **Opt-in por unidade:** fluxo terceirizado só quando `isOutsourcedWorkspace(ws)` (`is_outsourced = true` **e** `external_clinic_phone` preenchido). Fora disso, comportamento idêntico ao atual — nenhum teste existente de `tests/agent/*` pode mudar de resultado.
- **Mensagens da clínica parceira nunca criam `patients`, `conversations` nem `messages`.** (`webhook_logs` continua recebendo o payload cru como hoje, para todo número — fora do escopo.)
- **Não tocar no MedX** nem em token/sessão de terceiros.
- **LGPD:** `raw_text`, nome, nascimento, convênio e telefone do paciente **nunca** em `console.*`, Sentry, PostHog nem payload de push. Logar só ids, status, classificação e contagens. (O scrub do Sentry só redige telefone; qualquer texto em `console.*` vira breadcrumb.)
- **Clients Supabase:** `createClient` (RLS) nas rotas de usuário; `createAdminClient` só em webhook, agent, `lib/outsourced/*` e crons.
- **Timezone:** `TZDate` em `America/Sao_Paulo` no parser, na correlação e nas mensagens.
- **Custo:** nenhuma chamada extra ao Claude.
- **Next.js 16:** antes de mexer em route handler / `after()`, ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` e `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`.
- **SQL:** nunca executar SQL em lugar nenhum (nem MCP do Supabase). Migração incremental em `supabase/migration_agendamento_terceirizado.sql`; `supabase/schema.sql` atualizado para o estado final. `schema.sql` **precisa continuar terminando exatamente** com o conteúdo de `supabase/billing-authenticated.sql` (checado por `tests/billing/database.test.ts`) — nada é acrescentado no fim do arquivo.
- **Git:** o working tree tem alterações do usuário não relacionadas (`components/admin/tasks/TaskCard.tsx`, `components/layout/Sidebar.tsx`, `.claude/*`, `.codex/`). **Nunca** `git add -A`/`git add .`/`git commit -a`; só `git add <caminhos da task>`. Mensagens de commit terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nunca push, nunca PR.
- **Comandos:** testes com `npx vitest run --exclude '**/node_modules/**' --exclude '**/.claude/**' <arquivos>`; suíte completa com `npx vitest run --exclude '**/node_modules/**' --exclude '**/.claude/**'`; lint com `npx eslint <arquivos>`; tipos com `npx tsc --noEmit` (worktrees em `.claude/` quebram `npm test`/`npm run lint`).
- Textos de UI e comentários em português, no tom e densidade dos arquivos vizinhos.

### Fatos verificados no código (os "confirmar" do spec)

| Item | Resposta |
|---|---|
| Status de appointment | **CHECK, não ENUM.** `supabase/schema.sql:659-660`: `status text not null default 'agendado' check (status in ('agendado','confirmado','realizado','cancelado','no_show'))` — constraint inline, nome automático `appointments_status_check`. Logo o passo 2 do spec vira drop+recreate da constraint (sem problema de transação do `ALTER TYPE`, mas o bloco fica isolado mesmo assim). TS: `AppointmentStatus` em `types/database.ts:10`. |
| `patients.birth_date` | **Já existe** (`schema.sql:569`, `birth_date date`; tipo `birth_date: string \| null` em `types/database.ts`). Migração usa `add column if not exists` só por segurança. |
| `handoff_logs.conversation_id` | **Nullable** (`references conversations on delete set null`, sem `not null`). |
| `handoff_logs.trigger_reason` | **Sem CHECK** (texto livre; valores só no comentário e em `HandoffTriggerReason`, `types/database.ts:44-49`). Basta estender o tipo TS. |
| `handoff_logs.patient_phone` | **`text not null`** — notificação sem paciente (resposta ambígua, config) não teria valor. A migração faz `alter column patient_phone drop not null`. |
| `handoff_logs` em UI | Nenhuma tela lê `handoff_logs` hoje (só inserts em `lib/bot/handoff.ts` e `lib/llm/agent.ts`). |
| `my_workspace_ids()` | `public.my_workspace_ids() returns uuid[]` (`schema.sql:1610`), uso padrão `workspace_id = any(public.my_workspace_ids())`. |
| `AGENDAMENTO_CONFIRMADO` | Regex em `lib/bot/parse-markers.ts` (`CONFIRMATION_MARKER`); interceptado em `lib/llm/agent.ts:574-688` (`if (markers.confirmedDate && !insuranceNeedsClarification)`), unidade resolvida em `:575-578`, `isSlotAvailable` em `:597`, insert `status: 'agendado'` em `:603-625`, Google em `:663-682`. |
| `CANCELAMENTO_CONFIRMADO` | `lib/llm/agent.ts:691-716`: busca `.in('status', ['agendado','confirmado'])`, update `cancelado`, `cancelEvent` (patch `status: 'cancelled'`). **Roda depois do bloco de agendamento** (importa para remarcação). |
| Checagem de convênio | `insuranceNeedsClarification` em `lib/llm/agent.ts:565-569`; mensagem fixa em `:796-799`. |
| "Descartar Claude, mandar fixa" | Flags `bookingFailed`/`unitRequired`/`cancellationFailed` + cadeia `if/else` em `lib/llm/agent.ts:795-812`; constantes `BOOKING_FAILED_MESSAGE` etc. em `:41-46`. |
| Ordem dos marcadores | `NOME_PACIENTE` é aplicado em `patients.full_name` em `:528-537`, **antes** do bloco de agendamento — `NASCIMENTO_PACIENTE` segue o mesmo lugar. `getOrCreatePatient` (`:53`) seleciona só `id, full_name`. |
| Envio de template Meta | `lib/whatsapp/send.ts`: `sendReminderTemplate`, `sendWaitlistTemplate`, `sendWaitlistSpecificTemplate` — cada um com `fetch` próprio para `https://graph.facebook.com/v19.0/${phoneNumberId}/messages` (versão **fixa v19.0**, não `META_GRAPH_VERSION`). `META_GRAPH_VERSION` só existe em `lib/meta/graph.ts` (`GRAPH_VERSION`, `graphUrl(path)`). Decisão: a função genérica nova fica em `lib/whatsapp/send.ts` e usa `graphUrl()` (o spec manda `META_GRAPH_VERSION`); as antigas não mudam. |
| Normalização com nono dígito | `phoneKey()` **privada** em `lib/finance/agent.ts:1055` e **cópia exportada** em `lib/trafego/attribution.ts:85` (mesma regra: `55 + DDD + 8 últimos dígitos`). `lib/phone.ts` já existe com `normalizeBrazilianPhone` (canônico `55` + 10/11 dígitos) e `formatBrazilianPhone`. Task 3 extrai `brazilianPhoneKey` para `lib/phone.ts` e troca as duas cópias. |
| Google Calendar | `lib/google/calendar.ts`: `createEvent(params: CreateEventParams)`, `updateEvent(workspaceId, eventId, updates)`, `cancelEvent(workspaceId, eventId)` (patch cancelled), `deleteEvent(workspaceId, eventId)` (delete real). `extendedProperties.private = { medscale: 'true', workspace_id: workspaceId, patientPhone }`. Summary `${appointmentType} — ${patientName}`. `isGoogleConnected(accountId) → { connected, email }` em `lib/google/auth.ts`. |
| Push do handoff | `sendHandoffPush(workspaceId, { title, body, url })` em `lib/push/send.ts` — já filtra membros com `handoff_push_enabled` e acesso à unidade; nunca lança. Importado dinamicamente (`await import('@/lib/push/send')`). |
| Auth de cron | `requireCronAuth(req)` de `lib/cron-auth.ts` (`const denied = requireCronAuth(req); if (denied) return denied`), rotas `export async function POST`. `supabase/cron.sql`: `cron.schedule('<nome>', '<min> * * * *', $$ select net.http_post(url := 'https://medscalebr.com/api/cron/<rota>', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' \|\| public.cron_secret()), body := '{}'::jsonb); $$)`. Minutos ocupados: :00, :05, :10, :15, :30, :50. |
| Edição de unidade | Formulário em `components/locais/UnitDetailForm.tsx` (página `app/(dashboard)/locais/[id]/page.tsx`, `canManage = owner\|admin`), **não** em `WorkspacesClient` (que só lista/cria/marca padrão). API `PATCH app/api/workspaces/[id]/route.ts`: `resolveActiveSession()` + `session.role !== 'owner' && !== 'admin' → 403`, allow-list de campos. RLS `workspaces: admin manage` já restringe escrita a `is_account_admin`. |
| Agenda | Cor por evento em `components/agenda/CalendarView.tsx:273-301` (`eventPropGetter`; cor por unidade ou bot/manual), filtro `a.status !== 'cancelado'` em `:131`, legenda de unidades em `:240-250`. Mudança manual de status: `<Select>` em `components/agenda/AppointmentModal.tsx:419-434` → `AgendaClient.onUpdate` → `PATCH app/api/appointments/[id]/route.ts`. Cancelar pelo modal → `DELETE` da mesma rota. |
| Testes | Ficam em `tests/<área>/*.test.ts` (alias `@` = raiz, `tests/setup.ts` silencia console e define `CRON_SECRET`). Supabase mockado por `tests/helpers/supabase-mock.ts` (`createSupabaseMock(config)`, `callsTo(table, op)`, `filterValue(call, 'eq', col)`; tabela não configurada → `{ data: null }`). Agente: `tests/helpers/agent-harness.ts` + `vi.mock` com `await import('../helpers/agent-harness')` (ver `tests/agent/scheduling.test.ts`). Webhook: `vi.hoisted` + `after` substituído por fila (ver `tests/webhook/signature.test.ts`). `fetch` com `vi.stubGlobal('fetch', ...)` (ver `tests/agent/whatsapp-send.test.ts`). SQL com PGlite (ver `tests/bot/global-handoff-migration.test.ts`). |

### Varredura de filtros de status de appointment

Toda leitura/escrita de `appointments.status` no repo e a decisão para `pendente_confirmacao_externa` (pendente = ocupa horário, conta como consulta agendada pelo bot, **não** conta como receita prevista, nunca recebe lembrete/no-show):

| Local | Hoje | Decisão | Task |
|---|---|---|---|
| `lib/google/availability.ts:125` (`getAvailableSlots`, base de `isSlotAvailable`, `getFreeSlotsForBot` e do cron `waitlist`) | `.in('status', ['agendado','confirmado'])` | **Incluir** pendente (ocupa o slot) | 2 |
| `lib/llm/agent.ts:376` (consultas futuras no prompt) | `.in(['agendado','confirmado'])` | **Incluir**; label "AGUARDANDO CONFIRMAÇÃO DA CLÍNICA" | 5 |
| `lib/llm/agent.ts:389` (label) | confirmado→confirmada, resto→agendada | Ramo novo para pendente | 5 |
| `lib/llm/agent.ts:614` (insert nativo) | `'agendado'` | Inalterado (nativo) | — |
| `lib/llm/agent.ts:699` (cancelamento) | `.in(['agendado','confirmado'])` | **Incluir** pendente | 9 |
| `app/api/cron/reminders/route.ts:26` | `.in(['agendado','confirmado'])` | Inalterado (pendente já fica fora); teste de regressão | 10 |
| `app/api/cron/noshow/route.ts:21` | `.in(['agendado','confirmado'])` | Inalterado (lista explícita exclui pendente); comentário + teste de regressão | 10 |
| `lib/google/reconcile.ts:25,112,159` | `TERMINAL_STATUSES` protege realizado/no_show/cancelado | Pendente **nunca** recebe patch do Google; evento sumido/cancelado → recriar como pendente | 10 |
| `lib/google/reconcile.ts:142` (import de evento órfão) | `'agendado'` | Inalterado | — |
| `lib/dashboard.ts:25` (consultas do mês, bot/manual) | `not in ("cancelado")` | Inalterado — pendente conta como agendada pelo bot | — |
| `lib/dashboard.ts:40` (no-show) | `eq no_show` | Inalterado | — |
| `lib/dashboard.ts:48` (agenda de hoje) | `not in ("cancelado")` | Inalterado — aparece com label (ver `AgendaHoje`) | 2 |
| `lib/dashboard.ts:61` (aguardando confirmação do paciente, 24h) | `eq agendado` | Inalterado (pendente fica fora) | — |
| `lib/revenue/dashboard-forecast.ts:20` | `not in ("cancelado","no_show")` | **Excluir** pendente (não é receita prevista) | 2 |
| `lib/revenue/forecast.ts:27` (`summarizeAppointmentForecast`) | pula cancelado/no_show | **Pular** pendente | 2 |
| `lib/revenue/cycle.ts` `applyAppointmentRevenue` | cria previsão se `nextStatus !== 'cancelado'` | **Não cria** previsão se `nextStatus === 'pendente_confirmacao_externa'` | 2 |
| `lib/revenue/cycle.ts` `syncRevenueEntryToAppointmentStatus` | só age em realizado/cancelado/no_show | Inalterado (no-op para pendente) | — |
| `lib/trafego/funnel.ts:14` (`BOOKED`) | agendado/confirmado/realizado | **Incluir** pendente (consulta agendada pelo bot) | 2 |
| `lib/whatsapp/confirm-appointment.ts:32-40` (botão do lembrete) | só age em `agendado` | Inalterado (pendente nunca recebe lembrete) | — |
| `app/api/cron/tiss-batches/route.ts:48`, `lib/billing/guides.ts:327` | `realizado` | Inalterado | — |
| `app/(dashboard)/bot/page.tsx:30` (próxima visita na barra) | `neq cancelado` | Inalterado (mostra a pendente como próxima visita) | — |
| `app/(dashboard)/ciclo-receita/page.tsx:68` (consultas por convênio na tela de receita) | `neq cancelado` | **Excluir** pendente | 2 |
| `app/(dashboard)/pacientes/[id]/page.tsx:10` `STATUS_LABEL` | 5 labels | Adicionar `pendente_confirmacao_externa: 'Aguardando clínica'` | 2 |
| `components/dashboard/AgendaHoje.tsx:5` `STATUS_LABEL` | 5 labels | Idem | 2 |
| `components/agenda/CalendarView.tsx:131` | esconde cancelado | Inalterado; cor/legenda própria | 12 |
| `components/agenda/AppointmentModal.tsx:428-432` | 5 opções | Opção "Aguardando clínica" só quando o status inicial é pendente | 12 |
| `app/api/appointments/route.ts:143` (POST manual) | `body.status ?? 'agendado'` | **Rejeitar** (400) `status = pendente_confirmacao_externa` | 2 |
| `app/api/appointments/[id]/route.ts` PATCH | grava `body.status` | **Rejeitar** transição *para* pendente (400); pendente→confirmado via `confirmOutsourcedAppointment`; cancelar em unidade terceirizada → `deleteEvent` | 2, 12 |
| `app/api/appointments/[id]/route.ts` DELETE | `cancelEvent` | Unidade terceirizada → `deleteEvent` | 12 |
| `types/database.ts:10` `AppointmentStatus` | 5 valores | + `'pendente_confirmacao_externa'` | 1 |
| `lib/analytics/posthog.ts:54` (`trackAppointmentStatusChanged`) | tipado por `AppointmentStatus` | Só tipo | 1 |

## Review Focus

- **Remarcação de um pendente na mesma unidade** (Clara emite `CANCELAMENTO_CONFIRMADO: <pendente>` + `AGENDAMENTO_CONFIRMADO` na mesma resposta): o bloco de agendamento roda antes do de cancelamento, então a checagem "já existe pendente nessa unidade" tem que ignorar o id que está sendo cancelado no mesmo turno — senão a troca nunca acontece. Teste na Task 7 (`replacingAppointmentId`).
- **Mesmo horário em duas unidades IAD**: a correlação filtra por `workspace_id` do remetente; resposta do número de Pituba nunca confirma o pendente de Lauro. Teste na Task 8.
- **Mensagem da clínica parceira com o número também cadastrado como paciente / disparando o botão do lembrete**: o desvio no webhook roda como **primeira coisa dentro do `after()`**, antes de `recordAttribution`, rate limit e `confirmReminderAppointment`. Teste na Task 8 (nenhuma dessas é chamada).
- **Edição manual que tenta colocar uma consulta em `pendente_confirmacao_externa`** (ou criar já pendente) pela agenda/API: rejeitada com 400 — o status só nasce pelo fluxo da Clara. Teste na Task 2.
- **Confirmação duplicada/corrida** (IAD manda o template duas vezes, ou a secretária confirma no painel e a IAD confirma depois): `confirmOutsourcedAppointment` faz update condicional `status = pendente → confirmado`; a segunda chamada devolve `not_pending`, não reenvia mensagem ao paciente e a resposta da IAD vira `ambiguo`. Testes nas Tasks 8 e 12.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migration_agendamento_terceirizado.sql` (novo), `supabase/schema.sql`, `supabase/cron.sql` | Colunas, CHECK de status, `clinic_confirmations` + RLS, `patient_phone` nullable, job `outsourced-timeout` |
| `types/database.ts` | Tipos de status, unidades, appointments, handoff_logs, clinic_confirmations |
| `lib/phone.ts` | `brazilianPhoneKey` (extraída) |
| `lib/outsourced/config.ts` (novo) | `isOutsourcedWorkspace`, `parseOutsourcedFields`, `matchClinicSender`, `missingOutsourcedFields` |
| `lib/outsourced/parser.ts` (novo) | `parseClinicConfirmation`, `classifyUnparsedReply`, `normalizePersonName`, `pickPendingMatch` — puros |
| `lib/outsourced/templates.ts` (novo) | Nomes dos templates + builders de parâmetros + texto renderizado |
| `lib/outsourced/messages.ts` (novo) | Mensagens fixas ao paciente |
| `lib/outsourced/notify.ts` (novo) | `notifyOutsourcedIssue` |
| `lib/outsourced/request.ts` (novo) | `requestExternalConfirmation` (fluxo de saída) |
| `lib/outsourced/confirm.ts` (novo) | `confirmOutsourcedAppointment` (IAD e painel) |
| `lib/outsourced/clinic-reply.ts` (novo) | `resolveClinicSender`, `processClinicReplyMessage` |
| `lib/whatsapp/send.ts` | `sendTemplateMessage` genérico |
| `lib/google/calendar.ts` | `createEvent({ pending })`, `markEventConfirmed` |
| `lib/google/availability.ts`, `lib/google/reconcile.ts` | Pendente ocupa slot; reconcile não mexe em pendente |
| `lib/bot/parse-markers.ts`, `lib/bot/security.ts`, `lib/bot/prompt-builder.ts`, `lib/bot/config.ts` | Marcador `NASCIMENTO_PACIENTE`, unidade terceirizada no prompt, pendentes |
| `lib/llm/agent.ts` | Fluxo de saída e cancelamento terceirizado |
| `app/api/whatsapp/webhook/route.ts` | Desvio da clínica parceira |
| `app/api/cron/outsourced-timeout/route.ts` (novo), `app/api/cron/noshow/route.ts` | Cron novo; comentário explícito no noshow |
| `app/api/workspaces/[id]/route.ts`, `components/locais/UnitDetailForm.tsx`, `app/(dashboard)/locais/[id]/page.tsx` | Configuração por unidade |
| `components/agenda/event-style.ts` (novo), `components/agenda/CalendarView.tsx`, `components/agenda/AppointmentModal.tsx`, `app/api/appointments/[id]/route.ts`, `app/api/appointments/route.ts` | Agenda, confirmação/cancelamento manual |
| Filtros da varredura (tabela acima) | Status novo em dashboard/receita/funil/labels |

---

### Task 1: Migração SQL, `schema.sql` e tipos

Complexity: mechanical

**Files:**
- Create: `supabase/migration_agendamento_terceirizado.sql`
- Modify: `supabase/schema.sql` (drop list ~l.39; `workspaces` ~l.127-161; `appointments` ~l.645-690; `handoff_logs` ~l.1025-1034; índices ~l.1085-1110; RLS enable ~l.1827-1840; policies ~l.1984) — **nada no fim do arquivo**
- Modify: `types/database.ts` (`AppointmentStatus` l.10, `HandoffTriggerReason` l.44-49, `workspaces` ~l.109, `appointments` ~l.546, `handoff_logs` ~l.1172, nova tabela `clinic_confirmations`)
- Test: `tests/outsourced/migration.test.ts`

**Interfaces:**
- Produces:
  - `AppointmentStatus = 'agendado' | 'confirmado' | 'realizado' | 'cancelado' | 'no_show' | 'pendente_confirmacao_externa'`
  - `export const PENDING_EXTERNAL_STATUS = 'pendente_confirmacao_externa' as const` em `types/database.ts` (logo abaixo de `AppointmentStatus`) — todas as tasks usam esta constante em vez do literal.
  - `HandoffTriggerReason` + `'clinica_externa_ambiguo' | 'clinica_externa_negacao' | 'clinica_externa_timeout' | 'cancelamento_terceirizado' | 'clinica_externa_falha_envio' | 'clinica_externa_config'`
  - `workspaces.Row`: `is_outsourced: boolean`, `external_clinic_phone: string | null`
  - `appointments.Row`: `external_requested_at: string | null`, `external_escalated_at: string | null`
  - `handoff_logs.Row.patient_phone: string | null`; `Insert` passa a exigir só `workspace_id`
  - `export type ClinicConfirmationDirection = 'outbound' | 'inbound'`, `export type ClinicConfirmationClassification = 'confirmacao' | 'negacao' | 'ambiguo'`, tabela `clinic_confirmations` (`Row`: `id, account_id, workspace_id, appointment_id: string|null, direction, raw_text, classification: ...|null, whatsapp_id: string|null, created_at`; `Insert` exige `account_id, workspace_id, direction, raw_text`)

- [ ] **Step 1: Escrever o teste da migração (falha: arquivo não existe)**

`tests/outsourced/migration.test.ts`, no padrão de `tests/bot/global-handoff-migration.test.ts` (PGlite, fixture mínima criada no próprio teste: `auth.uid()` via `current_setting('test.user_id')`, tabelas `accounts(id)`, `workspaces(id, account_id)`, `patients(id, account_id, full_name)`, `appointments(id, workspace_id, account_id, status text not null default 'agendado' check (status in ('agendado','confirmado','realizado','cancelado','no_show')))`, `handoff_logs(id, workspace_id, patient_phone text not null, trigger_reason text)`, `memberships(account_id, user_id, status, workspace_ids uuid[])`, função `public.my_workspace_ids()` copiada de `schema.sql:1610`, role `tenant`). Casos:

```ts
it('é reaplicável e aceita o status novo', async () => {
  await db.exec(migration); await db.exec(migration)
  await db.exec(`insert into public.appointments (id, workspace_id, account_id, status) values ('${appt}', '${ws1}', '${acc}', 'pendente_confirmacao_externa')`)
  await expect(db.exec(`update public.appointments set status = 'qualquer' where id = '${appt}'`)).rejects.toThrow(/check/)
})
it('aceita handoff_logs sem telefone de paciente', async () => {
  await db.exec(`insert into public.handoff_logs (workspace_id, trigger_reason) values ('${ws1}', 'clinica_externa_ambiguo')`)
})
it('rejeita external_clinic_phone fora do formato só dígitos com DDI', async () => {
  await expect(db.exec(`update public.workspaces set external_clinic_phone = '+55 71 99999-0000' where id = '${ws1}'`)).rejects.toThrow(/check/)
  await db.exec(`update public.workspaces set is_outsourced = true, external_clinic_phone = '5571999990000' where id = '${ws1}'`)
})
it('clinic_confirmations: membro lê só as da unidade dele e não escreve', async () => {
  // insert como superuser em ws1 e ws2; membro com workspace_ids = {ws1}
  // set role tenant; set test.user_id = member
  expect((await db.query('select workspace_id from public.clinic_confirmations')).rows).toEqual([{ workspace_id: ws1 }])
  await expect(db.exec(`insert into public.clinic_confirmations (account_id, workspace_id, direction, raw_text) values ('${acc}', '${ws1}', 'inbound', 'x')`)).rejects.toThrow(/row-level security/)
})
it('whatsapp_id é único', async () => { /* dois inserts com o mesmo whatsapp_id → segundo rejeita /unique/ */ })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --exclude '**/node_modules/**' --exclude '**/.claude/**' tests/outsourced/migration.test.ts`
Expected: FAIL (ENOENT em `supabase/migration_agendamento_terceirizado.sql`)

- [ ] **Step 3: Criar `supabase/migration_agendamento_terceirizado.sql`**

```sql
-- Agendamento terceirizado — unidades que dependem de uma clínica parceira
-- (ex.: IAD) para confirmar o horário. Ver
-- docs/superpowers/specs/2026-10-22-agendamento-terceirizado-design.md.
--
-- Rodar avulso no SQL Editor do Supabase (schema.sql é script de reset).
-- Idempotente: pode ser reexecutado.
--
-- Rode o PASSO 1 sozinho primeiro e depois o restante. appointments.status é
-- CHECK (não ENUM), então não há a restrição de transação do ALTER TYPE — o
-- passo fica isolado só para que uma falha nele não deixe o resto pela metade.

-- ============================================================
-- PASSO 1 — status novo em appointments.status (CHECK)
-- ============================================================
-- A constraint original é inline e sem nome explícito; derruba qualquer CHECK
-- de status antes de recriar com nome fixo (se o nome automático divergir em
-- algum banco, um "drop constraint if exists" silencioso deixaria a antiga
-- barrando o valor novo).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) ilike '%agendado%'
  loop
    execute format('alter table public.appointments drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.appointments add constraint appointments_status_check
  check (status in ('agendado','confirmado','realizado','cancelado','no_show','pendente_confirmacao_externa'));

-- ============================================================
-- PASSO 2 — o restante
-- ============================================================

-- Unidades: opt-in por unidade. Telefone só com dígitos e DDI (5571999990000).
alter table public.workspaces
  add column if not exists is_outsourced boolean not null default false,
  add column if not exists external_clinic_phone text;

alter table public.workspaces drop constraint if exists workspaces_external_clinic_phone_check;
alter table public.workspaces add constraint workspaces_external_clinic_phone_check
  check (external_clinic_phone is null or external_clinic_phone ~ '^55\d{10,11}$');

-- Controle do pendente (solicitação enviada / equipe já avisada do atraso).
alter table public.appointments
  add column if not exists external_requested_at timestamptz,
  add column if not exists external_escalated_at timestamptz;

create index if not exists idx_appointments_pending_external
  on public.appointments (workspace_id, status)
  where status = 'pendente_confirmacao_externa';

-- Nascimento — já existe no schema; mantido por segurança.
alter table public.patients add column if not exists birth_date date;

-- Avisos operacionais da clínica parceira vão para handoff_logs sem paciente
-- (resposta ambígua, configuração inválida).
alter table public.handoff_logs alter column patient_phone drop not null;

-- Auditoria da troca com a clínica parceira. Escrita só por service role
-- (webhook/agent/cron com createAdminClient) — sem policy de insert/update.
create table if not exists public.clinic_confirmations (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  appointment_id  uuid references public.appointments(id) on delete set null,
  direction       text not null check (direction in ('outbound', 'inbound')),
  raw_text        text not null,
  classification  text check (classification in ('confirmacao', 'negacao', 'ambiguo')),
  whatsapp_id     text unique,
  created_at      timestamptz not null default now()
);

alter table public.clinic_confirmations enable row level security;

drop policy if exists "clinic_confirmations: workspace members read" on public.clinic_confirmations;
create policy "clinic_confirmations: workspace members read" on public.clinic_confirmations
  for select using (workspace_id = any(public.my_workspace_ids()));

create index if not exists idx_clinic_conf_workspace on public.clinic_confirmations (workspace_id, created_at desc);
create index if not exists idx_clinic_conf_appointment on public.clinic_confirmations (appointment_id);
```

- [ ] **Step 4: Refletir o estado final em `supabase/schema.sql`**

- `public.clinic_confirmations` na lista do `drop table ... cascade` do topo.
- `workspaces`: colunas `is_outsourced boolean not null default false` e `external_clinic_phone text check (external_clinic_phone is null or external_clinic_phone ~ '^55\d{10,11}$')`, com comentário curto (depois de `gcal_calendar_id`).
- `appointments`: CHECK de status com o valor novo (pode continuar inline); colunas `external_requested_at timestamptz`, `external_escalated_at timestamptz` (depois de `reminder_sent`).
- `handoff_logs`: `patient_phone text,` (sem `not null`) e o comentário de `trigger_reason` listando os 6 motivos novos.
- `create table public.clinic_confirmations` (igual à migração, sem `if not exists`) logo depois de `handoff_logs`; o `enable row level security`, a policy e os dois índices nos blocos de índices/RLS correspondentes; `idx_appointments_pending_external` junto dos outros índices de appointments.

- [ ] **Step 5: Atualizar `types/database.ts`** conforme o bloco **Produces** (incluir `Relationships` de `clinic_confirmations` no padrão das outras tabelas).

- [ ] **Step 6: Rodar testes e tipos**

Run: `npx vitest run --exclude '**/node_modules/**' --exclude '**/.claude/**' tests/outsourced/migration.test.ts tests/billing/database.test.ts` → PASS (o segundo garante que o fim de `schema.sql` não mudou)
Run: `npx tsc --noEmit` → sem erros novos (se `handoff_logs.patient_phone` nullable quebrar algum consumidor, ajustar só a tipagem).

- [ ] **Step 7: Commit**

```bash
git add supabase/migration_agendamento_terceirizado.sql supabase/schema.sql types/database.ts tests/outsourced/migration.test.ts
git commit -m "feat(terceirizado): migração, schema e tipos do agendamento terceirizado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pendente ocupa o horário + varredura de filtros de status

Complexity: integration

> Next.js 16: esta task mexe em route handlers — ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` antes.

**Files:**
- Modify: `lib/google/availability.ts:125`
- Modify: `lib/revenue/dashboard-forecast.ts:20`, `lib/revenue/forecast.ts:27`, `lib/revenue/cycle.ts` (`applyAppointmentRevenue`)
- Modify: `lib/trafego/funnel.ts:14`
- Modify: `app/(dashboard)/ciclo-receita/page.tsx:68`
- Modify: `app/(dashboard)/pacientes/[id]/page.tsx:10-16`, `components/dashboard/AgendaHoje.tsx:5-11`
- Modify: `app/api/appointments/route.ts` (POST), `app/api/appointments/[id]/route.ts` (PATCH — só a rejeição)
- Test: `tests/google/availability.test.ts`, `tests/revenue/forecast.test.ts`, `tests/revenue/cycle.test.ts`, `tests/trafego/funnel.test.ts`, `tests/outsourced/appointments-status-guard.test.ts` (novo)

**Interfaces:**
- Consumes: `PENDING_EXTERNAL_STATUS`, `AppointmentStatus` (Task 1)
- Produces: `export const SLOT_BLOCKING_STATUSES: AppointmentStatus[] = ['agendado', 'confirmado', PENDING_EXTERNAL_STATUS]` em `lib/google/availability.ts`; constante de erro `export const PENDING_STATUS_FORBIDDEN_ERROR = 'O status "Aguardando clínica" é definido apenas pela Clara.'` em `lib/outsourced/config.ts` (criar o arquivo aqui só com esta constante; a Task 3 completa).

- [ ] **Step 1: Testes que falham**
  - `tests/google/availability.test.ts`: `getAvailableSlots` consulta `appointments` com `filterValue(call, 'in', 'status')` igual a `['agendado','confirmado','pendente_confirmacao_externa']`; e um appointment pendente às 10:00 deixa o slot 10:00 `available: false` (seguir o mock existente do arquivo).
  - `tests/revenue/forecast.test.ts`: `summarizeAppointmentForecast([{ status: 'pendente_confirmacao_externa', price: 300, ... }])` → `appointments: 0, total: 0`.
  - `tests/revenue/cycle.test.ts`: `applyAppointmentRevenue(supabase, { booking: { amount: 300, ... }, previousStatus: null, nextStatus: 'pendente_confirmacao_externa' })` → nenhum insert em `revenue_entries`; com `previousStatus: 'pendente_confirmacao_externa', nextStatus: 'confirmado'` → insert da previsão.
  - `tests/trafego/funnel.test.ts`: lead com um appointment `pendente_confirmacao_externa` conta como agendado.
  - `tests/outsourced/appointments-status-guard.test.ts` (mock de `@/lib/session/api` `requireWorkspaceSession` e de `@/lib/supabase/server`, como em `tests/billing/appointments.test.ts`): `POST /api/appointments` com `status: 'pendente_confirmacao_externa'` → 400 com `PENDING_STATUS_FORBIDDEN_ERROR` e nenhum insert; `PATCH /api/appointments/a1` com `status: 'pendente_confirmacao_externa'` sobre uma consulta `agendado` → 400 e nenhum update.
  - `getDashboardForecast`: se houver teste em `tests/revenue/*`, assert de que o filtro `not status in` inclui o pendente; senão, coberto pelo teste de `summarizeAppointmentForecast`.

- [ ] **Step 2: Rodar e ver falhar** (`npx vitest run --exclude '**/node_modules/**' --exclude '**/.claude/**' tests/google/availability.test.ts tests/revenue tests/trafego/funnel.test.ts tests/outsourced/appointments-status-guard.test.ts`)

- [ ] **Step 3: Implementar**
  - `availability.ts`: `.in('status', SLOT_BLOCKING_STATUSES)` + comentário ("pendente de clínica parceira ocupa o slot enquanto espera a resposta").
  - `dashboard-forecast.ts`: `.not('status', 'in', '("cancelado","no_show","pendente_confirmacao_externa")')`; `forecast.ts`: pular também `PENDING_EXTERNAL_STATUS`.
  - `cycle.ts` `applyAppointmentRevenue`: condição de criação vira `nextStatus !== 'cancelado' && nextStatus !== PENDING_EXTERNAL_STATUS && amount > 0`.
  - `funnel.ts`: `BOOKED` inclui `'pendente_confirmacao_externa'`.
  - `ciclo-receita/page.tsx`: trocar `.neq('status','cancelado')` por `.not('status', 'in', '("cancelado","pendente_confirmacao_externa")')`.
  - Labels: `pendente_confirmacao_externa: 'Aguardando clínica'` nos dois `STATUS_LABEL`.
  - POST `app/api/appointments/route.ts`: antes de qualquer efeito (inclusive Google), `if (body.status === PENDING_EXTERNAL_STATUS) return 400`.
  - PATCH `app/api/appointments/[id]/route.ts`: depois de carregar `current`, `if (body.status === PENDING_EXTERNAL_STATUS && current.status !== PENDING_EXTERNAL_STATUS) return 400` (sem tocar no Google).

- [ ] **Step 4: Rodar os testes do Step 2 + `tests/agent tests/dashboard`** → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/google/availability.ts lib/revenue/dashboard-forecast.ts lib/revenue/forecast.ts lib/revenue/cycle.ts lib/trafego/funnel.ts "app/(dashboard)/ciclo-receita/page.tsx" "app/(dashboard)/pacientes/[id]/page.tsx" components/dashboard/AgendaHoje.tsx app/api/appointments/route.ts "app/api/appointments/[id]/route.ts" lib/outsourced/config.ts tests/google/availability.test.ts tests/revenue/forecast.test.ts tests/revenue/cycle.test.ts tests/trafego/funnel.test.ts tests/outsourced/appointments-status-guard.test.ts
git commit -m "feat(terceirizado): pendente ocupa o horário e fica fora da receita prevista

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `lib/phone.ts` (chave do nono dígito), parser e config

Complexity: mechanical

**Files:**
- Modify: `lib/phone.ts`, `lib/finance/agent.ts` (remover `phoneKey` privada l.1055-1064, importar), `lib/trafego/attribution.ts` (remover `phoneKey` l.85-94, importar e reexportar se algum import externo usar)
- Create: `lib/outsourced/parser.ts`; complete: `lib/outsourced/config.ts`
- Test: `tests/phone.test.ts`, `tests/outsourced/parser.test.ts`, `tests/outsourced/config.test.ts`

**Interfaces:**
- Produces:
  - `brazilianPhoneKey(phone: string): string` (`lib/phone.ts`)
  - `parseClinicConfirmation(text: string): ClinicConfirmation | null`, `interface ClinicConfirmation { scheduledAt: Date; patientName: string | null; doctorName: string | null }`
  - `classifyUnparsedReply(text: string): 'negacao' | 'ambiguo'`
  - `normalizePersonName(name: string): string`
  - `pickPendingMatch(candidates: { id: string; patient_name: string }[], parsedName: string | null): string | null`
  - `isOutsourcedWorkspace(ws: OutsourcedFlags): boolean`, `interface OutsourcedFlags { is_outsourced: boolean; external_clinic_phone: string | null }`
  - `parseOutsourcedFields(body: Record<string, unknown>, current: OutsourcedFlags): { ok: true; value: Partial<OutsourcedFlags> } | { ok: false; error: string }`
  - `OUTSOURCED_PHONE_REQUIRED_ERROR`, `OUTSOURCED_PHONE_INVALID_ERROR`
  - `matchClinicSender(workspaces: Array<OutsourcedFlags & { id: string }>, senderPhone: string): ClinicSenderMatch`, `type ClinicSenderMatch = { kind: 'none' } | { kind: 'match'; workspaceId: string } | { kind: 'conflict'; workspaceIds: string[] }`
  - `type OutsourcedMissingField = 'nome' | 'nascimento' | 'convenio'`; `missingOutsourcedFields(input: { fullName: string | null; birthDate: string | null; insuranceChosen: boolean }): OutsourcedMissingField[]` (ordem fixa nome, nascimento, convenio; `nome` falta se vazio ou `'Paciente'`)

- [ ] **Step 1: Testes que falham**

`tests/phone.test.ts` (acrescentar):
```ts
describe('brazilianPhoneKey', () => {
  it('ignora o nono dígito e a formatação', () => {
    for (const p of ['5571999990000', '557199990000', '(71) 99999-0000', '+55 71 9999-0000', '71999990000'])
      expect(brazilianPhoneKey(p)).toBe('557199990000')
  })
  it('separa DDDs diferentes', () => expect(brazilianPhoneKey('5511999990000')).not.toBe(brazilianPhoneKey('5571999990000')))
})
```

`tests/outsourced/parser.test.ts` — os dois formatos reais do spec (copiar literalmente, incluindo `📍Nosso endereço: ...`) e variações:
```ts
const COM_NOME = 'CONSULTA AGENDADA - IAD PITUBA\n\nMarilene Ribeiro\n\nMédico: Dr Gutemberg Brito\nHorário: 09:00\nData: 09/10/2026\n📍Nosso endereço: ...'
const SEM_NOME = 'CONSULTA AGENDADA- IAD PITUBA\n\nMédico: Dr Gutemberg Brito\nHorário: 08:00\nData: 16/10/2026\n📍Nosso endereço: ...'
it('formato com nome', () => expect(parseClinicConfirmation(COM_NOME)).toEqual({
  scheduledAt: new Date('2026-10-09T12:00:00.000Z'), patientName: 'Marilene Ribeiro', doctorName: 'Dr Gutemberg Brito' }))
it('formato sem nome, hífen colado', () => expect(parseClinicConfirmation(SEM_NOME)).toEqual({
  scheduledAt: new Date('2026-10-16T11:00:00.000Z'), patientName: null, doctorName: 'Dr Gutemberg Brito' }))
it('caixa e emojis ao redor', () => expect(parseClinicConfirmation('✅ consulta agendada ✅\nhorário: 08:00\ndata: 16/10/2026')?.scheduledAt.toISOString()).toBe('2026-10-16T11:00:00.000Z'))
it('CRLF', () => expect(parseClinicConfirmation(SEM_NOME.replace(/\n/g, '\r\n'))).not.toBeNull())
it.each([
  'não tenho esse horário', 'Bom dia! Qual o convênio?', '',
  'CONSULTA AGENDADA - IAD PITUBA\nHorário: 08:00',                      // sem data
  'CONSULTA AGENDADA - IAD PITUBA\nData: 16/10/2026',                    // sem hora
  'CONSULTA AGENDADA\nHorário: 08:00\nData: 31/02/2026',                 // data inexistente
  'CONSULTA AGENDADA\nHorário: 25:00\nData: 16/10/2026',                 // hora inválida
  'Ainda não deixei a consulta agendada\nHorário: 08:00\nData: 16/10/2026', // cabeçalho não está no início da linha
])('%s → null', (t) => expect(parseClinicConfirmation(t)).toBeNull())
it('classifica negação', () => {
  expect(classifyUnparsedReply('Não tenho esse horário')).toBe('negacao')
  expect(classifyUnparsedReply('sem vaga dia 16')).toBe('negacao')
  expect(classifyUnparsedReply('Médico indisponível')).toBe('negacao')
  expect(classifyUnparsedReply('Pode ser às 9h?')).toBe('ambiguo')
  expect(classifyUnparsedReply('Nãoé possível')).toBe('ambiguo') // sem fronteira de palavra
})
it('pickPendingMatch', () => {
  const a = { id: 'a', patient_name: 'Marilene Ribeiro' }, b = { id: 'b', patient_name: 'José Souza' }
  expect(pickPendingMatch([a], null)).toBe('a')
  expect(pickPendingMatch([], 'X')).toBeNull()
  expect(pickPendingMatch([a, b], null)).toBeNull()
  expect(pickPendingMatch([a, b], 'MARILENE  RIBEIRO')).toBe('a')
  expect(pickPendingMatch([a, b], 'jose souza')).toBe('b')
  expect(pickPendingMatch([a, { id: 'c', patient_name: 'marilene ribeiro' }], 'Marilene Ribeiro')).toBeNull()
})
```

`tests/outsourced/config.test.ts`:
```ts
it('isOutsourcedWorkspace exige os dois campos', () => {
  expect(isOutsourcedWorkspace({ is_outsourced: true, external_clinic_phone: '5571999990000' })).toBe(true)
  expect(isOutsourcedWorkspace({ is_outsourced: true, external_clinic_phone: null })).toBe(false)
  expect(isOutsourcedWorkspace({ is_outsourced: true, external_clinic_phone: '  ' })).toBe(false)
  expect(isOutsourcedWorkspace({ is_outsourced: false, external_clinic_phone: '5571999990000' })).toBe(false)
})
const OFF = { is_outsourced: false, external_clinic_phone: null }
it('parseOutsourcedFields', () => {
  expect(parseOutsourcedFields({ name: 'x' }, OFF)).toEqual({ ok: true, value: {} })
  expect(parseOutsourcedFields({ is_outsourced: true }, OFF)).toEqual({ ok: false, error: OUTSOURCED_PHONE_REQUIRED_ERROR })
  expect(parseOutsourcedFields({ is_outsourced: true, external_clinic_phone: '' }, OFF)).toEqual({ ok: false, error: OUTSOURCED_PHONE_REQUIRED_ERROR })
  expect(parseOutsourcedFields({ is_outsourced: true, external_clinic_phone: '7199' }, OFF)).toEqual({ ok: false, error: OUTSOURCED_PHONE_INVALID_ERROR })
  expect(parseOutsourcedFields({ is_outsourced: true, external_clinic_phone: '(71) 99999-0000' }, OFF))
    .toEqual({ ok: true, value: { is_outsourced: true, external_clinic_phone: '5571999990000' } })
  expect(parseOutsourcedFields({ is_outsourced: false, external_clinic_phone: '' }, { is_outsourced: true, external_clinic_phone: '5571999990000' }))
    .toEqual({ ok: true, value: { is_outsourced: false, external_clinic_phone: null } })
  expect(parseOutsourcedFields({ external_clinic_phone: '' }, { is_outsourced: true, external_clinic_phone: '5571999990000' }))
    .toEqual({ ok: false, error: OUTSOURCED_PHONE_REQUIRED_ERROR })
})
it('matchClinicSender', () => {
  const ws = [
    { id: 'lauro', is_outsourced: true, external_clinic_phone: '5571999990000' },
    { id: 'pituba', is_outsourced: true, external_clinic_phone: '5571988880000' },
    { id: 'nativa', is_outsourced: false, external_clinic_phone: '5571977770000' },
  ]
  expect(matchClinicSender(ws, '557188880000')).toEqual({ kind: 'match', workspaceId: 'pituba' })
  expect(matchClinicSender(ws, '5571977770000')).toEqual({ kind: 'none' })
  expect(matchClinicSender([...ws, { id: 'dup', is_outsourced: true, external_clinic_phone: '5571999990000' }], '5571999990000'))
    .toEqual({ kind: 'conflict', workspaceIds: ['lauro', 'dup'] })
})
it('missingOutsourcedFields', () => {
  expect(missingOutsourcedFields({ fullName: 'Paciente', birthDate: null, insuranceChosen: false })).toEqual(['nome', 'nascimento', 'convenio'])
  expect(missingOutsourcedFields({ fullName: 'Maria Souza', birthDate: '1980-05-03', insuranceChosen: true })).toEqual([])
})
```

- [ ] **Step 2: Rodar e ver falhar** (`npx vitest run --exclude '**/node_modules/**' --exclude '**/.claude/**' tests/phone.test.ts tests/outsourced/parser.test.ts tests/outsourced/config.test.ts`)

- [ ] **Step 3: Implementar**

`lib/phone.ts` — acrescentar (mover o comentário explicativo de `lib/finance/agent.ts:1030-1053` para cá):
```ts
/** Chave de comparação tolerante ao nono dígito e à formatação: 55 + DDD + 8 últimos dígitos. */
export function brazilianPhoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const withCountry = digits.length <= 11 ? `55${digits}` : digits
  if (withCountry.startsWith('55') && withCountry.length >= 12) {
    return `55${withCountry.slice(2, 4)}${withCountry.slice(-8)}`
  }
  return withCountry
}
```
Trocar `phoneKey(...)` por `brazilianPhoneKey(...)` em `lib/finance/agent.ts` e `lib/trafego/attribution.ts` (sem mudança de comportamento; `tests/finance tests/trafego` devem continuar verdes).

`lib/outsourced/parser.ts`:
```ts
import { TZDate } from '@date-fns/tz'

// Interpretação determinística da resposta da clínica parceira (template
// "CONSULTA AGENDADA" da IAD). Pura — nenhuma chamada ao Claude.
const TZ = 'America/Sao_Paulo'

export interface ClinicConfirmation {
  /** Instante exato da consulta (montado em America/Sao_Paulo). */
  scheduledAt: Date
  /** Nome do paciente se veio numa linha solta entre o cabeçalho e os campos. */
  patientName: string | null
  /** Só informativo — cada account tem um único médico, nunca entra na correlação. */
  doctorName: string | null
}

// Tolera emojis, espaços e pontuação antes do rótulo.
const LEAD = String.raw`^[^\p{L}\p{N}]*`
const HEADER_RE = new RegExp(String.raw`${LEAD}consulta\s+agendada(?!\p{L})`, 'iu')
const DATE_RE = new RegExp(String.raw`${LEAD}data\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)`, 'iu')
const TIME_RE = new RegExp(String.raw`${LEAD}hor[aá]rio\s*:\s*(\d{1,2})\s*[:hH]\s*(\d{2})(?!\d)`, 'iu')
const DOCTOR_RE = new RegExp(String.raw`${LEAD}m[eé]dic[oa]\s*:\s*(.+)$`, 'iu')
const LABEL_RE = /^[^\p{L}\p{N}]*[\p{L} ]{2,30}:/u
const NAME_RE = /^\p{L}[\p{L}'’. -]*[\p{L}.]$/u
const NEGATION_RE = /(?<!\p{L})(n[aã]o|sem\s+vaga|indispon[ií]ve(l|is))(?!\p{L})/iu

function buildInstant(d: number, m: number, y: number, hh: number, mm: number): Date | null {
  if (hh > 23 || mm > 59) return null
  const zoned = new TZDate(y, m - 1, d, hh, mm, 0, TZ)
  if (zoned.getFullYear() !== y || zoned.getMonth() !== m - 1 || zoned.getDate() !== d) return null
  return new Date(zoned.getTime())
}

export function parseClinicConfirmation(text: string): ClinicConfirmation | null {
  const lines = (text ?? '').split(/\r?\n/).map((l) => l.trim())
  const headerIdx = lines.findIndex((l) => HEADER_RE.test(l))
  if (headerIdx === -1) return null

  let date: RegExpMatchArray | null = null
  let time: RegExpMatchArray | null = null
  let doctorName: string | null = null
  const fieldIdx: number[] = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    const d = !date ? line.match(DATE_RE) : null
    if (d) { date = d; fieldIdx.push(i); continue }
    const t = !time ? line.match(TIME_RE) : null
    if (t) { time = t; fieldIdx.push(i); continue }
    const doc = doctorName === null ? line.match(DOCTOR_RE) : null
    if (doc) { doctorName = doc[1].trim() || null; fieldIdx.push(i) }
  }
  if (!date || !time) return null

  const scheduledAt = buildInstant(Number(date[1]), Number(date[2]), Number(date[3]), Number(time[1]), Number(time[2]))
  if (!scheduledAt) return null

  const stop = Math.min(...fieldIdx)
  const patientName =
    lines.slice(headerIdx + 1, stop).find((l) => l && !LABEL_RE.test(l) && NAME_RE.test(l)) ?? null

  return { scheduledAt, patientName, doctorName }
}

export function classifyUnparsedReply(text: string): 'negacao' | 'ambiguo' {
  return NEGATION_RE.test(text ?? '') ? 'negacao' : 'ambiguo'
}

export function normalizePersonName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Exatamente 1 candidato confirma; com 2+, o nome do template desempata.
// Qualquer outro caso → null (equipe resolve).
export function pickPendingMatch(
  candidates: { id: string; patient_name: string }[],
  parsedName: string | null
): string | null {
  if (candidates.length === 1) return candidates[0].id
  if (candidates.length === 0 || !parsedName) return null
  const target = normalizePersonName(parsedName)
  const named = candidates.filter((c) => normalizePersonName(c.patient_name) === target)
  return named.length === 1 ? named[0].id : null
}
```

`lib/outsourced/config.ts` — os exports listados em **Produces** (mantendo `PENDING_STATUS_FORBIDDEN_ERROR` da Task 2). Sem imports de servidor (é usado também no client component da Task 11). Strings exatas:
```ts
export const OUTSOURCED_PHONE_REQUIRED_ERROR = 'Informe o WhatsApp da clínica parceira com DDD para ativar o agendamento terceirizado.'
export const OUTSOURCED_PHONE_INVALID_ERROR = 'WhatsApp da clínica parceira inválido. Use DDD + número, ex.: (71) 99999-0000.'
```
`parseOutsourcedFields`: só olha as chaves se presentes no body; `is_outsourced` presente → `=== true`; telefone presente → `null`/vazio vira `null`, senão `normalizeBrazilianPhone` (null → INVALID); resultado final com toggle ligado e sem telefone → REQUIRED. `matchClinicSender` compara `brazilianPhoneKey` do remetente com o de cada unidade em que `isOutsourcedWorkspace`, preservando a ordem de entrada.

- [ ] **Step 4: Rodar** os testes do Step 2 + `tests/finance tests/trafego` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/phone.ts lib/finance/agent.ts lib/trafego/attribution.ts lib/outsourced/parser.ts lib/outsourced/config.ts tests/phone.test.ts tests/outsourced/parser.test.ts tests/outsourced/config.test.ts
git commit -m "feat(terceirizado): parser da confirmação da clínica parceira e config por unidade

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Templates Meta, envio genérico e mensagens fixas

Complexity: mechanical

**Files:**
- Create: `lib/outsourced/templates.ts`, `lib/outsourced/messages.ts`
- Modify: `lib/whatsapp/send.ts` (nova função no fim)
- Test: `tests/outsourced/templates.test.ts`, `tests/outsourced/messages.test.ts`, `tests/agent/whatsapp-send.test.ts`

**Interfaces:**
- Produces:
  - `sendTemplateMessage(params: { to: string; phoneNumberId: string; token: string; templateName: string; parameters: string[] }): Promise<{ messages?: { id: string }[] }>` — `POST graphUrl(`/${phoneNumberId}/messages`)` com `{ messaging_product: 'whatsapp', to, type: 'template', template: { name, language: { code: TEMPLATE_LANGUAGE }, components: [{ type: 'body', parameters: parameters.map((text) => ({ type: 'text', text })) }] } }`; `!response.ok` → `throw new Error(`WhatsApp API error: ${status}`)` **sem** ecoar o corpo (pode conter parâmetros com dado de paciente).
  - `templates.ts`: `TEMPLATE_SOLICITACAO_AGENDAMENTO = 'solicitacao_agendamento'`, `TEMPLATE_CONSULTA_CONFIRMADA = 'consulta_confirmada'`, `TEMPLATE_LANGUAGE = 'pt_BR'`, `sanitizeTemplateParam(v: string): string`, `formatPhoneForTemplate(phone: string): string`, `formatBirthDate(isoDate: string): string`, `buildSolicitacaoParams(i: SolicitacaoInput): string[]`, `renderSolicitacaoText(params: string[]): string`, `buildConsultaConfirmadaParams(i: { patientName: string; scheduledAt: Date; unitName: string }): string[]`, `interface SolicitacaoInput { scheduledAt: Date; patientName: string; insuranceLabel: string; birthDate: string /* AAAA-MM-DD */; patientPhone: string }`
  - `messages.ts`: `formatDayLabel(d: Date): string` (ex.: `quinta-feira, 16/10`), `formatTimeLabel(d: Date): string` (`HH:mm`), `requestedMessage(i: { scheduledAt: Date; unitName: string }): string`, `alreadyPendingMessage(unitName: string): string`, `REQUEST_FAILED_MESSAGE: string`, `confirmedMessage(i: { scheduledAt: Date; unitName: string; address: string | null }): string`, `missingDataMessage(missing: OutsourcedMissingField[], unitName: string): string`

- [ ] **Step 1: Testes que falham**

`tests/outsourced/templates.test.ts`:
```ts
const at = new Date('2026-10-16T11:00:00.000Z') // 08:00 em SP
it('parâmetros da solicitação na ordem do template', () => {
  expect(buildSolicitacaoParams({ scheduledAt: at, patientName: 'Maria Aparecida Souza', insuranceLabel: 'Unimed', birthDate: '1980-05-03', patientPhone: '5571999990000' }))
    .toEqual(['16/10', '08:00', 'Maria Aparecida Souza', 'Unimed', '03/05/1980', '71 99999-0000'])
})
it('sanitiza quebra de linha, tab e 4+ espaços; vazio vira "-"', () => {
  expect(sanitizeTemplateParam('Maria\nSouza\t  Lima    Neta')).toBe('Maria Souza Lima Neta')
  expect(sanitizeTemplateParam('   ')).toBe('-')
})
it('telefone sem o nono dígito', () => expect(formatPhoneForTemplate('557199990000')).toBe('71 9999-0000'))
it('texto renderizado igual ao template cadastrado', () => {
  expect(renderSolicitacaoText(['16/10', '08:00', 'Maria', 'Particular', '03/05/1980', '71 99999-0000'])).toBe(
    'Olá, tudo bem?\n\nAgenda por favor o dia 16/10 às 08:00:\n\nNome: Maria\nConvênio: Particular\nData de Nascimento: 03/05/1980\nContato: 71 99999-0000\n\nAguardamos a confirmação. Obrigado!')
})
it('consulta_confirmada usa o primeiro nome', () =>
  expect(buildConsultaConfirmadaParams({ patientName: 'Marilene Ribeiro', scheduledAt: at, unitName: 'IAD Pituba' })).toEqual(['Marilene', '16/10', '08:00', 'IAD Pituba']))
```

`tests/outsourced/messages.test.ts` (strings exatas do spec):
```ts
expect(requestedMessage({ scheduledAt: at, unitName: 'IAD Pituba' }))
  .toBe('Pronto, solicitei o horário de quinta-feira, 16/10 às 08:00 na IAD Pituba. Assim que a clínica confirmar eu te aviso aqui mesmo. 😊')
expect(confirmedMessage({ scheduledAt: at, unitName: 'IAD Pituba', address: 'Rua A, 10, Salvador' }))
  .toBe('Sua consulta está confirmada! ✅ quinta-feira, 16/10 às 08:00 na IAD Pituba, Rua A, 10, Salvador.')
expect(confirmedMessage({ scheduledAt: at, unitName: 'IAD Pituba', address: null }))
  .toBe('Sua consulta está confirmada! ✅ quinta-feira, 16/10 às 08:00 na IAD Pituba.')
expect(alreadyPendingMessage('IAD Pituba'))
  .toBe('Você já tem uma solicitação de horário em andamento na IAD Pituba. Assim que a clínica confirmar eu te aviso aqui mesmo.')
expect(REQUEST_FAILED_MESSAGE).toBe('Não consegui solicitar esse horário agora. A equipe vai te retornar por aqui em breve.')
expect(missingDataMessage(['nascimento'], 'IAD Pituba')).toBe('Para solicitar o horário na IAD Pituba, preciso de sua data de nascimento. Pode me passar?')
expect(missingDataMessage(['nome', 'nascimento', 'convenio'], 'IAD Pituba'))
  .toBe('Para solicitar o horário na IAD Pituba, preciso de seu nome completo, sua data de nascimento e seu convênio (ou se será particular). Pode me passar?')
```

`tests/agent/whatsapp-send.test.ts` (acrescentar): `sendTemplateMessage({ to: '5571999990000', phoneNumberId: '123', token: 't', templateName: 'solicitacao_agendamento', parameters: ['16/10'] })` → URL `https://graph.facebook.com/v22.0/123/messages` (default de `GRAPH_VERSION` com `META_GRAPH_VERSION` ausente), body com `language: { code: 'pt_BR' }` e `components[0].parameters[0]` = `{ type: 'text', text: '16/10' }`; com `ok: false` lança `WhatsApp API error: 400` e a mensagem não contém o parâmetro.

- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar** (`format(new TZDate(d, TZ), 'dd/MM' | 'HH:mm')` de `date-fns`; `formatDayLabel` = `new TZDate(d, TZ).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: TZ })`; `sanitizeTemplateParam` = trocar `[\r\n\t]+` por espaço, colapsar 2+ espaços, trim, vazio → `'-'`; `formatPhoneForTemplate` = dígitos locais (tira `55` com 12-13 dígitos), 11 → `DD XXXXX-XXXX`, 10 → `DD XXXX-XXXX`, outro → dígitos crus. Labels de `missingDataMessage`: `nome` → `seu nome completo`, `nascimento` → `sua data de nascimento`, `convenio` → `seu convênio (ou se será particular)`; junção `a`, `a e b`, `a, b e c`.)
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit**

```bash
git add lib/outsourced/templates.ts lib/outsourced/messages.ts lib/whatsapp/send.ts tests/outsourced/templates.test.ts tests/outsourced/messages.test.ts tests/agent/whatsapp-send.test.ts
git commit -m "feat(terceirizado): templates Meta da clínica parceira e mensagens fixas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Prompt — `NASCIMENTO_PACIENTE`, unidade terceirizada e pendentes

Complexity: integration

**Files:**
- Modify: `lib/bot/parse-markers.ts`, `lib/bot/security.ts` (regex l.24 + nova função), `lib/bot/prompt-builder.ts` (`ANTI_INJECTION_BLOCK` l.26, `UnitInfo`, `unitsSection`, bloco novo de regras), `lib/bot/config.ts` (`UnitContext`, `getAccountUnits`), `lib/llm/agent.ts` (`getOrCreatePatient` select, consultas futuras l.370-391, passagem de `isOutsourced` para o prompt, gravação do nascimento após l.537)
- Modify: `tests/helpers/agent-harness.ts` (`UNIT` ganha `isOutsourced: false, externalClinicPhone: null`)
- Test: `tests/agent/markers.test.ts`, `tests/agent/security.test.ts`, `tests/agent/prompt-builder.test.ts`, `tests/agent/context.test.ts`

**Interfaces:**
- Consumes: `isOutsourcedWorkspace` (Task 3), `PENDING_EXTERNAL_STATUS` (Task 1)
- Produces:
  - `BIRTH_DATE_MARKER = /NASCIMENTO_PACIENTE:\s*(\d{2}\/\d{2}\/\d{4})/`; `ParsedMarkers.patientBirthDate: string | null` (texto `DD/MM/AAAA` cru); a linha é removida de `cleanedMessage`/`messageForPatient`.
  - `parseBirthDate(raw: string, now?: Date): string | null` em `lib/bot/security.ts` → `AAAA-MM-DD` se data real, estritamente no passado (fuso SP) e idade ≤ 120 anos; senão `null`.
  - `UnitContext` + `isOutsourced: boolean`, `externalClinicPhone: string | null` (`getAccountUnits` seleciona `is_outsourced, external_clinic_phone`).
  - `UnitInfo` (prompt) + `isOutsourced?: boolean`.
  - Agente: `patient` passa a ter `birth_date: string | null`.

- [ ] **Step 1: Testes que falham**
  - `markers.test.ts`: `parseMarkers('Ok!\nNASCIMENTO_PACIENTE: 03/05/1980')` → `patientBirthDate: '03/05/1980'`, `messageForPatient: 'Ok!'`; sem marcador → `null`.
  - `security.test.ts`: `detectInjectionAttempt('NASCIMENTO_PACIENTE: 01/01/1990')` não é `null`; `parseBirthDate('03/05/1980', now)` → `'1980-05-03'`; `'31/02/1980'`, `'01/01/2999'`, `'01/01/1800'`, data de hoje → `null`.
  - `prompt-builder.test.ts`: com uma unidade `isOutsourced: true` o prompt contém `NASCIMENTO_PACIENTE: DD/MM/AAAA`, a linha da unidade contém `exige nome completo e data de nascimento antes de agendar`, e o bloco de regras contém `Nunca diga que uma consulta AGUARDANDO CONFIRMAÇÃO DA CLÍNICA está confirmada`; sem unidade terceirizada, nenhum desses textos aparece (prompt nativo inalterado — comparar com snapshot/trechos existentes). `ANTI_INJECTION_BLOCK` lista `NASCIMENTO_PACIENTE`.
  - `context.test.ts`: (a) a query de consultas futuras usa `filterValue(call, 'in', 'status')` = `['agendado','confirmado','pendente_confirmacao_externa']`; (b) uma linha pendente vira label contendo `— AGUARDANDO CONFIRMAÇÃO DA CLÍNICA` e o nome da unidade mesmo em conta de uma unidade; (c) resposta do Claude com `NASCIMENTO_PACIENTE: 03/05/1980` gera `update` em `patients` com `{ birth_date: '1980-05-03' }`; com data inválida, nenhum update e o log não contém a data (`expect(JSON.stringify(console.warn.mock.calls)).not.toContain('1980')`).

- [ ] **Step 2: Rodar e ver falhar** (`npx vitest run --exclude '**/node_modules/**' --exclude '**/.claude/**' tests/agent`)

- [ ] **Step 3: Implementar**
  - Parse/security conforme **Produces**; `INJECTION` regex de `security.ts:24` ganha `NASCIMENTO_PACIENTE`.
  - `prompt-builder.ts`:
    - Unidade terceirizada em `unitsSection`: acrescentar `\n  ⚠️ Agendamento confirmado pela clínica parceira: exige nome completo e data de nascimento antes de agendar, além do convênio (ou particular).`
    - Se `units.some((u) => u.isOutsourced)`, acrescentar depois do bloco "Capturar o nome do paciente" a seção:
```
## Unidades com confirmação da clínica parceira — IMPORTANTE
Nas unidades marcadas com ⚠️, antes de emitir AGENDAMENTO_CONFIRMADO você precisa ter: nome completo, data de nascimento e convênio (ou particular). Pergunte o que faltar.
Assim que o paciente informar a data de nascimento, inclua na MESMA resposta uma linha isolada no formato exato:
NASCIMENTO_PACIENTE: DD/MM/AAAA
Nunca invente a data nem mostre esta linha ao paciente.
Nessas unidades o horário só fica garantido depois que a clínica parceira confirmar: ao emitir AGENDAMENTO_CONFIRMADO, não diga que a consulta está confirmada — o sistema avisa o paciente.
- Nunca diga que uma consulta AGUARDANDO CONFIRMAÇÃO DA CLÍNICA está confirmada.
- Se o paciente perguntar por ela, diga que a solicitação foi feita e que ele será avisado por aqui assim que a clínica confirmar.
- Não ofereça outro horário na mesma unidade enquanto houver uma solicitação aguardando, a não ser que o paciente peça para trocar. Para trocar, use CANCELAMENTO_CONFIRMADO com o id da solicitação antiga e AGENDAMENTO_CONFIRMADO com o horário novo, na mesma resposta.
```
    - `ANTI_INJECTION_BLOCK`: incluir `NASCIMENTO_PACIENTE` na lista de marcadores.
  - `config.ts`: `getAccountUnits` seleciona os dois campos; `isOutsourced: isOutsourcedWorkspace(w)`, `externalClinicPhone: w.external_clinic_phone`.
  - `agent.ts`:
    - `getOrCreatePatient`: `select('id, full_name, birth_date')` (nos 3 selects); insert continua igual.
    - Consultas futuras: `.in('status', ['agendado', 'confirmado', PENDING_EXTERNAL_STATUS])`; label pendente = `${dateLabel} às ${timeLabel} — ${unitName ?? 'unidade'} — AGUARDANDO CONFIRMAÇÃO DA CLÍNICA` (o `(id: …)` já é acrescentado pelo prompt-builder).
    - `units.map(...)` do `buildDynamicSystemPrompt` passa `isOutsourced: u.isOutsourced`.
    - Logo após a gravação do nome (l.537): `const birthDate = markers.patientBirthDate ? parseBirthDate(markers.patientBirthDate, contextNow) : null`; inválida → `console.warn('[security] NASCIMENTO_PACIENTE rejeitado conversation=<id>')` (sem o valor); válida e diferente → `update patients { birth_date }` e `patient.birth_date = birthDate`.

- [ ] **Step 4: Rodar `tests/agent`** → PASS (todos os testes antigos inalterados).
- [ ] **Step 5: Commit**

```bash
git add lib/bot/parse-markers.ts lib/bot/security.ts lib/bot/prompt-builder.ts lib/bot/config.ts lib/llm/agent.ts tests/helpers/agent-harness.ts tests/agent/markers.test.ts tests/agent/security.test.ts tests/agent/prompt-builder.test.ts tests/agent/context.test.ts
git commit -m "feat(terceirizado): Clara coleta nascimento e mostra solicitações pendentes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Google Calendar pendente e `notifyOutsourcedIssue`

Complexity: integration

**Files:**
- Modify: `lib/google/calendar.ts`
- Create: `lib/outsourced/notify.ts`
- Test: `tests/google/calendar.test.ts`, `tests/outsourced/notify.test.ts`

**Interfaces:**
- Produces:
  - `CreateEventParams.pending?: boolean` — quando `true`: `summary` = `` `[PENDENTE] ${appointmentType} — ${patientName}` `` e `status: 'tentative'`; `extendedProperties.private` idêntico ao atual. Constante exportada `PENDING_EVENT_PREFIX = '[PENDENTE] '`.
  - `markEventConfirmed(workspaceId: string, eventId: string): Promise<void>` — `cal.events.get` → `cal.events.patch({ sendUpdates: 'none', requestBody: { summary: summary sem o prefixo, status: 'confirmed' } })`.
  - `type OutsourcedIssueReason = 'clinica_externa_ambiguo' | 'clinica_externa_negacao' | 'clinica_externa_timeout' | 'cancelamento_terceirizado' | 'clinica_externa_falha_envio' | 'clinica_externa_config'` (subconjunto de `HandoffTriggerReason`).
  - `notifyOutsourcedIssue(input: { accountId: string; workspaceId: string; appointmentId?: string | null; reason: OutsourcedIssueReason; rawText?: string | null }): Promise<void>` — nunca lança.

- [ ] **Step 1: Testes que falham**
  - `calendar.test.ts` (seguir o mock de `googleapis` existente): `createEvent({ ..., pending: true })` insere com `summary: '[PENDENTE] consulta — Maria'`, `status: 'tentative'`, `extendedProperties.private.medscale: 'true'`; sem `pending` o body não tem `status` (inalterado). `markEventConfirmed` faz `get` e `patch` com `{ summary: 'consulta — Maria', status: 'confirmed' }` e `sendUpdates: 'none'`.
  - `notify.test.ts` (mock `@/lib/supabase/server` com `createSupabaseMock`, `vi.mock('@/lib/push/send', () => ({ sendHandoffPush }))`):
    - insere em `handoff_logs` `{ workspace_id, conversation_id: null, patient_phone: <phone do appointment ou null>, trigger_reason: reason, handoff_to: null, flagged_content: rawText ?? null }` e **não** toca `conversations`;
    - `sendHandoffPush(workspaceId, { title: '⚠️ Clínica parceira', body, url: '/agenda' })` com `body` por motivo:
      - ambiguo/negacao: `IAD Pituba: resposta da clínica parceira precisa de revisão`
      - timeout: `IAD Pituba: clínica parceira ainda não confirmou uma solicitação`
      - cancelamento_terceirizado: `IAD Pituba: paciente cancelou — avise a clínica parceira`
      - falha_envio: `IAD Pituba: não foi possível enviar a solicitação à clínica parceira`
      - config: `IAD Pituba: o mesmo WhatsApp de clínica parceira está em mais de uma unidade`
    - payload do push nunca contém `rawText` nem telefone (`expect(JSON.stringify(push.mock.calls)).not.toMatch(/5571|Marilene/)`);
    - erro no insert não lança e o push ainda sai.

- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar.** `notify.ts` usa `createAdminClient`; busca `workspaces.name` (fallback `'Unidade'`) e, se `appointmentId`, `appointments.patient_phone`; `rawText` vai **só** em `handoff_logs.flagged_content` (coberto por RLS, mesma regra do hardening). Push via `const { sendHandoffPush } = await import('@/lib/push/send')`. Log só `[outsourced] notify reason=<r> workspace=<id> appointment=<id|->`.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit**

```bash
git add lib/google/calendar.ts lib/outsourced/notify.ts tests/google/calendar.test.ts tests/outsourced/notify.test.ts
git commit -m "feat(terceirizado): evento pendente no Google e aviso operacional para a equipe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Fluxo de saída — `requestExternalConfirmation` + `agent.ts`

Complexity: judgment

**Files:**
- Create: `lib/outsourced/request.ts`
- Modify: `lib/llm/agent.ts` (bloco de agendamento l.574-688 e cadeia de `finalMessage` l.795-812)
- Modify: `tests/helpers/agent-harness.ts` (mock de calendar ganha `deleteEvent`)
- Test: `tests/outsourced/request.test.ts`, `tests/agent/outsourced-booking.test.ts`

**Interfaces:**
- Consumes: `missingOutsourcedFields` (T3), `buildSolicitacaoParams`, `renderSolicitacaoText`, `TEMPLATE_SOLICITACAO_AGENDAMENTO` (T4), `sendTemplateMessage` (T4), `requestedMessage`, `alreadyPendingMessage`, `REQUEST_FAILED_MESSAGE`, `missingDataMessage` (T4), `createEvent({ pending: true })`, `deleteEvent` (T6), `notifyOutsourcedIssue` (T6), `UnitContext.isOutsourced/externalClinicPhone`, `patient.birth_date` (T5)
- Produces:
```ts
export interface ExternalRequestInput {
  supabase: SupabaseClient<Database>
  accountId: string
  accountName: string
  unit: { id: string; name: string; externalClinicPhone: string }
  patient: { id: string; fullName: string; birthDate: string } // birthDate AAAA-MM-DD
  patientPhone: string
  conversationId: string
  scheduledAt: Date
  durationMin: number
  insurer: { id: string; name: string } | null // null = particular
  procedure: { id: string; name: string; price: number } | null
  /** Consulta que a Clara cancela na mesma resposta (remarcação) — ignorada na checagem de duplicidade. */
  replacingAppointmentId: string | null
  phoneNumberId: string | null
  metaToken: string | null // já descriptografado
}
export type ExternalRequestResult =
  | { kind: 'requested'; appointmentId: string }
  | { kind: 'already_pending' }
  | { kind: 'send_failed'; appointmentId: string }
  | { kind: 'insert_failed' }
export async function requestExternalConfirmation(input: ExternalRequestInput): Promise<ExternalRequestResult>
```

- [ ] **Step 1: Testes de `request.ts` que falham** (`tests/outsourced/request.test.ts`; mocks: supabase por `createSupabaseMock` passado no input, `@/lib/whatsapp/send` `sendTemplateMessage`, `@/lib/google/calendar` `createEvent`/`deleteEvent`, `@/lib/google/auth` `isGoogleConnected`, `@/lib/outsourced/notify`, `@/lib/analytics/posthog-server`):
  - pendente existente na unidade (select em `appointments` com `eq workspace_id`, `eq patient_id`, `eq status pendente` retorna linha) → `already_pending`, nenhum insert, nenhum template;
  - mesma situação com `replacingAppointmentId` = id do pendente → a query leva `neq('id', replacingAppointmentId)` e segue criando;
  - caminho feliz: insert com `status: 'pendente_confirmacao_externa'`, `source: 'bot'`, `external_requested_at` ISO, `patient_name: fullName`, campos de convênio quando `insurer` (`billing_type: 'convenio'`, `insurer_id`, `health_plan`), `price`/`procedure_*` quando particular; **nenhum** insert em `revenue_entries`; `conversations` update `{ appointment_id, workspace_id }`; `waitlist` update `scheduled`; Google conectado → `createEvent` com `pending: true` e update `gcal_event_id`; `sendTemplateMessage` com `to: unit.externalClinicPhone`, `templateName: 'solicitacao_agendamento'`, parâmetros `['16/10','08:00','Maria Souza','Unimed','03/05/1980','71 98888-7777']` (particular → `'Particular'`); insert em `clinic_confirmations` `{ account_id, workspace_id, appointment_id, direction: 'outbound', raw_text: renderSolicitacaoText(params), whatsapp_id: 'wamid.out' }` → `{ kind: 'requested', appointmentId }`;
  - falha do Google não impede o template;
  - `sendTemplateMessage` rejeita (ou `phoneNumberId`/`metaToken` nulos) → update `{ status: 'cancelado' }` do appointment, `deleteEvent` se houve evento, `notifyOutsourcedIssue({ reason: 'clinica_externa_falha_envio', appointmentId })` → `send_failed`;
  - insert do appointment sem retorno → `insert_failed`;
  - nenhum `console.*` contém nome/telefone/nascimento (`expect(JSON.stringify([console.error.mock.calls, console.warn.mock.calls, console.log.mock.calls])).not.toMatch(/Maria|1980|98888/)`).

- [ ] **Step 2: Testes do agente que falham** (`tests/agent/outsourced-booking.test.ts`; mesmos `vi.mock` de `tests/agent/scheduling.test.ts` + `vi.mock('@/lib/outsourced/request', () => ({ requestExternalConfirmation }))`; `state.units = [{ ...UNIT, isOutsourced: true, externalClinicPhone: '5571999990000', name: 'IAD Pituba' }]`):
  - unidade nativa (harness padrão) com `AGENDAMENTO_CONFIRMADO` → insert `status: 'agendado'` como antes e `requestExternalConfirmation` não chamado;
  - terceirizada, paciente `full_name: 'Paciente'` sem `birth_date`, Claude manda `AGENDAMENTO_CONFIRMADO` + `CONVENIO_ID: PARTICULAR` → nenhum insert, nada chamado, mensagem enviada = `missingDataMessage(['nome','nascimento'], 'IAD Pituba')`;
  - terceirizada sem `CONVENIO_ID` numa clínica **sem** convênios e que aceita particular → `missingDataMessage(['convenio'], ...)` (no nativo isso agendaria como particular);
  - terceirizada completa (patients select devolve `{ id: 'p1', full_name: 'Maria Souza', birth_date: '1980-05-03' }`, `CONVENIO_ID: PARTICULAR`) → `requestExternalConfirmation` chamado com `unit.externalClinicPhone`, `insurer: null`, `patient.birthDate: '1980-05-03'`; resultado `requested` → mensagem enviada ao paciente é exatamente `requestedMessage(...)` e o texto do Claude ("Consulta confirmada!") **não** é enviado nem salvo;
  - `already_pending` → `alreadyPendingMessage('IAD Pituba')`; `send_failed`/`insert_failed` → `REQUEST_FAILED_MESSAGE`;
  - `isSlotAvailable` false → `BOOKING_FAILED_MESSAGE` e `requestExternalConfirmation` não chamado;
  - `CANCELAMENTO_CONFIRMADO: <id>` + `AGENDAMENTO_CONFIRMADO` na mesma resposta → `replacingAppointmentId` = `<id>`;
  - nenhuma chamada de `sendWhatsAppMessage` tem `to: '5571999990000'`.

- [ ] **Step 3: Rodar e ver falhar** (`npx vitest run --exclude '**/node_modules/**' --exclude '**/.claude/**' tests/outsourced/request.test.ts tests/agent/outsourced-booking.test.ts`)

- [ ] **Step 4: Implementar `request.ts`** na ordem: duplicidade → insert → conversa/waitlist/`trackAppointmentBookedByBot` → Google pendente (best-effort, `console.error('[outsourced] gcal pendente falhou appointment=<id>')`) → template → `clinic_confirmations` → resultado. Falha de envio: cancelar, apagar evento, notificar. `whatsapp_id` = `res.messages?.[0]?.id ?? null`. Insert de `clinic_confirmations` falhando só loga (o pedido já saiu).

- [ ] **Step 5: Integrar em `agent.ts`** (reusar o padrão "descartar o Claude, mandar fixa"):
  - `let outsourcedMessage: string | null = null`.
  - Dentro de `else { resolvedUnitId = bookingUnitId ... }`, antes do `isSlotAvailable`: `const bookingUnit = allUnitById.get(bookingUnitId)`; se `bookingUnit?.isOutsourced && bookingUnit.externalClinicPhone`: calcular `missing = missingOutsourcedFields({ fullName: patient?.full_name ?? null, birthDate: patient?.birth_date ?? null, insuranceChosen: insuranceChoice !== null })`; se `missing.length` → `outsourcedMessage = missingDataMessage(missing, bookingUnit.name)` e **não** agenda; senão revalida `isSlotAvailable` (falso → `bookingFailed = true`) e chama `requestExternalConfirmation({ ..., phoneNumberId: botConfig.phoneNumberId, metaToken: botConfig.metaToken ? decryptToken(botConfig.metaToken) : null, replacingAppointmentId: markers.cancelledAppointmentId })`, mapeando o resultado para `requestedMessage`/`alreadyPendingMessage`/`REQUEST_FAILED_MESSAGE`. O ramo nativo fica **textualmente igual** (mover para `else`).
  - Cadeia de `finalMessage`: inserir `else if (outsourcedMessage) { finalMessage = outsourcedMessage }` logo depois do ramo `bookingFailed`.

- [ ] **Step 6: Rodar `tests/agent tests/outsourced`** → PASS.
- [ ] **Step 7: Commit**

```bash
git add lib/outsourced/request.ts lib/llm/agent.ts tests/helpers/agent-harness.ts tests/outsourced/request.test.ts tests/agent/outsourced-booking.test.ts
git commit -m "feat(terceirizado): Clara solicita o horário à clínica parceira e não promete ao paciente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Fluxo de entrada — webhook, `clinic-reply.ts`, `confirm.ts`

Complexity: judgment

> Next.js 16: esta task mexe no webhook (`after()`) — ler `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` e `.../03-file-conventions/route.md` antes.

**Files:**
- Create: `lib/outsourced/confirm.ts`, `lib/outsourced/clinic-reply.ts`
- Modify: `app/api/whatsapp/webhook/route.ts` (início do `after(async () => { ... })`, l.124)
- Test: `tests/outsourced/confirm.test.ts`, `tests/outsourced/clinic-reply.test.ts`, `tests/webhook/clinic-routing.test.ts`

**Interfaces:**
- Consumes: `parseClinicConfirmation`, `classifyUnparsedReply`, `pickPendingMatch` (T3), `matchClinicSender` (T3), `confirmedMessage` (T4), `buildConsultaConfirmadaParams`, `TEMPLATE_CONSULTA_CONFIRMADA`, `sendTemplateMessage` (T4), `markEventConfirmed` (T6), `notifyOutsourcedIssue` (T6), `applyAppointmentRevenue` (`lib/revenue/cycle.ts`)
- Produces:
```ts
// lib/outsourced/confirm.ts
export type ConfirmOutsourcedResult = { ok: true; appointmentId: string } | { ok: false; reason: 'not_pending' }
export async function confirmOutsourcedAppointment(appointmentId: string): Promise<ConfirmOutsourcedResult>

// lib/outsourced/clinic-reply.ts
export interface ClinicInboundMessage { id: string; type: string; text?: { body?: string } }
export async function resolveClinicSender(supabase: SupabaseClient<Database>, accountId: string, senderPhone: string): Promise<ClinicSenderMatch>
export async function processClinicReplyMessage(input: { accountId: string; workspaceId: string; message: ClinicInboundMessage }): Promise<void>
```

- [ ] **Step 1: Testes de `confirm.ts` que falham** (`createAdminClient` mockado; `sendWhatsAppMessage`, `sendTemplateMessage`, `markEventConfirmed`, `applyAppointmentRevenue` mockados; `vi.useFakeTimers().setSystemTime(...)`):
  - update condicional: `update({ status: 'confirmado' })` com `eq id` **e** `eq status 'pendente_confirmacao_externa'`, `.select().maybeSingle()`; sem linha → `{ ok: false, reason: 'not_pending' }` e nenhum efeito (nem mensagem, nem Google);
  - com linha (`patient_phone: '5571988887777'`, `gcal_event_id: 'ev1'`, `price: 300`): `applyAppointmentRevenue` com `previousStatus: 'pendente_confirmacao_externa'`, `nextStatus: 'confirmado'`; `markEventConfirmed(workspace_id, 'ev1')`; última mensagem `role: 'user'` da conversa (`conversations` por `account_id` + `patient_phone`) há < 24h → `sendWhatsAppMessage({ to: '5571988887777', message: confirmedMessage(...) })`; há > 24h ou sem mensagem → `sendTemplateMessage({ templateName: 'consulta_confirmada', parameters: buildConsultaConfirmadaParams(...) })`; em ambos, insert em `messages` `{ conversation_id, role: 'assistant', content: confirmedMessage(...) }`;
  - endereço = `[address, city, state].filter(Boolean).join(', ')` da unidade, `null` se vazio;
  - falha do Google ou do envio não desfaz o `confirmado` e não lança.

- [ ] **Step 2: Testes de `clinic-reply.ts` que falham** (mock de `confirmOutsourcedAppointment` e `notifyOutsourcedIssue`):
  - dedupe: insert em `clinic_confirmations` devolve `error.code '23505'` → retorna sem consultar appointments nem notificar;
  - grava `{ account_id, workspace_id, direction: 'inbound', raw_text, whatsapp_id: message.id }` (não-texto: `raw_text: '[audio recebido]'`) e **nenhuma** chamada a `patients`, `conversations`, `messages`, `sendWhatsAppMessage`, `sendTemplateMessage` (`supabase.callsTo('patients')` etc. vazios);
  - áudio → classification `ambiguo`, `notifyOutsourcedIssue({ reason: 'clinica_externa_ambiguo' })` sem `rawText`;
  - "não tenho esse horário" → `negacao`, `notify(... 'clinica_externa_negacao', rawText)`; "pode ser às 9h?" → `ambiguo`; status de appointment nenhum alterado;
  - template `COM_NOME` e 1 pendente da unidade às `2026-10-09T12:00:00.000Z` → query `appointments` com `eq workspace_id`, `eq status pendente`, `eq scheduled_at '2026-10-09T12:00:00.000Z'`; `confirmOutsourcedAppointment(id)`; update de `clinic_confirmations` com `{ appointment_id, classification: 'confirmacao' }`;
  - 2 pendentes no mesmo horário, template sem nome → `ambiguo`, nada confirmado; com nome que casa um deles → confirma esse;
  - 0 pendentes (ex.: já cancelado pelo paciente) → `ambiguo`;
  - `confirmOutsourcedAppointment` devolve `not_pending` (corrida) → `ambiguo` + notify;
  - logs não contêm `raw_text` nem nome.
  - `resolveClinicSender`: query `workspaces` com `eq account_id`, `eq is_outsourced true`, `not external_clinic_phone is null`, depois `matchClinicSender`.

- [ ] **Step 3: Testes do webhook que falham** (`tests/webhook/clinic-routing.test.ts`, copiar a estrutura de `tests/webhook/signature.test.ts` e mockar também `@/lib/outsourced/clinic-reply`, `@/lib/outsourced/notify`, `@/lib/whatsapp/referral`, `@/lib/rate-limit/webhook`, `@/lib/whatsapp/confirm-appointment`):
  - `resolveClinicSender` → `match` → `processClinicReplyMessage({ accountId: 'acc1', workspaceId, message })` e **nenhum** de `recordAttribution`, `checkRateLimit`, `confirmReminderAppointment`, `processIncomingMessage`, `handleUnsupportedMessage` é chamado (vale também para `type: 'audio'`);
  - `conflict` → `notifyOutsourcedIssue({ reason: 'clinica_externa_config', workspaceId })` para cada unidade do conflito, e nada mais roda;
  - `none` → fluxo atual intacto (`processIncomingMessage` chamado);
  - `resolveClinicSender` lança → loga e **segue** o fluxo de paciente (falha na checagem não pode derrubar o atendimento).

- [ ] **Step 4: Rodar e ver falhar**
- [ ] **Step 5: Implementar** `confirm.ts`, `clinic-reply.ts` e, no webhook, como **primeira coisa** dentro do `after(async () => {`:
```ts
    // Clínica parceira (agendamento terceirizado) — antes de qualquer fluxo de
    // paciente: a mensagem dela nunca vira paciente/conversa e nunca é respondida.
    let clinicSender: ClinicSenderMatch = { kind: 'none' }
    try {
      clinicSender = await resolveClinicSender(supabase, accountId, from)
    } catch (err) {
      console.error('[outsourced] resolveClinicSender failed', err)
    }
    if (clinicSender.kind === 'conflict') {
      console.error(`[outsourced] telefone de clínica parceira em ${clinicSender.workspaceIds.length} unidades da account ${accountId}`)
      await Promise.all(clinicSender.workspaceIds.map((workspaceId) =>
        notifyOutsourcedIssue({ accountId, workspaceId, reason: 'clinica_externa_config' })))
      return
    }
    if (clinicSender.kind === 'match') {
      await processClinicReplyMessage({ accountId, workspaceId: clinicSender.workspaceId, message })
        .catch((err) => console.error('[outsourced] processClinicReplyMessage failed', err))
      return
    }
```
  `processClinicReplyMessage` loga só `[outsourced] reply workspace=<id> classification=<c> candidates=<n>`.
- [ ] **Step 6: Rodar `tests/outsourced tests/webhook`** → PASS.
- [ ] **Step 7: Commit**

```bash
git add lib/outsourced/confirm.ts lib/outsourced/clinic-reply.ts app/api/whatsapp/webhook/route.ts tests/outsourced/confirm.test.ts tests/outsourced/clinic-reply.test.ts tests/webhook/clinic-routing.test.ts
git commit -m "feat(terceirizado): interpreta a resposta da clínica parceira e confirma ao paciente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Cancelamento em unidade terceirizada (Clara)

Complexity: integration

**Files:**
- Modify: `lib/llm/agent.ts` (bloco de cancelamento l.691-716; import `deleteEvent`)
- Test: `tests/agent/outsourced-booking.test.ts` (novo `describe`)

**Interfaces:**
- Consumes: `deleteEvent` (`lib/google/calendar.ts`), `notifyOutsourcedIssue` (T6), `PENDING_EXTERNAL_STATUS`

- [ ] **Step 1: Testes que falham**
  - a busca do cancelamento usa `in status ['agendado','confirmado','pendente_confirmacao_externa']`;
  - pendente em unidade terceirizada com `gcal_event_id: 'ev1'` → update `{ status: 'cancelado' }`, `deleteEvent('w1', 'ev1')` (e **não** `cancelEvent`), `notifyOutsourcedIssue({ accountId, workspaceId: 'w1', appointmentId, reason: 'cancelamento_terceirizado' })`; a resposta do Claude segue normal ao paciente;
  - confirmada em unidade terceirizada → mesmos efeitos;
  - unidade nativa → `cancelEvent` como hoje e nenhum notify;
  - nenhuma mensagem sai para `externalClinicPhone`.
- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar**: `select('id, gcal_event_id, workspace_id')` com o status novo no `.in`; `const outsourced = allUnitById.get(apptToCancel.workspace_id)?.isOutsourced === true`; Google: `outsourced ? deleteEvent : cancelEvent` (best-effort, mesmo `try/catch`); se `outsourced`, `await notifyOutsourcedIssue(...)`.
- [ ] **Step 4: Rodar `tests/agent`** → PASS.
- [ ] **Step 5: Commit**

```bash
git add lib/llm/agent.ts tests/agent/outsourced-booking.test.ts
git commit -m "feat(terceirizado): cancelamento em unidade terceirizada apaga o evento e avisa a equipe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Crons — reminders/noshow/reconcile e `outsourced-timeout`

Complexity: integration

> Next.js 16: rota nova em `app/api/cron/*` — ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` antes.

**Files:**
- Create: `app/api/cron/outsourced-timeout/route.ts`
- Modify: `app/api/cron/noshow/route.ts` (comentário), `lib/google/reconcile.ts`, `supabase/cron.sql`
- Test: `tests/outsourced/timeout-route.test.ts`, `tests/outsourced/cron-filters.test.ts`, `tests/google/reconcile.test.ts`

**Interfaces:**
- Consumes: `notifyOutsourcedIssue` (T6), `createEvent({ pending: true })`, `deleteEvent` (T6), `isGoogleConnected`, `requireCronAuth`
- Produces: `POST /api/cron/outsourced-timeout` → `{ escalated: number; expired: number; errors: string[] }`; constante `ESCALATION_HOURS = 4`.

- [ ] **Step 1: Testes que falham**
  - `cron-filters.test.ts`: `POST` de `app/api/cron/reminders` e `app/api/cron/noshow` com `Authorization: Bearer cron-secret-test` → `filterValue(call, 'in', 'status')` é exatamente `['agendado','confirmado']` (regressão: pendente nunca recebe lembrete nem vira no-show).
  - `timeout-route.test.ts`:
    - sem/errado `Authorization` → 401;
    - **expira** pendentes com `scheduled_at < now`: select com `eq status pendente` e `lt scheduled_at now`; para cada: update `{ status: 'cancelado' }` com `eq status pendente` (condicional), `deleteEvent` se `gcal_event_id`, `notifyOutsourcedIssue({ reason: 'clinica_externa_timeout', appointmentId })`;
    - **escala** pendentes com `lt external_requested_at (now - 4h)`, `is external_escalated_at null`, `gte scheduled_at now`: `notifyOutsourcedIssue({ reason: 'clinica_externa_timeout' })` e update `{ external_escalated_at: <now ISO> }` — status **não** muda (nenhum update com `status`);
    - expira antes de escalar (um pendente vencido não recebe as duas notificações);
    - resposta `{ escalated, expired, errors }`; falha num item vai para `errors` com o id e não interrompe os outros.
  - `reconcile.test.ts` (seguir o arquivo existente):
    - linha pendente cujo evento veio `cancelled` do Google → status continua pendente; `createEvent` com `pending: true` e update de `gcal_event_id` com o id novo;
    - linha pendente cujo `gcal_event_id` sumiu da busca → idem (recria, não cancela);
    - linha pendente com horário diferente no Google → **nenhum** patch (MedScale é dono);
    - linhas `agendado` continuam com o comportamento atual.
- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar**
  - `noshow/route.ts`: comentário acima do `.in(...)`: "Lista explícita: `pendente_confirmacao_externa` (aguardando clínica parceira) fica de fora de propósito — vira `cancelado` pelo cron outsourced-timeout, nunca no_show."
  - `reconcile.ts`: no loop de `medscaleEvents` com `match.status === PENDING_EXTERNAL_STATUS` → se `cancelledOnGoogle`, recriar; senão `continue` (sem patch). No loop de "sumiu da busca": pendente → recriar em vez de cancelar. Helper local `recreatePendingEvent(row)`: precisa de `accountId` e `isGoogleConnected(accountId).email` (buscar uma vez por chamada); `createEvent({ workspaceId, patientName: row.patient_name, patientPhone: row.patient_phone, appointmentType: row.type, startTime: new Date(row.scheduled_at), durationMin: row.duration_min, workspaceName: <nome da unidade>, doctorEmail: email, pending: true })`; falha só loga com o id.
  - Rota nova: `requireCronAuth`, `createAdminClient`, expira e depois escala, conforme os testes.
  - `supabase/cron.sql`, depois do bloco `tiss-batches` (seção 2):
```sql
-- OUTSOURCED-TIMEOUT: agendamento terceirizado — avisa a equipe quando a
-- clínica parceira não confirma uma solicitação em 4h (uma vez por pendente,
-- external_escalated_at) e cancela pendentes cujo horário já passou. Não muda
-- o status por atraso: se a clínica confirmar depois, confirma normalmente.
-- Ver app/api/cron/outsourced-timeout.
select cron.schedule(
  'outsourced-timeout',
  '20 * * * *',
  $$
    select net.http_post(
      url     := 'https://medscalebr.com/api/cron/outsourced-timeout',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || public.cron_secret()
      ),
      body    := '{}'::jsonb
    );
  $$
);
```
- [ ] **Step 4: Rodar `tests/outsourced tests/google`** → PASS.
- [ ] **Step 5: Commit**

```bash
git add app/api/cron/outsourced-timeout/route.ts app/api/cron/noshow/route.ts lib/google/reconcile.ts supabase/cron.sql tests/outsourced/timeout-route.test.ts tests/outsourced/cron-filters.test.ts tests/google/reconcile.test.ts
git commit -m "feat(terceirizado): cron de atraso da clínica parceira e reconcile protegendo pendentes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Configuração por unidade em `/locais/[id]`

Complexity: integration

> Next.js 16: route handler com `params` Promise — ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` antes.

**Files:**
- Modify: `app/api/workspaces/[id]/route.ts`, `components/locais/UnitDetailForm.tsx`, `app/(dashboard)/locais/[id]/page.tsx` (select l.17)
- Test: `tests/outsourced/workspace-route.test.ts`

**Interfaces:**
- Consumes: `parseOutsourcedFields`, `OUTSOURCED_PHONE_*_ERROR` (T3), `formatBrazilianPhone` (`lib/phone.ts`)
- Produces: `UnitDetail` + `is_outsourced: boolean`, `external_clinic_phone: string | null`.

- [ ] **Step 1: Testes que falham** (`vi.mock('@/lib/session/server', () => ({ resolveActiveSession }))`, `@/lib/supabase/server` com `createSupabaseMock`, `@/lib/billing/validation` real):
  - role `member` → 403 (inalterado);
  - `{ is_outsourced: true }` com a unidade atual sem telefone (select de `workspaces` devolve `{ is_outsourced: false, external_clinic_phone: null }`) → 400 `OUTSOURCED_PHONE_REQUIRED_ERROR`, nenhum update;
  - `{ is_outsourced: true, external_clinic_phone: '(71) 99999-0000' }` → update com `{ is_outsourced: true, external_clinic_phone: '5571999990000' }`;
  - `{ external_clinic_phone: 'abc' }` → 400 `OUTSOURCED_PHONE_INVALID_ERROR`;
  - body sem esses campos → update não contém `is_outsourced` nem `external_clinic_phone` e não há select extra (outras edições da unidade intocadas).
- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar**
  - API: se `'is_outsourced' in body || 'external_clinic_phone' in body`, carregar `is_outsourced, external_clinic_phone` da unidade (`eq id`, `eq account_id`) e `parseOutsourcedFields(body, current)`; erro → 400; ok → `Object.assign(update, value)`.
  - Página: select inclui `is_outsourced, external_clinic_phone`.
  - Form: nova seção (card) "Agendamento terceirizado" dentro do `fieldset disabled={!canManage}`: `Switch` de `components/ui/switch.tsx` (mesmo uso de `components/configuracoes/AcceptsPrivateToggle.tsx`) rotulado **"Agendamento terceirizado"**; `Input` **"WhatsApp da clínica parceira"** com máscara `formatBrazilianPhone`; ajuda exata: `A Clara envia a solicitação para esse número e só confirma ao paciente depois que a clínica parceira responder.`; validação no cliente com `parseOutsourcedFields` antes do `fetch` (mostra o erro e não envia); `save()` manda `is_outsourced` e `external_clinic_phone`.
- [ ] **Step 4: Rodar teste + `npx eslint` nos arquivos** → PASS.
- [ ] **Step 5: Commit**

```bash
git add "app/api/workspaces/[id]/route.ts" components/locais/UnitDetailForm.tsx "app/(dashboard)/locais/[id]/page.tsx" tests/outsourced/workspace-route.test.ts
git commit -m "feat(terceirizado): toggle e WhatsApp da clínica parceira na unidade

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Agenda — cor/legenda, confirmação e cancelamento manual; verificação final

Complexity: integration

> Next.js 16: route handler — ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` antes.

**Files:**
- Create: `components/agenda/event-style.ts`
- Modify: `components/agenda/CalendarView.tsx` (`eventPropGetter` l.273-301, legenda l.230-252), `components/agenda/AppointmentModal.tsx` (l.428-432), `app/api/appointments/[id]/route.ts` (PATCH e DELETE)
- Test: `tests/outsourced/event-style.test.ts`, `tests/outsourced/appointment-manual.test.ts`

**Interfaces:**
- Consumes: `confirmOutsourcedAppointment` (T8), `deleteEvent`, `isOutsourcedWorkspace`, `PENDING_EXTERNAL_STATUS`
- Produces: `appointmentEventStyle(a: { status: AppointmentStatus; source: AppointmentSource; workspace_id: string | null }, opts: { multiUnit: boolean; unitColor?: string }): React.CSSProperties`; `PENDING_LEGEND_LABEL = 'Aguardando clínica'`.

- [ ] **Step 1: Testes que falham**
  - `event-style.test.ts`: pendente → `{ backgroundColor: '#fff7ed', color: '#9a3412', border: '1px dashed #f97316', borderRadius: 6 }` independentemente de unidade/origem; não pendente → exatamente o estilo atual (cor da unidade em multi-unidade, senão `var(--cyan)` bot / `var(--navy)` manual, `color: '#fff'`, `border: 'none'`, `boxShadow` do bot).
  - `appointment-manual.test.ts` (mocks de sessão, supabase, `@/lib/google/calendar`, `@/lib/outsourced/confirm`, `@/lib/revenue/cycle`, `@/lib/billing/*`):
    - PATCH pendente → `{ status: 'confirmado' }`: o `update` gravado **não** contém `status`; `confirmOutsourcedAppointment(id)` chamado uma vez; `applyAppointmentRevenue` da rota **não** é chamado (o confirm já cuida); resposta = linha relida;
    - `confirmOutsourcedAppointment` → `not_pending` → 409 `{ error: 'Esta consulta já não está aguardando a clínica parceira.' }`;
    - PATCH → `cancelado` de consulta (pendente ou confirmada) em unidade terceirizada (select de `workspaces` → `{ is_outsourced: true, external_clinic_phone: '5571999990000' }`) → `deleteEvent` (não `cancelEvent`); unidade nativa → `cancelEvent` como hoje;
    - DELETE em unidade terceirizada → `deleteEvent`; nativa → `cancelEvent`;
    - nenhum caminho manual chama `notifyOutsourcedIssue` (quem cancela é a própria equipe).
- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar**
  - `CalendarView`: `eventPropGetter` usa `appointmentEventStyle`; título do pendente com prefixo `⏳ `; legenda: se algum appointment visível é pendente, mostrar swatch com o estilo pendente + `Aguardando clínica` (fora do `if (multiUnit)`, para aparecer também com uma unidade).
  - `AppointmentModal`: `<SelectItem value="pendente_confirmacao_externa">Aguardando clínica</SelectItem>` só quando `initialValues?.status === 'pendente_confirmacao_externa'` (a API já rejeita a transição para pendente — Task 2).
  - PATCH: depois do guard da Task 2, `const confirmingPending = current.status === PENDING_EXTERNAL_STATUS && body.status === 'confirmado'`; se verdadeiro, `delete update.status`. Para decidir delete × cancel no Google, carregar `is_outsourced, external_clinic_phone` da unidade só quando `cancelling` (`isOutsourcedWorkspace`). Após o update normal: se `confirmingPending`, `await confirmOutsourcedAppointment(id)` (409 se `not_pending`), reler a linha e retornar sem o bloco de receita da rota.
  - DELETE: mesma escolha `deleteEvent`/`cancelEvent` pela unidade.
- [ ] **Step 4: Rodar os testes da task** → PASS.
- [ ] **Step 5: Verificação final**
  - `npx vitest run --exclude '**/node_modules/**' --exclude '**/.claude/**'` → tudo verde (comparar a contagem de falhas com `main`; nenhuma nova).
  - `npx tsc --noEmit` → sem erros.
  - `npx eslint lib/outsourced app/api/cron/outsourced-timeout app/api/whatsapp/webhook/route.ts "app/api/appointments" "app/api/workspaces/[id]/route.ts" components/agenda components/locais lib/llm/agent.ts lib/bot lib/google lib/phone.ts lib/whatsapp/send.ts` → sem erros.
  - `git grep -n "external_clinic_phone\|externalClinicPhone" -- lib app` → o único envio para esse número é `sendTemplateMessage` em `lib/outsourced/request.ts`.
  - `git grep -n "console\.\(log\|warn\|error\)" -- lib/outsourced` → nenhum interpola `raw_text`, nome, nascimento, convênio ou telefone.
- [ ] **Step 6: Commit**

```bash
git add components/agenda/event-style.ts components/agenda/CalendarView.tsx components/agenda/AppointmentModal.tsx "app/api/appointments/[id]/route.ts" tests/outsourced/event-style.test.ts tests/outsourced/appointment-manual.test.ts
git commit -m "feat(terceirizado): agenda mostra 'Aguardando clínica' e confirmação manual reusa o fluxo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Pendências fora do código (para o usuário, depois do merge)

- Rodar `supabase/migration_agendamento_terceirizado.sql` (passo 1 sozinho, depois o resto) e a entrada `outsourced-timeout` de `supabase/cron.sql` no SQL Editor — dev e prod.
- Cadastrar e aprovar os templates `solicitacao_agendamento` e `consulta_confirmada` (Utility, pt_BR) na WABA da account.
- Ligar o toggle e preencher o WhatsApp da IAD em "IAD Lauro" e "IAD Pituba".
