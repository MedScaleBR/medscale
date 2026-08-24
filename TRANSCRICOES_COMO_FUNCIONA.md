# Transcrição de Consultas — como funciona

> Documentação de arquitetura do módulo `transcriptions`. Para instalar/configurar, veja
> **[TRANSCRICOES_SETUP.md](TRANSCRICOES_SETUP.md)**. Para o resto do produto, veja
> [README.md](README.md) / [SETUP.md](SETUP.md).

## Visão geral

O médico grava o áudio da consulta pelo navegador, o áudio é transcrito pelo Whisper (OpenAI) e
o Claude gera um prontuário estruturado no formato **SOAP** (Subjetivo / Objetivo / Avaliação /
Plano) a partir da transcrição. O médico revisa, edita o que quiser e assina — só depois de
assinado o prontuário é considerado final.

É um módulo controlado por feature flag (`"transcriptions"` em `accounts.modules`), inativo por
padrão, igual aos outros módulos do produto (`agenda`, `waitlist`, etc. — ver `lib/session/api.ts`).
Como admin MedScale, você ativa/desativa por account em **`/admin/accounts/[id]`**, na mesma lista
de módulos toggláveis dos demais (`components/admin/AccountDetailForm.tsx`).

## O pipeline

Cada transcrição é uma linha na tabela `transcriptions` que caminha por uma máquina de estados
(`transcription_status`):

```
pending → transcribing → transcribed → generating → draft_ready → signed
                                                          ↓
                                                        error (a partir de qualquer etapa)
```

| Status | O que significa | Quem está de olho |
|---|---|---|
| `pending` | Áudio já está no Storage, na fila para o Whisper | `POST /api/transcriptions/process` |
| `transcribing` | Whisper processando o áudio | idem |
| `transcribed` | Texto pronto, aguardando o Claude começar | `POST /api/transcriptions/generate-record` |
| `generating` | Claude gerando o SOAP | idem |
| `draft_ready` | Prontuário rascunho pronto, esperando revisão do médico | UI (`/transcricoes/[id]`) |
| `signed` | Médico assinou — `medical_record_final` é a versão oficial | — |
| `error` | Alguma etapa falhou 3x seguidas | UI mostra botão "Tentar novamente" |

O disparo entre etapas **não é síncrono** — cada rota, ao terminar seu trabalho, dispara a
próxima via uma função Postgres (`trigger_transcription_process` / `trigger_transcription_generate`)
que usa `pg_net.http_post` para chamar a rota seguinte de forma assíncrona (mesmo mecanismo já
usado pelos crons do produto, ver `supabase/cron.sql`). Isso existe porque **não há worker
separado** neste projeto — tudo roda em rotas de API do Next.js chamadas por HTTP.

### Passo a passo completo

1. **Consentimento** — `ConsentDialog` exige confirmação explícita antes de `getUserMedia` ser
   chamado. Sem isso, `consent_confirmed` nunca vira `true` e o upload é rejeitado.
2. **Gravação** — `RecordingButton` usa `MediaRecorder` (`audio/webm;codecs=opus`, com fallback
   para `audio/webm` puro se o navegador não suportar o codec Opus), acumulando chunks a cada
   10 segundos até o médico clicar em "Encerrar gravação".
3. **Upload direto ao Storage** — o Blob gravado **nunca passa pelo servidor Next.js**, ele vai
   direto do browser para o Supabase Storage, em três chamadas:
   1. `POST /api/transcriptions/upload-url` — valida sessão e módulo
      (`requireModule(session, 'transcriptions')`) e emite uma *signed upload URL*
      (`createSignedUploadUrl`) para o path
      `${workspace_id}/${appointment_id ?? 'no-appointment'}/${timestamp}.${ext}` no bucket
      privado `recordings`. Só emite a URL se a RLS de `storage.objects` permitir o INSERT nesse
      path para o usuário logado — a mesma verificação que valeria para um upload comum.
   2. O browser chama `supabase.storage.from('recordings').uploadToSignedUrl(path, token, blob)`
      diretamente contra o Supabase — o corpo dessa requisição nunca atravessa uma rota do
      Next.js, então o limite de corpo das funções serverless da Vercel não entra em jogo, não
      importa o tamanho da gravação (dentro do limite configurado no bucket, ver setup).
   3. `POST /api/transcriptions` (JSON pequeno, só metadados): cria a linha em `transcriptions`
      com `status = 'pending'` referenciando o `audio_path` já enviado, e dispara o
      processamento. Rejeita qualquer `audio_path` que não comece com o `workspace_id` da
      sessão atual, como defesa extra contra um client adulterado.
4. **Transcrição** — `POST /api/transcriptions/process` (chamada só via `pg_net`, autenticada
   com `CRON_SECRET`, nunca pelo browser): gera uma signed URL de 1h para o áudio, chama
   `transcribeAudio()` (`lib/transcriptions/whisper.ts`, Whisper via OpenAI SDK), salva
   `transcript_text`, e dispara a geração do prontuário.
5. **Geração do SOAP** — `POST /api/transcriptions/generate-record` (mesma autenticação):
   chama `generateSOAP()` (`lib/transcriptions/generate-soap.ts`, Claude Sonnet 4.5 via
   `@anthropic-ai/sdk`), que responde só um JSON (sem markdown) no formato `SOAPRecord` definido
   em `lib/transcriptions/types.ts`. O prompt do sistema instrui o Claude a nunca inventar
   informação — campos não mencionados na consulta viram `null`/array vazio e entram no array
   `alertas`, não em texto tipo "não informado".
6. **Revisão** — a página `/transcricoes/[id]` mostra um spinner com Supabase Realtime enquanto
   o status está em `pending`/`transcribing`/`transcribed`/`generating` (subscrição
   `postgres_changes` na própria linha — por isso o médico não precisa dar refresh manual). Ao
   chegar em `draft_ready`, mostra `AlertsPanel` (os itens de `alertas`) e `SOAPEditor` (abas
   S/O/A/P, com campos de texto e listas editáveis com adicionar/remover) já preenchido com
   `medical_record_draft`.
7. **Assinatura** — `POST /api/transcriptions/[id]/sign`: grava o estado atual do editor em
   `medical_record_final`, marca `status = 'signed'`, `signed_at`, `signed_by`, e — se a
   transcrição estiver vinculada a um `appointment_id` — marca essa consulta como `realizado`.
   Depois de assinado, o editor volta a aparecer, mas em modo `readOnly`.
8. **Retry** — se qualquer etapa falhar 3 vezes seguidas (`retry_count`), o status vira `error`
   com `error_message` preenchido. Como as rotas de processamento exigem `CRON_SECRET` (o browser
   não tem esse valor), o botão "Tentar novamente" da UI chama
   `POST /api/transcriptions/[id]/retry` — uma rota autenticada por sessão normal, que reseta o
   status para `pending` e rechama `trigger_transcription_process` pela mesma função RPC.

## Modelo de dados

Tabela única `transcriptions` (`supabase/transcriptions.sql`, ver também `schema.sql` para
instalações novas):

- `workspace_id` / `account_id` — igual ao resto do produto, RLS via `my_workspace_ids()`.
- `patient_id` (obrigatório) / `appointment_id` (opcional — grava mesmo sem consulta agendada).
- `recorded_by` / `signed_by` — referenciam `auth.users(id)` diretamente (não `profiles`), mesmo
  padrão de `appointments.doctor_id`. Nomes de médico são resolvidos com uma busca separada em
  `profiles` (não dá pra fazer embed via PostgREST — não há FK direta entre as duas tabelas,
  ambas referenciam `auth.users` de forma independente).
- `audio_path` — nunca exposto ao client; toda leitura do áudio passa por signed URL de curta
  duração gerada no backend (`process/route.ts`).
- `transcript_text`, `medical_record_draft`, `medical_record_final` — o rascunho gerado pelo
  Claude fica intocado em `medical_record_draft`; o que o médico efetivamente assina vai para
  `medical_record_final`, que pode divergir do rascunho se ele editou algo.
- `source` — `'system'` (gravado pelo painel) ou `'whatsapp'` (reservado para um fluxo futuro de
  envio de áudio pelo próprio WhatsApp; não implementado ainda).

## Segurança e permissões

- **RLS** idêntico ao padrão do resto do produto: `workspace_id = any(my_workspace_ids())`.
- **Feature flag**: toda rota de usuário (`upload-url`, a de criar a transcrição, `sign`,
  `retry`) chama `requireModule(session, 'transcriptions')` antes de fazer qualquer coisa. É o
  mesmo módulo gerenciável pelo admin em `/admin/accounts/[id]` — inativo por padrão, igual aos
  outros (`agenda`, `waitlist`, etc.).
- **Rotas de pipeline** (`process`, `generate-record`) e o cron de limpeza usam
  `createAdminClient()` (service role) porque não têm sessão de usuário — são chamadas só via
  `pg_net`/`pg_cron`, autenticadas por `Authorization: Bearer <CRON_SECRET>`, igual às rotas em
  `app/api/cron/*`. **Nunca** aceitam essa autenticação de sessão de usuário nem o contrário.
- **Storage**: bucket `recordings` é privado; as policies de `storage.objects` conferem que o
  primeiro segmento do path (`workspace_id`) está entre os workspaces do usuário. Retenção
  padrão de 90 dias (`RECORDING_RETENTION_DAYS`) — depois disso o áudio é apagado do Storage por
  um cron diário, mas a transcrição, o texto e o prontuário continuam no banco.

## Realtime

A página de detalhe assina updates da própria linha via
`supabase.channel('transcription-{id}').on('postgres_changes', { event: 'UPDATE', table:
'transcriptions', filter: 'id=eq.{id}' })`. Isso só funciona porque `transcriptions` foi
adicionada explicitamente à publicação `supabase_realtime` — RLS habilitado sozinho **não** é
suficiente para o Realtime entregar eventos (ver `alter publication supabase_realtime add table
public.transcriptions;` em `supabase/transcriptions.sql`).

## Onde fica cada coisa

```
lib/transcriptions/
  types.ts            tipos SOAPRecord e Transcription
  whisper.ts           transcribeAudio() — chama a API do Whisper
  generate-soap.ts      generateSOAP() — chama o Claude, parseia o JSON

app/api/transcriptions/
  upload-url/route.ts            emite a signed upload URL (sessão de usuário)
  route.ts                       cria a linha após o upload direto + dispara o pipeline (sessão de usuário)
  process/route.ts               Whisper (CRON_SECRET)
  generate-record/route.ts       Claude/SOAP (CRON_SECRET)
  [id]/sign/route.ts             assinatura (sessão de usuário)
  [id]/retry/route.ts            reprocessar após erro (sessão de usuário)
app/api/cron/cleanup-recordings/route.ts   limpeza de áudios antigos (CRON_SECRET)

components/transcriptions/
  RecordingButton.tsx            grava e sobe o áudio
  ConsentDialog.tsx               modal de consentimento
  TranscriptionStatusBadge.tsx    badge de status
  SOAPEditor.tsx                  editor S/O/A/P
  AlertsPanel.tsx                 avisos de campos vazios
  TranscriptionDetailClient.tsx   estado da página de detalhe + Realtime + assinar/retry
  TranscriptionsListClient.tsx    lista com filtros de status/período

app/(dashboard)/transcricoes/
  page.tsx           lista (RSC)
  [id]/page.tsx        detalhe (RSC + client component acima)
```

## Gerenciamento como admin

O módulo aparece na lista de módulos toggláveis em **`/admin/accounts/[id]`**, igual a `agenda`,
`waitlist`, `financial`, etc. (`components/admin/AccountDetailForm.tsx` →
`TOGGLEABLE_MODULES`). Ativar/desativar ali chama `PATCH /api/admin/accounts/[id]` e atualiza
`accounts.modules` — sem entrada nesse array, `requireModule` bloqueia todas as rotas do módulo
com 403 e o item some do menu lateral do médico (`Sidebar.tsx`), mesmo que ele tente acessar
`/transcricoes` direto pela URL (a página também confia em `session.userModules`, mas a
segurança real está nas rotas de API, não na UI).

## Sobre o tamanho da gravação

O upload é direto ao Storage (ver passo 3 do pipeline acima) — o áudio nunca atravessa uma rota
do Next.js, então o limite de corpo de funções serverless da Vercel (~4.5MB) não é um problema
mesmo para consultas longas. O teto real é o **File size limit do bucket `recordings`**
(configurado em 150MB no setup) — uma gravação além disso é rejeitada pelo próprio Storage no
passo 2 (`uploadToSignedUrl`), com erro mostrado na UI antes de criar qualquer registro.
