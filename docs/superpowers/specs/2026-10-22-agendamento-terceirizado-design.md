# Spec — Agendamento terceirizado (IAD) na Clara (`/locais`, webhook, `lib/llm/agent.ts`)

---

## Contexto do projeto

**MedScale** é um SaaS multi-tenant para clínicas médicas.
Stack: Next.js 16 App Router · React 19 · Tailwind v4 · shadcn/ui · Supabase (Postgres + RLS) · Supabase Auth · Meta Cloud API · Claude (`claude-sonnet-4-5` via `@anthropic-ai/sdk`).
Hierarquia: `accounts → workspaces (unidades) → memberships`. Papéis: `owner`, `admin`, `member`.

A **Clara** é o bot de WhatsApp de agendamento (nome fixo). Existe **uma Clara por account**:
`bot_config` tem `account_id unique` e guarda a personalidade **e** a conexão WhatsApp
(`phone_number_id`, `meta_token` cifrado). Um número atende todas as unidades da account.
**Não criar `bot_config` por unidade, não duplicar número.**

`workspaces` **já é** a tabela de unidades / locais de atendimento (tela `/locais`,
`components/locais/WorkspacesClient`). **Não criar tabela `clinic_locations`.**

### O problema

Algumas unidades dependem de uma **clínica terceira** (ex.: IAD, unidades "IAD Lauro" e
"IAD Pituba") para confirmar horário. O MedScale não tem acesso à agenda dela (sistema MedX).
Hoje a secretária faz manualmente: vê um horário livre, manda WhatsApp para a IAD pedindo
o horário, espera a IAD responder com um template "CONSULTA AGENDADA" e avisa o paciente.

**Objetivo:** automatizar esse ida-e-volta. A Clara cria o agendamento como pendente,
envia a solicitação para a IAD, interpreta a resposta, confirma para o paciente. Nunca
promete ao paciente antes da IAD confirmar, nunca confirma por engano.

> **Não tocar no MedX.** Uma abordagem anterior que reusava o token de sessão da
> secretária no MedX foi descartada por ser acesso não autorizado. Esta feature só
> automatiza a troca de WhatsApp. Não reintroduzir nada de token/MedX.

### Fatos que simplificam

- **Cada account tem um único médico.** A correlação de respostas não depende do nome do
  médico (ver 3.4).
- **A conversa com a IAD é exclusivamente para marcar consulta.** Toda mensagem da IAD
  é relevante: o que não for confirmação reconhecível é tratado por um humano.
- A IAD e os pacientes falam com **o mesmo número** de WhatsApp da clínica.

### Partes da arquitetura que esta feature toca

- **Webhook** `app/api/whatsapp/webhook/route.ts`: resolve a account pelo `phone_number_id`
  (via `bot_config`), valida HMAC com `META_APP_SECRET`, responde 200 e processa em `after()`.
  Já existe um desvio por número para o agente financeiro (`FINANCE_PHONE_NUMBER_ID` →
  `processFinancialMessage`). É o padrão a imitar para o desvio novo.
- **Agente** `lib/llm/agent.ts`: `processIncomingMessage`, interceptação dos marcadores
  `UNIDADE_ID`, `AGENDAMENTO_CONFIRMADO`, `CANCELAMENTO_CONFIRMADO`, `NOME_PACIENTE`,
  `CONVENIO_ID`/`PARTICULAR`, `[HANDOFF]`. Revalida `isSlotAvailable` antes de gravar e
  já tem o padrão de **descartar a resposta do Claude e mandar mensagem fixa** quando o
  horário foi ocupado — reusar esse padrão.
- **Prompt** `lib/bot/prompt-builder.ts`: `buildDynamicSystemPrompt`.
- **Disponibilidade** `lib/google/availability.ts`: por unidade, filtra appointments por status.
- **Handoff** `lib/bot/handoff.ts` + `handoff_logs` + push (`memberships.handoff_push_enabled`).
- **Google Calendar**: sync best-effort, `appointments.gcal_event_id`, `lib/google/reconcile.ts`.
- **Crons**: `supabase/cron.sql` (pg_cron + pg_net, de hora em hora) → `/api/cron/*`,
  autenticados por `CRON_SECRET` no header `Authorization` (Vault, `public.cron_secret()`).
  Espelhar exatamente a autenticação das rotas de cron já existentes.
- **Normalização de telefone ignorando o nono dígito**: já existe no agente financeiro
  (`lib/finance/agent.ts`). Extrair para um helper compartilhado se ainda não for, e reusar.
- **Timezone**: tudo com data/hora usa `TZDate` (`@date-fns/tz`) em `America/Sao_Paulo`.

> A documentação do repo pode estar defasada. **Confirme nomes reais de tabelas, colunas,
> enums e funções em `supabase/schema.sql` e no código antes de escrever qualquer SQL ou
> import.** Onde este arquivo diz "confirmar", confirme.

---

## O que implementar

### 1. Configuração por unidade (`/locais`)

- Acesso: owner/admin (mesma regra atual de edição de unidade).
- No formulário de edição de unidade que já existe em `WorkspacesClient`, adicionar:
  - toggle **"Agendamento terceirizado"** → `workspaces.is_outsourced`
  - campo **"WhatsApp da clínica parceira"** → `workspaces.external_clinic_phone`
- Validação (UI **e** API): toggle ligado exige telefone válido. Salvar o telefone só com
  dígitos, com DDI (ex.: `5571999990000`).
- Texto de ajuda curto: "A Clara envia a solicitação para esse número e só confirma ao
  paciente depois que a clínica parceira responder."

**Regra de ativação:** o fluxo terceirizado só vale quando `is_outsourced = true` **E**
`external_clinic_phone` preenchido. Qualquer outra combinação = fluxo nativo, idêntico ao
atual. Uma account pode ter unidades terceirizadas e nativas ao mesmo tempo.

Criar helper único, usado em todo lugar:

```typescript
// lib/outsourced/config.ts
export function isOutsourcedWorkspace(ws: { is_outsourced: boolean; external_clinic_phone: string | null }): boolean
```

### 2. Coleta de dados pela Clara (prompt)

Para unidades terceirizadas, a solicitação à IAD precisa de **nome completo, convênio
(ou particular), data de nascimento e telefone**. O telefone já é o da conversa.

- Em `buildDynamicSystemPrompt`, marcar no bloco de cada unidade terceirizada que ela
  exige nome completo e data de nascimento antes de agendar.
- Novo marcador: **`NASCIMENTO_PACIENTE: DD/MM/AAAA`** → grava `patients.birth_date`
  (confirmar se a coluna existe; criar se não). Mesmo tratamento dos outros marcadores:
  removido antes de enviar, validado (data real, no passado, idade ≤ 120), listado em
  `lib/bot/security.ts` como sinal de injection se vier na mensagem do paciente.
- No backend, em `AGENDAMENTO_CONFIRMADO` de unidade terceirizada: se faltar nome real
  (ainda `"Paciente"`), data de nascimento ou convênio/particular → **não agenda** e a
  Clara pergunta o que falta (mesmo padrão que já existe para convênio).

### 3. Fluxo de saída — paciente confirma horário numa unidade terceirizada

No ponto em que `AGENDAMENTO_CONFIRMADO` é interceptado em `lib/llm/agent.ts`, depois de
resolver a unidade e revalidar `isSlotAvailable`:

- **Unidade nativa:** nada muda.
- **Unidade terceirizada:**
  1. Se o paciente já tem um appointment `pendente_confirmacao_externa` **nessa unidade**,
     não cria outro: responde que já existe uma solicitação em andamento.
  2. Cria `appointments` com `status = 'pendente_confirmacao_externa'`, `source = 'bot'`,
     `external_requested_at = now()`.
  3. Cria evento no Google Calendar da unidade **como pendente**: título prefixado com
     `[PENDENTE] `, `status: 'tentative'`, mesma `extendedProperties.private.medscale` dos
     outros eventos. Grava `gcal_event_id`. Falha de sync não desfaz o agendamento.
  4. Envia o **template Meta `solicitacao_agendamento`** (seção "Templates Meta") para o
     `external_clinic_phone` da unidade, com o token da account (`bot_config`).
  5. Grava em `clinic_confirmations` (`direction = 'outbound'`, texto renderizado,
     `whatsapp_id` retornado pela Graph API).
  6. **Descarta a resposta do Claude** e envia ao paciente uma mensagem fixa (o Claude não
     pode prometer nada):
     > Pronto, solicitei o horário de {dia} às {hora} na {unidade}. Assim que a clínica
     > confirmar eu te aviso aqui mesmo. 😊
- Se o envio do template falhar: appointment vai para `cancelado`, apaga o evento do
  Google, notifica a equipe (seção 6) e o paciente recebe mensagem honesta ("não consegui
  solicitar agora, a equipe vai te retornar").

### 4. Fluxo de entrada — resposta da IAD

No webhook, **depois** de resolver a account e **antes** do fluxo de paciente:

- Normalizar o telefone do remetente (ignorando nono dígito) e comparar com o
  `external_clinic_phone` normalizado de **todas as workspaces da account** com
  `isOutsourcedWorkspace = true`.
- Bateu → `processClinicReplyMessage({ accountId, workspaceId, message })` e **retorna**.
  Essa mensagem **nunca** cria `patients`, `conversations` nem `messages`.
- Se o mesmo telefone estiver em duas unidades da mesma account (configuração inválida):
  não adivinha, notifica a equipe e loga.

`lib/outsourced/clinic-reply.ts → processClinicReplyMessage`:

1. Dedupe por `whatsapp_id` (unique em `clinic_confirmations`).
2. Grava `clinic_confirmations` (`direction = 'inbound'`, `raw_text`).
3. Mensagem não-texto (áudio, imagem…) → classificação `ambiguo` → notifica equipe.
4. `parseClinicConfirmation(text)` (função pura, testável):
   - Reconhece o cabeçalho `CONSULTA AGENDADA` case-insensitive, tolerando hífen, espaços
     e emojis ao redor (`CONSULTA AGENDADA - IAD PITUBA`, `CONSULTA AGENDADA- IAD PITUBA`).
   - Extrai `Data: DD/MM/AAAA` e `Horário: HH:mm` (obrigatórios), `Médico:` (opcional,
     ignorado na correlação) e nome do paciente (linha solta entre cabeçalho e `Médico:`,
     opcional).
   - Sem cabeçalho ou sem data/hora válidas → `null`.
5. Correlação (só se o parser retornou algo):
   - `appointments` com `workspace_id = workspaceId` **e**
     `status = 'pendente_confirmacao_externa'` **e** início exatamente na data/hora parseada
     (montar com `TZDate` em `America/Sao_Paulo`).
   - Se o template trouxe nome do paciente e houver mais de um candidato, usar o nome
     (normalizado, sem acento/caixa) para desempatar.
   - **Exatamente 1** → confirma (passo 6). **0 ou 2+** → `ambiguo`, notifica a equipe.
6. Confirmação:
   - `status → 'confirmado'`.
   - Google Calendar: remove o prefixo `[PENDENTE] ` e muda para `status: 'confirmed'`.
   - Mensagem ao **paciente** (pelo telefone do appointment/conversa, nunca o da IAD):
     > Sua consulta está confirmada! ✅ {dia} às {hora} na {unidade}, {endereço}.
     Se a última mensagem do paciente tiver mais de 24h, enviar pelo template
     `consulta_confirmada` em vez de texto livre. Salvar em `messages` da conversa do
     paciente como `assistant`.
   - Atualiza `clinic_confirmations` com `appointment_id` e `classification = 'confirmacao'`.
7. **Qualquer mensagem da IAD que não for uma confirmação correlacionada** (negação,
   contraproposta, pergunta, texto livre) → `classification = 'ambiguo'` (ou `negacao` se
   contiver claramente "não"/"sem vaga"/"indisponível"), notifica a equipe com o texto
   bruto. Nunca muda status sozinho.

**A Clara nunca responde à IAD.** Em nenhum branch sai mensagem para `external_clinic_phone`
além da solicitação inicial do passo 3.

### 5. Comportamento da Clara com paciente que tem solicitação pendente

- Em `buildDynamicSystemPrompt`, no bloco "consultas já marcadas", listar pendentes como:
  `{dia} {hora} – {unidade} – AGUARDANDO CONFIRMAÇÃO DA CLÍNICA (id: …)`.
- Regras no prompt:
  - Nunca dizer que uma consulta pendente está confirmada.
  - Se o paciente perguntar, dizer que a solicitação foi feita e que ele será avisado
    por aqui assim que a clínica confirmar.
  - Não oferecer outro horário na mesma unidade enquanto houver pendente, a não ser que o
    paciente peça para trocar (ver abaixo).
- **Cancelamento ou troca** de consulta (pendente **ou** confirmada) em unidade
  terceirizada:
  - Clara emite `CANCELAMENTO_CONFIRMADO: <id>` normalmente.
  - Backend: `status → 'cancelado'`, **apaga** o evento do Google Calendar (delete, não
    só marcar cancelado) e **notifica a equipe** com motivo `cancelamento_terceirizado`
    para a secretária avisar a IAD. A Clara não avisa a IAD.
  - Para trocar de horário, a Clara cancela e faz uma nova solicitação (novo template).
- Se a IAD confirmar algo já cancelado pelo paciente: não haverá pendente correlacionado →
  cai no passo 7 (equipe resolve).

### 6. Notificação da equipe (sem pausar o paciente)

Problemas operacionais com a IAD **não** são handoff de paciente: não mudam
`conversations.status` nem `bot_paused`. Criar
`notifyOutsourcedIssue({ accountId, workspaceId, appointmentId?, reason, rawText? })` que:

- Grava em `handoff_logs` com `trigger_reason` em
  `clinica_externa_ambiguo | clinica_externa_negacao | clinica_externa_timeout |
  cancelamento_terceirizado | clinica_externa_falha_envio | clinica_externa_config`
  (confirmar se `conversation_id` é nullable e se `trigger_reason` tem CHECK; ajustar).
- Envia push para membros com `handoff_push_enabled` com acesso àquela unidade.
- Nunca inclui telefone ou dado do paciente no payload do push (só "Unidade X: resposta
  da clínica parceira precisa de revisão").

### 7. Agenda (painel)

- Pendentes aparecem na agenda com cor/legenda própria ("Aguardando clínica").
- Quando alguém da equipe muda manualmente um pendente para `confirmado` (ex.: a IAD
  confirmou por outro canal), dispara os **mesmos efeitos** do passo 4.6 (mensagem ao
  paciente + update do Google). Reusar a mesma função.
- Mudança manual para `cancelado` apaga o evento do Google.

---

## Crons

Arquivo: `supabase/cron.sql` + rotas em `app/api/cron/*`. Ajustes:

| Cron | Ajuste |
|---|---|
| `appointment-reminders` | **Ignorar** `pendente_confirmacao_externa` (só lembrar `agendado`/`confirmado`). |
| `mark-noshow` | **Excluir explicitamente** `pendente_confirmacao_externa`. Ele marca consultas passadas sem confirmação — sem esse filtro marcaria pendentes como no-show. |
| `waitlist-notify` | Nenhuma mudança de lógica, mas depende do item de disponibilidade abaixo (pendente ocupa o horário; ao cancelar, a vaga reabre e a lista de espera é avisada normalmente). |
| `reconcile-calendar` | **Não alterar o status** de appointments `pendente_confirmacao_externa` a partir do Google. Se o evento de um pendente sumir do Google, recriar (MedScale é dono desse estado). |
| **Novo:** `outsourced-timeout` | De hora em hora. Pendentes com `external_requested_at < now() - interval '4 hours'` e `external_escalated_at is null` → `notifyOutsourcedIssue(reason: 'clinica_externa_timeout')` e grava `external_escalated_at = now()`. **Não muda o status**: se a IAD confirmar depois, confirma normalmente. Pendentes cujo horário já passou → `cancelado` + apaga evento + notifica equipe. |

Rota nova: `app/api/cron/outsourced-timeout/route.ts`, mesma autenticação das demais.
Agendamento em `supabase/cron.sql` seguindo o padrão existente. Como roda de hora em
hora, o escalonamento acontece entre 4h e 5h após a solicitação.

### Disponibilidade (não é cron, mas é pré-requisito)

Em `lib/google/availability.ts` e `isSlotAvailable`: `pendente_confirmacao_externa`
**ocupa o horário** como `agendado`/`confirmado`. Sem isso a Clara oferece o mesmo slot
para outro paciente enquanto espera a IAD.

Procurar no repo **todo** filtro por status de appointment (`.in('status', …)`,
`status = 'agendado'`, enums em TypeScript, KPIs do dashboard, gráficos) e decidir
explicitamente o tratamento do status novo em cada um. Dashboard: pendente conta como
consulta agendada pelo bot, mas não como receita prevista.

---

## Templates Meta

Mensagens iniciadas pela empresa fora da janela de 24h exigem template aprovado. Cadastrar
no WhatsApp Manager da WABA de cada account que usar a feature. Categoria **Utility**,
idioma **pt_BR**.

### `solicitacao_agendamento` (para a clínica parceira)

```
Olá, tudo bem?

Agenda por favor o dia {{1}} às {{2}}:

Nome: {{3}}
Convênio: {{4}}
Data de Nascimento: {{5}}
Contato: {{6}}

Aguardamos a confirmação. Obrigado!
```

Sem rodapé.

| Var | Conteúdo | Exemplo para cadastro |
|---|---|---|
| `{{1}}` | data `DD/MM` | `16/10` |
| `{{2}}` | hora `HH:mm` | `08:00` |
| `{{3}}` | nome completo | `Maria Aparecida Souza` |
| `{{4}}` | nome do convênio ou `Particular` | `Unimed` |
| `{{5}}` | nascimento `DD/MM/AAAA` | `03/05/1980` |
| `{{6}}` | telefone formatado `DD 9XXXX-XXXX` | `71 99999-0000` |

Valores de variável não podem ter quebra de linha, tab nem 4+ espaços seguidos —
sanitizar antes de enviar.

### `consulta_confirmada` (para o paciente, só fora da janela de 24h)

```
Olá, {{1}}! Sua consulta está confirmada para {{2}} às {{3}} na {{4}}.

Qualquer dúvida é só responder esta mensagem.
```

Nomes dos templates em constantes (`lib/outsourced/templates.ts`), não espalhados.

---

## Contrato de dados

Rodar avulso no SQL Editor do Supabase (o `schema.sql` é script de reset, não
incremental). Atualizar também o `schema.sql` para refletir o estado final.
**Confirmar nomes antes.**

```sql
-- 1. Unidades
alter table workspaces
  add column if not exists is_outsourced boolean not null default false,
  add column if not exists external_clinic_phone text;

-- 2. Status novo (confirmar se é ENUM ou CHECK)
-- Se ENUM (confirmar o nome do tipo):
alter type appointment_status add value if not exists 'pendente_confirmacao_externa';
-- Se CHECK: drop + recreate da constraint incluindo o valor novo.

-- 3. Controle do pendente
alter table appointments
  add column if not exists external_requested_at timestamptz,
  add column if not exists external_escalated_at timestamptz;

create index if not exists idx_appointments_pending_external
  on appointments (workspace_id, status)
  where status = 'pendente_confirmacao_externa';

-- 4. Nascimento (só se ainda não existir)
alter table patients add column if not exists birth_date date;

-- 5. Auditoria da troca com a clínica parceira
create table if not exists clinic_confirmations (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id) on delete cascade,
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  appointment_id  uuid references appointments(id) on delete set null,
  direction       text not null check (direction in ('outbound', 'inbound')),
  raw_text        text not null,
  classification  text check (classification in ('confirmacao', 'negacao', 'ambiguo')),
  whatsapp_id     text unique,
  created_at      timestamptz not null default now()
);

alter table clinic_confirmations enable row level security;

create policy "workspace members read clinic_confirmations"
  on clinic_confirmations for select
  using (workspace_id = any(my_workspace_ids()));
-- Sem policy de insert/update: escrita só pelo webhook/agent com createAdminClient.

create index if not exists idx_clinic_conf_workspace on clinic_confirmations (workspace_id, created_at desc);
create index if not exists idx_clinic_conf_appointment on clinic_confirmations (appointment_id);
```

Obs.: `ALTER TYPE … ADD VALUE` não pode ser usado na mesma transação em que o valor é
referenciado; rodar o passo 2 isolado antes do índice do passo 3.

Atualizar os tipos TypeScript de status de appointment em todo o código.

---

## Implementação esperada (arquivos)

```
lib/outsourced/config.ts          isOutsourcedWorkspace()
lib/outsourced/templates.ts       nomes + builder de parâmetros dos templates
lib/outsourced/request.ts         requestExternalConfirmation(appointment) — passo 3
lib/outsourced/parser.ts          parseClinicConfirmation(text) — função pura
lib/outsourced/clinic-reply.ts    processClinicReplyMessage() — passo 4
lib/outsourced/confirm.ts         confirmOutsourcedAppointment() — usado pelo passo 4.6 e pelo painel
lib/outsourced/notify.ts          notifyOutsourcedIssue()
lib/phone.ts                      normalização (extraída do agente financeiro, se necessário)
app/api/cron/outsourced-timeout/route.ts
```

Envio de template pela Graph API (`POST /{phone_number_id}/messages`, `type: 'template'`,
`language: { code: 'pt_BR' }`, `components: [{ type: 'body', parameters: [...] }]`),
usando `META_GRAPH_VERSION` e o token da account, no mesmo cliente que já envia os
templates de lembrete e lista de espera.

---

## Ordem de implementação recomendada

1. Migrations + atualização de tipos de status.
2. Disponibilidade e `isSlotAvailable` considerando pendente; varredura de filtros de status.
3. `lib/phone.ts`, `parser.ts` (com testes) e `config.ts`.
4. Prompt: marcador `NASCIMENTO_PACIENTE`, bloco de pendentes, regras.
5. Fluxo de saída em `agent.ts` + `request.ts` + Google Calendar pendente.
6. Webhook + `clinic-reply.ts` + `confirm.ts` + `notify.ts`.
7. Cancelamento em unidade terceirizada (delete do evento + notificação).
8. Ajuste dos crons existentes + cron novo.
9. UI em `/locais` e cor/legenda na Agenda; confirmação manual no painel.

---

## Restrições

- **Uma Clara por account.** Nada de `bot_config` por unidade.
- **A Clara nunca responde à IAD.** Único outbound para `external_clinic_phone`: o template
  de solicitação.
- **Nunca confirma por engano.** Só confirma com exatamente 1 pendente correlacionado na
  mesma unidade. Todo o resto vai para a equipe.
- **Opt-in por unidade.** Unidade sem os dois campos e accounts sem a feature têm
  comportamento idêntico ao atual. Não alterar o fluxo nativo.
- **Não tocar no MedX** nem em nada de token/sessão de terceiros.
- **Mensagens da IAD nunca viram `patients`/`conversations`/`messages`.**
- **LGPD:** `clinic_confirmations.raw_text`, nome, nascimento, convênio e telefone do
  paciente não vão para Sentry, PostHog, `console.log` nem payload de push. Logar só
  ids, status e classificação.
- **Visibilidade:** edição dos campos só owner/admin (UI, API e RLS); leitura da auditoria
  por membros da unidade via RLS.
- **Clients Supabase:** `createClient` autenticado nas rotas de usuário; `createAdminClient`
  só no webhook, agent e crons.
- **Timezone:** `TZDate` em `America/Sao_Paulo` no parser, na correlação e nas mensagens.
- **Custo:** nenhuma chamada extra ao Claude. O parser é determinístico.
- Commitar, não abrir PR.

---

## Como testar

- [ ] Parser: os dois formatos reais abaixo, com e sem nome, com emojis, hífen colado,
      caixa diferente; texto livre → `null`; data/hora inválidas → `null`.
- [ ] Unidade nativa: `AGENDAMENTO_CONFIRMADO` cria `confirmado` como antes.
- [ ] Unidade terceirizada sem nascimento/nome/convênio: não agenda, Clara pergunta.
- [ ] Unidade terceirizada completa: cria pendente, evento `[PENDENTE]` tentativo, envia
      template para a IAD, paciente recebe a mensagem fixa de "solicitado".
- [ ] Pendente ocupa o slot: outro paciente não recebe esse horário.
- [ ] Resposta "CONSULTA AGENDADA" correta → `confirmado`, evento atualizado, paciente avisado.
- [ ] Isolamento: duas unidades IAD com pendentes no mesmo dia/hora; resposta do número de
      Pituba só confirma o pendente de Pituba.
- [ ] 2 pendentes na mesma unidade/data/hora sem nome no template → equipe notificada, nada confirmado.
- [ ] Texto livre da IAD ("não tenho esse horário") → equipe notificada, status inalterado.
- [ ] Nenhum branch envia mensagem para `external_clinic_phone` além da solicitação.
- [ ] Mensagem da IAD não cria paciente/conversa/mensagem.
- [ ] Cancelamento de pendente e de confirmado em unidade terceirizada → `cancelado`,
      evento apagado do Google, equipe notificada.
- [ ] `outsourced-timeout`: pendente com 4h+ → notificação única; confirmação posterior
      ainda funciona; pendente com horário passado → `cancelado`.
- [ ] `mark-noshow` e `appointment-reminders` não tocam em pendentes.
- [ ] Toggle ligado sem telefone é rejeitado na UI e na API.

Formatos reais de confirmação da IAD:

```
CONSULTA AGENDADA - IAD PITUBA

Marilene Ribeiro

Médico: Dr Gutemberg Brito
Horário: 09:00
Data: 09/10/2026
📍Nosso endereço: ...
```

```
CONSULTA AGENDADA- IAD PITUBA

Médico: Dr Gutemberg Brito
Horário: 08:00
Data: 16/10/2026
📍Nosso endereço: ...
```

Config externa antes de testar em produção:

- [ ] Templates `solicitacao_agendamento` e `consulta_confirmada` aprovados na WABA da account.
- [ ] Entrada do `outsourced-timeout` em `supabase/cron.sql` rodada no SQL Editor.
- [ ] Unidades IAD Lauro e IAD Pituba com toggle ligado e telefone da IAD preenchido.
