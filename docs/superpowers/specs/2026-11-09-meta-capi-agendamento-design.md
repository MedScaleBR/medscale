# Conversões para a Meta: agendamento vira `LeadSubmitted`

Data: 2026-11-09

## Por quê

Os anúncios Click-to-WhatsApp das clínicas hoje só têm um sinal: a contagem
automática de conversas iniciadas, feita pela própria Meta. Ela otimiza para
gente que *manda mensagem*, não para gente que *marca consulta*. O MedScale já
guarda o `ctwa_clid` de quem veio de anúncio (`lead_attributions`, gravado no
webhook por `lib/whatsapp/referral.ts`), mas nunca devolve nada para a Meta.

Objetivo: cada consulta marcada por um paciente que veio de anúncio vira um
evento `LeadSubmitted` na Conversions API for Business Messaging. Com ≥10
eventos em 30 dias a clínica pode trocar a meta da campanha para "Maximizar
leads por mensagem", que aprende com esse evento.

## Decisões do usuário

- **Evento:** `LeadSubmitted`. A Meta não tem evento "agendamento" no canal
  WhatsApp (lista fixa de 14). `QualifiedLead` não está confirmado como meta
  de otimização; `Purchase` exige valor e não serve a clínica só de convênio.
- **Sem valor da consulta.** Nenhum `value`/`currency` no `custom_data`.
- **Toda consulta conta**, não só a primeira do paciente, desde que ele tenha
  `ctwa_clid`. (A Meta só usa para otimizar o que chega até 7 dias após o
  clique; o resto só aparece em relatório. Enviar mesmo assim.)
- **Momento do envio:**
  - *Agenda interna:* quando a consulta é criada — pela recepção na tela
    (`app/api/appointments/route.ts`, insert com `source: 'manual'`) ou pela
    Clara (`lib/llm/agent.ts`, insert com `source: 'bot'`, status `agendado`).
  - *Agenda externa:* quando a Clara manda ao paciente a mensagem de
    confirmação com os dados dele — o ponto onde a solicitação é gravada em
    `handoff_logs` com `trigger_reason = EXTERNAL_REQUEST_REASON` (dentro do
    horário via `executeHandoff`, fora via `recordPendingExternalRequest`, ambos
    em `lib/llm/agent.ts`). Não espera a clínica confirmar.
  - *Agendamento terceirizado:* quando a Clara cria a consulta como
    `pendente_confirmacao_externa` (`requestExternalConfirmation` em
    `lib/outsourced/request.ts`, resultado `requested` ou `send_failed` — os
    dois têm `appointmentId`). Não espera a clínica parceira confirmar; a
    confirmação depois (`lib/outsourced/confirm.ts`) não gera outro evento,
    porque o `dedup_key` é o mesmo `appt:<appointment_id>`.

## Fora de escopo

- `Purchase` e `QualifiedLead` (próximos passos possíveis: `QualifiedLead`
  quando a consulta vira `realizado`).
- Pacientes sem `ctwa_clid` (orgânico, indicação). A rota de dados com hash
  exige `page_id` e só vale para clique de até 7 dias — não vale o custo agora.
- Desfazer evento em cancelamento (a Meta não tem como desfazer).
- Tela de configuração. O envio é automático para toda account com WhatsApp
  conectado.

## Anti-objetivos

- Atrasar ou quebrar a resposta ao paciente / o agendamento por causa da Meta.
  Toda chamada é best-effort, como `recordAttribution`.
- Mandar o mesmo agendamento duas vezes (a Meta **não** deduplica).
- Vazar dado de paciente em log técnico (LGPD: logs só com ids).

## Como funciona

### 1. Registro dos eventos (tabela nova)

`meta_conversion_events` — uma linha por evento que *deve* ir para a Meta:

- `account_id`, `ctwa_clid`, `event_name` (`LeadSubmitted`), `event_time`
- `dedup_key` **único por account** — é a garantia de "uma vez só":
  - agenda interna: `appt:<appointment_id>`
  - agenda externa: `ext:<handoff_log_id>`
- `appointment_id` / `handoff_log_id` (nullable, para rastrear)
- `status` (`pending` | `sent` | `failed`), `attempts`, `last_error`
  (só código/mensagem da Meta, nunca dado de paciente), `sent_at`

Migration nova em `supabase/migration_meta_conversions.sql`, RLS no padrão das
outras tabelas de account; escrita só pelo admin client.

### 2. Gatilho

Função única, ex. `queueLeadConversion({ accountId, patientPhone, dedupKey,
appointmentId?, handoffLogId?, occurredAt })` em `lib/meta/conversions.ts`:

1. Busca em `lead_attributions` o `ctwa_clid` mais recente não nulo daquela
   account + telefone com `occurred_at` ≤ `occurredAt`. Sem `ctwa_clid` → não
   faz nada.
2. Insere em `meta_conversion_events` com `on conflict (account_id,
   dedup_key) do nothing`.
3. Tenta enviar na hora (passo 3). Nunca lança.

Chamada nos quatro pontos acima, depois do insert da consulta / da gravação da
solicitação dar certo.

**Telefone:** `appointments.patient_phone` e `lead_attributions.patient_phone`
podem estar em formatos diferentes. Normalizar com o que já existe em
`lib/phone.ts` antes de comparar.

### 3. Envio

- Dataset: `POST /{waba_id}/dataset` (devolve o existente se já houver).
  Guardar o id (ex. coluna `meta_dataset_id` em `bot_config`) para não
  chamar toda vez.
- Evento: `POST /{dataset_id}/events` via `graphFetch` (`lib/meta/graph.ts`),
  token = `bot_config.meta_token` descriptografado:

```json
{
  "data": [{
    "event_name": "LeadSubmitted",
    "event_time": 1731160000,
    "event_id": "<dedup_key>",
    "action_source": "business_messaging",
    "messaging_channel": "whatsapp",
    "user_data": {
      "whatsapp_business_account_id": "<waba_id>",
      "ctwa_clid": "<ctwa_clid>"
    }
  }],
  "partner_agent": "medscale"
}
```

- Sucesso → `sent`. Erro → `failed`, `attempts++`. Token expirado
  (`MetaApiError.isTokenExpired`) ou falta de permissão → marca `failed` sem
  insistir na hora.

### 4. Reenvio

Cron novo `app/api/cron/meta-conversions` (mesmo padrão de auth de
`lib/cron-auth.ts` e dos crons existentes): pega `pending`/`failed` com
`attempts < 5` e `event_time` nos últimos 7 dias, tenta de novo. Depois disso
desiste (fora da janela a Meta não otimiza com ele de qualquer jeito).

## Pré-requisitos fora do código (usuário)

1. No app da Meta do MedScale: pedir a permissão
   `whatsapp_business_manage_events` (acesso avançado/"Full Access"), além de
   `whatsapp_business_management`.
2. Incluir a permissão na configuração do Embedded Signup (`config_id`).
3. Clínicas já conectadas provavelmente precisam reconectar o WhatsApp para o
   token ganhar a permissão nova.
4. Depois do primeiro envio: conferir no Gerenciador de Eventos da clínica que o
   dataset recebe `LeadSubmitted`, e trocar a meta da campanha quando tiver ≥10
   eventos em 30 dias.

## Testes

- `queueLeadConversion`: com `ctwa_clid` enfileira; sem não faz nada; pega o
  clique mais recente anterior ao agendamento; mesmo `dedup_key` duas vezes →
  uma linha; erro da Meta não propaga.
- Montagem do payload (sem `value`, campos acima).
- Os quatro pontos de chamada disparam com o `dedup_key` certo; confirmar
  uma consulta terceirizada não gera segundo evento.
- Cron: respeita `attempts` e a janela de 7 dias.

## Decisões minhas (revisar)

- Tabela própria com status em vez de "dispara e esquece": é o que permite
  deduplicar e reenviar.
- Clique mais recente anterior ao agendamento quando o paciente veio de mais de
  um anúncio.
- Reenvio limitado a 5 tentativas / 7 dias.
- Agenda externa deduplica por solicitação (`handoff_log_id`). Se o paciente
  refaz a solicitação e a anterior é fechada como substituída
  (`closeSupersededExternalRequests`), sai um segundo evento — aceito, é raro.
- `partner_agent: "medscale"`.
