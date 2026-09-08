# Lista de espera pela Maria — oferta de horário próximo + aviso quando a vaga abre

Data: 2026-09-08
Status: design aprovado (aguardando revisão do spec)

## Problema

Já existe uma lista de espera **só de operação manual**:

- Tabela `waitlist` (`supabase/schema.sql`) com `preferred_days`
  (`['segunda','quarta']`) e `preferred_times` (`['manha','tarde']`) —
  buckets grossos, sem data nem horário exato.
- Módulo `waitlist`, tela `/lista-espera`, rotas `/api/waitlist` e
  `/api/waitlist/[id]` — a equipe adiciona pacientes à mão.
- Cron horário `app/api/cron/waitlist/route.ts`: varre os próximos 3 dias e,
  para cada entrada `waiting` (FIFO, cooldown de 24h via `notified_at`), manda
  o template Meta `waitlist_slot_available` listando **qualquer** vaga que
  achar.

O que falta para o comportamento pedido:

1. A **Maria (`lib/llm/agent.ts`) nunca mexe na lista de espera**. O passo 6
   do fluxo dela só manda "sugira até 3 horários próximos — priorize o mesmo
   dia pedido e, se não houver, o dia seguinte".
2. O cron avisa sobre *qualquer* vaga nos próximos 3 dias, não sobre **o
   dia/horário específico que o paciente tentou**.

Objetivo:

1. Quando o paciente tenta marcar num dia/horário sem vaga, a Maria pergunta
   se ele prefere **outro horário** ou **entrar na lista de espera**.
2. No ramo "outro horário", as opções vêm **ordenadas pela proximidade ao
   horário que o paciente tentou**.
3. No ramo "lista de espera", a Maria registra a entrada guardando o
   **dia** (e o **horário exato**, se o paciente nomeou um).
4. Quando **aquele** dia/horário fica vago, o paciente recebe um aviso por
   WhatsApp que nomeia o slot.

Fora de escopo: a equipe **não** ganha campo de data/horário exato na tela
`/lista-espera` (o fluxo manual segue com `preferred_days`/`preferred_times`);
nenhum status novo além de `expired`; o template manual
`waitlist_slot_available` não muda.

## Decisões

| # | Tema | Decisão |
|---|------|---------|
| 1 | Granularidade do desejo | `waitlist.desired_date` (dia) + `waitlist.desired_time` (horário exato, nullable — só quando o paciente nomeia um) |
| 2 | Consentimento | A Maria **pergunta**: "outro horário ou lista de espera?". Só entra na lista se o paciente escolher isso. Nunca automático |
| 3 | Ramo "outro horário" | Até 3 opções **ordenadas por proximidade ao horário tentado** (mesmo dia primeiro; dentro do dia, horários mais perto do pedido; depois dias vizinhos). Podem ser slots em sequência ou espalhados |
| 4 | Origem da entrada | `waitlist.source` (`'manual'` \| `'bot'`) — separa a entrada da Maria da entrada manual e escolhe o modo de match do cron |
| 5 | Aviso quando vaga | **Template Meta novo** `waitlist_slot_specific` (pt_BR), nomeia o slot. Depende de aprovação da Meta — único item com dependência externa |
| 6 | Match do cron (bot) | Só em `desired_date`. Com `desired_time` → valida aquele instante (`isSlotAvailable`); sem → qualquer vaga naquele dia |
| 7 | Match do cron (manual) | Inalterado — próximos 3 dias, qualquer vaga, template `waitlist_slot_available` |
| 8 | Expiração | Entrada `waiting` com `desired_date < hoje` (fuso São Paulo) vira `status = 'expired'` no início do cron |
| 9 | De-dupe | Índice parcial único `(workspace_id, patient_phone, desired_date) where status = 'waiting'`; `upsert` atualiza `desired_time`/`patient_name` |
| 10 | Fechar a espera ao agendar | Todo agendamento concluído da Maria marca como `scheduled` as linhas `waiting` daquele `patient_id` + `workspace_id` |
| 11 | Gate de módulo | A Maria só oferece/registra lista de espera se `accounts.modules` inclui `'waitlist'` |
| 12 | Multi-unidade | Entrada é por `workspace_id`. Sem unidade resolvida na conversa, a Maria não emite o marcador (o prompt manda perguntar a unidade antes) |

## Modelo de dados

### `waitlist` — 3 colunas novas + status ampliado

```sql
-- supabase/migration_waitlist_maria.sql (idempotente) + reflexo em schema.sql

alter table public.waitlist add column if not exists desired_date date;
alter table public.waitlist add column if not exists desired_time time;
alter table public.waitlist add column if not exists source text not null default 'manual';

alter table public.waitlist drop constraint if exists waitlist_source_check;
alter table public.waitlist add constraint waitlist_source_check
  check (source in ('manual','bot'));

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

`schema.sql` recebe as mesmas colunas na definição da tabela, o novo
`check` de `status`, e os dois índices na seção de índices.

### `types/database.ts`

- `waitlist` Row/Insert/Update: `desired_date: string | null`,
  `desired_time: string | null`, `source: string`.
- `WaitlistStatus`: acrescenta `'expired'`.

## Lado da Maria

### `lib/llm/agent.ts`

- **Contexto:** o `select` de `accounts` (hoje `.select('name')`, passo 1.1)
  passa a `.select('name, modules')`. `waitlistEnabled =
  (account?.modules ?? []).includes('waitlist')`, repassado ao
  `buildDynamicSystemPrompt`.
- **Escrita da entrada:** depois dos blocos de agendamento e cancelamento
  (após o bloco `markers.cancelledAppointmentId`), novo bloco:

  ```
  if (markers.waitlistDesired && waitlistEnabled && !markers.confirmedDate && patient) {
    const waitlistUnitId =
      (markers.unitId && allUnitById.has(markers.unitId) ? markers.unitId : null)
      ?? currentUnitId
      ?? (units.length === 1 ? units[0].id : null)
    if (waitlistUnitId) {
      await supabase.from('waitlist').upsert(
        {
          workspace_id: waitlistUnitId,
          account_id: accountId,
          patient_id: patient.id,
          patient_name: patient.full_name ?? 'Paciente',
          patient_phone: patientPhone,
          desired_date: markers.waitlistDesired.date,
          desired_time: markers.waitlistDesired.time,   // null se o paciente não deu horário
          source: 'bot',
          status: 'waiting',
        },
        { onConflict: 'workspace_id,patient_phone,desired_date' }
      )
      await trackWaitlistPatientAddedByBot(accountId, {
        workspace_id: waitlistUnitId,
        account_id: accountId,
      })
    }
  }
  ```

  Sem `waitlistUnitId` (multi-unidade sem unidade resolvida) → não faz nada; o
  prompt instrui a Maria a confirmar a unidade antes de oferecer a lista.
  O `upsert` com `onConflict` no índice parcial atualiza `desired_time` e
  `patient_name` de uma entrada `waiting` já existente para o mesmo dia.

  > Nota de implementação: a inferência de `onConflict` do supabase-js sobre
  > índice **parcial** pode não resolver. Se não resolver, trocar por
  > select-then-insert/update explícito (buscar linha `waiting` do mesmo
  > `workspace_id`+`patient_phone`+`desired_date`; existe → `update`
  > `desired_time`; não existe → `insert`). O índice parcial único continua
  > como rede de segurança contra corrida.

- **Fechar a espera ao agendar:** dentro do `if (appt)` do bloco de
  agendamento (junto de `createBookingRevenueEntry`), acrescenta:

  ```
  await supabase
    .from('waitlist')
    .update({ status: 'scheduled' })
    .eq('workspace_id', bookingUnitId)
    .eq('patient_id', patient.id)
    .eq('status', 'waiting')
  ```

  Quem marcou consulta sai da lista e não é mais cutucado — inclusive quando o
  agendamento veio da resposta ao próprio aviso de vaga.

- **Analytics:** `trackWaitlistPatientAddedByBot` novo em
  `lib/analytics/posthog-server.ts`, evento `waitlist_patient_added_by_bot`,
  espelhando a assinatura de `trackAppointmentBookedByBot`
  (`distinctId = accountId`, props `{ workspace_id, account_id }`).

### `lib/bot/parse-markers.ts`

Novo marcador. Aceita data pura ou data+hora com offset de São Paulo (mesmo
padrão do `CONFIRMATION_MARKER`):

```
export const WAITLIST_MARKER =
  /LISTA_ESPERA:\s*(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::\d{2})?-03:00)?/
```

`ParsedMarkers` ganha:

```
/** Dia (e horário, se o paciente nomeou um) que o paciente quer esperar, ou null. */
waitlistDesired: { date: string; time: string | null } | null
```

- `date` = grupo 1 (`AAAA-MM-DD`).
- `time` = grupo 2 (`HH:mm`) ou `null`.
- A linha inteira é removida de `cleanedMessage` (e portanto de
  `messageForPatient`), como os outros marcadores.

### `lib/bot/prompt-builder.ts`

- `BuildPromptInput` ganha `waitlistEnabled: boolean`.
- **Passo 6 do fluxo de agendamento** (hoje
  `"6. Verifique se o dia/horário pedido está entre os horários disponíveis
  ... Se não estiver, sugira até 3 horários próximos — priorize o mesmo dia
  pedido e, se não houver, o dia seguinte ..."`) é reescrito:

  > Verifique se o dia/horário pedido está entre os horários disponíveis da
  > unidade escolhida. Se estiver, siga com o agendamento.
  >
  > Se **não** estiver, primeiro diga que aquele dia/horário está sem vaga e
  > pergunte o que o paciente prefere: **(a)** outro dia/horário, ou
  > **(b)** entrar na lista de espera para você avisar se abrir uma vaga
  > exatamente no dia (e horário) que ele queria.
  >
  > - Se ele escolher **(a)**, ofereça até 3 horários **ordenados pela
  >   proximidade ao horário que ele tentou**: o mesmo dia primeiro e, dentro
  >   do dia, os horários mais perto do pedido; só depois os dias vizinhos.
  >   Podem ser horários em sequência ou espalhados — o que estiver livre na
  >   lista acima. Siga com o agendamento normal.
  > - Se ele escolher **(b)**, confirme em linguagem natural ("beleza, te
  >   aviso se vagar quarta às 15h") e inclua uma linha isolada no formato
  >   exato:
  >   `LISTA_ESPERA: AAAA-MM-DD`  (se ele deu só o dia)
  >   `LISTA_ESPERA: AAAA-MM-DDTHH:mm-03:00`  (se ele deu um horário exato)
  >   Inclua também a linha `UNIDADE_ID` da unidade escolhida. Essa linha é
  >   lida por um sistema automático, nunca deve ser mostrada ao paciente, e
  >   **nunca** deve sair na mesma resposta que `AGENDAMENTO_CONFIRMADO`.

  Esse bloco (do "Se **não** estiver" em diante) só é injetado quando
  `waitlistEnabled` é `true`. Com o módulo desligado, o passo 6 mantém o texto
  atual, mas com a ordenação por proximidade aplicada ao ramo de alternativas
  (melhora incidental do comportamento existente).

**Limitação conhecida:** a Maria só ordena entre os horários que já estão no
system prompt — os próximos ~4 dias com vaga que `collectFreeSlots` monta
(`lib/llm/agent.ts`, `maxDays = 4`, varredura de até 12 dias). Um pedido para
um dia muito distante não é coberto por esta feature; já é assim hoje.

## Lado do aviso — `app/api/cron/waitlist/route.ts`

Ordem de execução dentro do `POST`:

1. **Expiração.** Antes de qualquer notificação:

   ```
   const todaySP = format(new TZDate(new Date(), TZ), 'yyyy-MM-dd')
   await supabase.from('waitlist')
     .update({ status: 'expired' })
     .eq('status', 'waiting')
     .not('desired_date', 'is', null)
     .lt('desired_date', todaySP)
   ```

2. **Busca das entradas `waiting`** (query atual, mais `desired_date`,
   `desired_time`, `source`).

3. **Ramificação por `source`:**

   - **`source === 'bot'`** (sempre tem `desired_date`):
     - Monta `day = parseISO(entry.desired_date)`.
     - Se `desired_time`: `ok = await isSlotAvailable(workspace_id, <day+time
       em TZ São Paulo>, 30)`. Texto do slot:
       `"<dia da semana>, DD/MM às HH:mm"`.
     - Se não: `free = (await getAvailableSlots(workspace_id, day)).filter(s
       => s.available)`; `ok = free.length > 0`. Texto do slot:
       `"<dia da semana>, DD/MM — HH:mm, HH:mm, HH:mm"` (até 3).
     - Se `ok`, respeitando o cooldown de 24h (`notified_at`):
       `sendWaitlistSpecificTemplate(...)`, grava `notified_at`,
       `trackWaitlistPatientNotified(...)` (evento atual, reaproveitado).
     - Para de avisar quando a entrada sai de `waiting` (agendou → §10 do
       agente) ou quando `desired_date` passa (expira no passo 1).

   - **`source === 'manual'`**: bloco atual **sem alteração** (próximos
     `DAYS_AHEAD = 3` dias, qualquer vaga, `sendWaitlistTemplate` /
     `waitlist_slot_available`).

`NOTIFY_COOLDOWN_HOURS = 24` e o filtro
`.or('notified_at.is.null,notified_at.lt.<cutoff>')` continuam valendo para as
duas origens.

### `lib/whatsapp/send.ts`

```
interface SendWaitlistSpecificParams {
  to: string
  phoneNumberId: string
  token: string
  patientName: string
  workspaceName: string
  slot: string          // "quarta-feira, 15/01 às 15:00" | "quarta-feira, 15/01 — 14:00, 15:30, 16:00"
}

export async function sendWaitlistSpecificTemplate(p: SendWaitlistSpecificParams)
```

Mesma estrutura de `sendWaitlistTemplate`, template
`name: 'waitlist_slot_specific'`, `language: { code: 'pt_BR' }`, `body` com
3 parâmetros de texto: `patientName`, `workspaceName`, `slot`.

**Ação externa:** cadastrar e submeter o template `waitlist_slot_specific` no
Meta Business Manager (pt_BR), texto sugerido:

> Oi {{1}}! Abriu uma vaga na {{2}} no horário que você queria: {{3}}. Quer
> que eu confirme? É só me responder por aqui.

## Tela `/lista-espera`

Mudança mínima em `components/waitlist/WaitlistClient.tsx`:

- `STATUS_LABEL` / `STATUS_STYLE`: entrada para `expired` ("Expirada",
  estilo neutro/cinza).
- Na linha da entrada, quando houver `desired_date`: mostrar
  `DD/MM` + (`desired_time` → `às HH:mm`), e uma tag "via WhatsApp" quando
  `source === 'bot'`.
- Sem novos campos no formulário de inclusão manual — `desired_date`/
  `desired_time`/`source` não entram no `POST /api/waitlist` da equipe, que
  segue gravando `source` no default `'manual'`.

`app/(dashboard)/lista-espera/page.tsx` já faz `select('*')` — nada a mudar
na query.

## Casos de borda

| Situação | Comportamento |
|---|---|
| Vários pacientes esperando o mesmo slot exato | FIFO (`order('created_at')`, já existe). Todos recebem o aviso; o primeiro a responder e agendar leva. A revalidação `isSlotAvailable` no `agent.ts` dá `BOOKING_FAILED_MESSAGE` aos demais. As entradas perdedoras seguem `waiting` e expiram no dia |
| Slot abre e fecha antes de o paciente responder | Próxima execução do cron vê o slot ocupado, não reavisa |
| Paciente aceita outra data que a Maria ofereceu | O agendamento concluído fecha **todas** as linhas `waiting` dele naquela unidade (§10) — não recebe mais aviso, mesmo que a data original vague |
| Paciente responde ao aviso dias depois, slot já foi levado | Fluxo normal de agendamento → `BOOKING_FAILED_MESSAGE`; a entrada expira no dia |
| Conta sem módulo `waitlist` | A Maria não menciona lista de espera; se o marcador vier mesmo assim, o bloco em `agent.ts` é ignorado (`waitlistEnabled` falso) |
| Multi-unidade, paciente ainda não escolheu unidade | A Maria pergunta a unidade antes (prompt); sem `UNIDADE_ID`/`currentUnitId`, o marcador não é gravado |

## Testes (vitest — segue `tests/agent/`, `tests/helpers/`)

**`tests/agent/markers.test.ts`**
- `LISTA_ESPERA: 2026-09-16` → `waitlistDesired = { date: '2026-09-16', time: null }`.
- `LISTA_ESPERA: 2026-09-16T15:00-03:00` → `{ date: '2026-09-16', time: '15:00' }`.
- A linha some de `messageForPatient`.
- `LISTA_ESPERA` e `AGENDAMENTO_CONFIRMADO` na mesma resposta são parseados de
  forma independente (sem colisão de regex).

**`tests/agent/waitlist.test.ts` (novo)** — via `agent-harness` + `createSupabaseMock`
- Resposta do modelo com `LISTA_ESPERA` + `UNIDADE_ID` e sem
  `AGENDAMENTO_CONFIRMADO` → insere linha `waitlist` com `source='bot'`,
  `status='waiting'`, `desired_date`/`desired_time` corretos, `workspace_id`
  da unidade.
- Segunda chamada com o mesmo paciente/dia → `upsert` (não cria segunda
  linha).
- `accounts.modules` sem `'waitlist'` → nenhuma escrita em `waitlist`.
- Resposta com `AGENDAMENTO_CONFIRMADO` → linhas `waiting` daquele
  paciente+unidade viram `scheduled`.

**`tests/cron/waitlist.test.ts` (novo)**
- Entrada `bot` com `desired_time`: notifica só quando aquele instante está
  livre; usa `sendWaitlistSpecificTemplate`; grava `notified_at`; respeita
  cooldown de 24h.
- Entrada `bot` só com `desired_date`: notifica quando há qualquer vaga no
  dia; texto lista até 3 horários.
- Entrada `manual`: caminho inalterado, `sendWaitlistTemplate`.
- Expiração: `waiting` com `desired_date` no passado vira `expired` e não é
  notificada.

## Arquivos tocados

| Arquivo | Mudança |
|---|---|
| `supabase/migration_waitlist_maria.sql` | **novo** — colunas, checks, índices |
| `supabase/schema.sql` | colunas/checks/índices de `waitlist` |
| `types/database.ts` | `waitlist` Row/Insert/Update + `WaitlistStatus` |
| `lib/bot/parse-markers.ts` | `WAITLIST_MARKER` + `waitlistDesired` |
| `lib/bot/prompt-builder.ts` | `waitlistEnabled`; reescrita do passo 6 |
| `lib/llm/agent.ts` | `accounts.modules`; bloco de `upsert` da espera; fechar `waiting` ao agendar |
| `lib/analytics/posthog-server.ts` | `trackWaitlistPatientAddedByBot` |
| `lib/whatsapp/send.ts` | `sendWaitlistSpecificTemplate` |
| `app/api/cron/waitlist/route.ts` | expiração; ramificação `bot`/`manual` |
| `components/waitlist/WaitlistClient.tsx` | rótulo `expired`; exibir `desired_date`/`desired_time`/tag "via WhatsApp" |
| `tests/agent/markers.test.ts` | casos do `WAITLIST_MARKER` |
| `tests/agent/waitlist.test.ts` | **novo** |
| `tests/cron/waitlist.test.ts` | **novo** |

Ação externa (fora do repo): submeter o template `waitlist_slot_specific`
(pt_BR) no Meta Business Manager antes do deploy do cron.
