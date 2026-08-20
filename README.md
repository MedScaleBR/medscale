# MedScale

CRM para clínicas médicas com agente de agendamento via WhatsApp (Next.js 16 App Router, Supabase, Meta Cloud API, Claude).

> Procurando o passo a passo completo (criar contas, gerar chaves, configurar Google/Meta/Anthropic,
> testar ponta a ponta, publicar em produção)? Veja o **[SETUP.md](SETUP.md)**. O resumo abaixo é
> uma referência rápida para quem já passou por lá pelo menos uma vez.

## Setup

1. **Instalar dependências**

   ```bash
   npm install
   ```

2. **Criar o projeto no [Supabase](https://supabase.com)** e rodar [`supabase/schema.sql`](supabase/schema.sql) inteiro no SQL Editor, na ordem em que aparece no arquivo.

3. **Configurar variáveis de ambiente** — copie o exemplo e preencha com valores reais:

   ```bash
   cp .env.local.example .env.local
   ```

   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`: em Supabase → Project Settings → API.
   - `TOKEN_ENCRYPTION_KEY`: gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Usado para criptografar o token da Meta antes de salvar em `profiles.meta_token`.
   - `META_APP_SECRET` / `META_VERIFY_TOKEN`: painel do app na Meta for Developers (produto WhatsApp).
   - `ANTHROPIC_API_KEY`: console da Anthropic.
   - `CRON_SECRET`: qualquer string aleatória — protege `/api/cron/{reminders,noshow,waitlist}`. É o Supabase pg_cron (ver `supabase/cron.sql`) que envia esse valor no header `Authorization`; configure o mesmo valor em `app.cron_secret` no banco.
   - Sentry/PostHog são opcionais — deixe em branco para desativar (a inicialização é condicional).

4. **Habilitar login com Google** em Supabase → Authentication → Providers → Google, e configurar a URL de callback (`<seu-domínio>/auth/callback`) tanto no Google Cloud Console quanto no Supabase.

5. **Configurar o webhook do WhatsApp** — dois modos possíveis, ambos apontando para `<seu-domínio>/api/whatsapp/webhook`:
   - **App único da MedScale** (mais simples): configure o webhook no App Meta da própria MedScale usando `META_VERIFY_TOKEN`. Todos os médicos compartilham o mesmo App.
   - **Cada médico traz seu próprio App Meta**: o médico segue o wizard em **Configurações → Bot WhatsApp**, que gera um `webhook_verify_token` único por médico (guardado em `bot_config`) — o handler `GET` do webhook aceita ambos os tokens.
   - Em qualquer um dos dois modos, o médico conecta o número e valida o token permanente pelo wizard em **Configurações → Bot WhatsApp** (não mais editável em Configurações → Perfil — a validação contra a Meta Graph API só acontece por ali).

6. **Configurar a integração com o Google Agenda** (opcional, mas necessária para o bot verificar disponibilidade real):
   - No [Google Cloud Console](https://console.cloud.google.com), crie um projeto, ative a **Google Calendar API** (APIs & Services → Library) e crie credenciais **OAuth 2.0 → Web application**.
   - Authorized redirect URIs: `http://localhost:3000/api/google/callback` (dev) e `https://<seu-domínio>/api/google/callback` (prod).
   - Tela de consentimento OAuth: User Type **External**, escopos `calendar`, `calendar.events` e `userinfo.email`. Para produção com mais de 100 usuários, inicie a verificação do app com antecedência (pode levar semanas).
   - Preencha `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REDIRECT_URI` no `.env.local` (reutiliza o mesmo `TOKEN_ENCRYPTION_KEY` do WhatsApp para criptografar os tokens).
   - Cada médico conecta a própria agenda em **Configurações → Google Agenda**, e cadastra os horários de atendimento em **Configurações → Disponibilidade**. Sem isso, `getFreeSlotsForBot` não retorna nenhum horário e o bot avisa o paciente que não há disponibilidade.

7. **Rodar em desenvolvimento**

   ```bash
   npm run dev
   ```

## Notas de arquitetura

- **RLS ativo em todas as tabelas** — cada médico só enxerga suas próprias linhas via `doctor_id = auth.uid()`. As rotas de API usam o client autenticado (`lib/supabase/server.ts#createClient`) para respeitar RLS; o client admin (`createAdminClient`) só é usado pelo webhook do WhatsApp e pelos crons, que não têm sessão de usuário.
- **Webhook da Meta** responde em menos de 1s e processa a mensagem com o LLM depois, via `after()` do Next.js — a Meta exige resposta em até 20s.
- **Confirmação de agendamento pelo bot**: o prompt instrui o Claude a emitir uma linha `AGENDAMENTO_CONFIRMADO: AAAA-MM-DDTHH:mm-03:00` (offset de São Paulo explícito) quando o paciente confirma data/hora; essa linha é removida antes de enviar a resposta ao paciente e usada para criar o registro em `appointments` — o horário é revalidado contra `isSlotAvailable` antes de gravar, para o caso de o slot ter sido ocupado entre o cálculo da lista de horários e a confirmação do paciente.
- **Crons rodam via Supabase pg_cron** (`supabase/cron.sql`, uma vez por hora cada — o plano Hobby da Vercel não permite frequência maior que diária): `appointment-reminders` envia o template `appointment_reminder` (precisa estar aprovado na Meta) 24h antes da consulta; `mark-noshow` marca como `no_show` consultas passadas sem confirmação; `waitlist-notify` avisa (template `waitlist_slot_available`, com cooldown via `waitlist.notified_at`) quem está na lista de espera quando abre vaga nos próximos 3 dias. Todos batem em `/api/cron/*`, validado via `CRON_SECRET` no header `Authorization`.
- **Google Agenda é a fonte de verdade da disponibilidade real**: `availability_rules`/`availability_exceptions` definem o expediente recorrente do médico, e `lib/google/availability.ts` cruza isso com os eventos reais do Google Calendar (inclusive compromissos pessoais fora do MedScale) para calcular os horários livres — tanto para o bot quanto para `/api/agenda/slots`. Todo o cálculo usa `TZDate` (`@date-fns/tz`) fixado em `America/Sao_Paulo`, porque o servidor (Vercel) roda em UTC e um `Date` comum interpretaria "08:00" no fuso do processo, não no fuso do consultório.
- **Agendamentos criados no CRM ou pelo bot são sincronizados com o Google Calendar** (best-effort — se o Google falhar, o agendamento continua válido no Supabase) e guardam o `gcal_event_id` correspondente em `appointments`, usado depois para cancelar/atualizar o evento junto com o agendamento.
- O callback OAuth do Google (`/api/google/callback`) valida que o `state` recebido bate com o usuário Supabase autenticado no momento — o `state` sozinho (só o `doctorId`) não é suficiente, pois pode ser reescrito na URL por qualquer pessoa.
- **`bot_config` personaliza o system prompt por médico** (`lib/bot/prompt-builder.ts`): nome do bot, especialidade, procedimentos, convênios, preço mínimo e mensagens automáticas. Sem uma `bot_config` com `is_active = true`, `processIncomingMessage` ignora a mensagem — o médico precisa concluir o wizard em **Configurações → Bot WhatsApp** primeiro.
- **O bot conversa e agenda 24/7** — não existe mais um "horário de atendimento do bot". `business_hours` é só o texto que o bot mostra ao paciente sobre o horário presencial; os horários realmente oferecidos vêm de `availability_rules` + Google Calendar (podem estar vazios de madrugada, mas o bot continua respondendo e nunca se recusa a conversar).
- **Handoff para atendimento humano tem horário próprio** (`lib/bot/handoff.ts`), separado do bot: disparado quando o Claude emite `[HANDOFF]` no prompt, quando o paciente pede explicitamente por um humano, ou após 8 trocas de mensagem. `isHandoffAvailableNow` consulta `handoff_hours` (cadastrado em **Configurações → Bot WhatsApp**, formato idêntico a `availability_rules` mas independente dela) para decidir:
  - **Dentro do horário**: `executeHandoff` envia `handoff_message` + o número de `handoff_number`, marca a conversa como `handoff` e registra em `handoff_logs`.
  - **Fora do horário** (ou sem `handoff_hours` cadastrado — nesse caso o handoff fica disponível 24/7 por padrão, como `availability_rules`): o bot **não** finge transferir; envia `out_of_hours_message`, registra em `handoff_logs` com `trigger_reason = 'out_of_hours'` para a equipe ver depois, e continua a conversa sozinho — a conversa permanece `open`, não `handoff`.
- **`GoogleConnectButton`/onboarding do bot nunca expõem o token ao client** — `meta_token` e `access_token`/`refresh_token` do Google só trafegam server-side, criptografados em repouso com a mesma `TOKEN_ENCRYPTION_KEY`.
