# MedScale

SaaS multi-tenant para clínicas médicas: agendamento por WhatsApp com IA, prontuário por transcrição
de consulta, agente financeiro por WhatsApp, e um painel interno para a MedScale operar seus clientes.
(Next.js 16 App Router, Supabase, Meta Cloud API, Claude, Whisper.)

> Procurando o passo a passo completo (criar contas, gerar chaves, configurar Google/Meta/Anthropic/
> OpenAI, testar ponta a ponta, publicar em produção)? Veja o **[SETUP.md](SETUP.md)**. Para o módulo
> de transcrição especificamente, veja **[TRANSCRICOES_COMO_FUNCIONA.md](TRANSCRICOES_COMO_FUNCIONA.md)**
> e **[TRANSCRICOES_SETUP.md](TRANSCRICOES_SETUP.md)**. O resumo abaixo é referência rápida para quem
> já passou pelo SETUP.md pelo menos uma vez.

---

## Funcionalidades

Cada item abaixo é um **módulo** — controlado por feature flag em `accounts.modules`, ativado por
account (ver [Papéis, módulos e visibilidade](#papéis-módulos-e-visibilidade) mais abaixo). `dashboard`,
`patients` e `settings` estão sempre ativos; o resto é opt-in.

### Agendamento

- **Minha agenda** (`/agenda`, módulo `agenda`) — calendário semanal/mensal (`react-big-calendar`).
  O **Google Calendar é a fonte de verdade** da disponibilidade real: `availability_rules` +
  `availability_exceptions` definem o expediente recorrente, cruzado ao vivo com os eventos do
  Google (inclusive compromissos pessoais fora do MedScale). Consultas criadas no CRM ou pelo bot
  são sincronizadas com o Google (best-effort) e guardam `gcal_event_id`; um cron de reconciliação
  (`reconcile-calendar`, de hora em hora) cobre o caso de alguém mexer direto no Google Calendar.
- **Bot WhatsApp / Conversas** (`/bot`, módulo `conversations`) — inbox das conversas conduzidas
  pela IA (nome fixo "Maria"), com histórico de mensagens, status (`open`/`resolved`/`handoff`) e
  botão de pausar o bot pra assumir manualmente. O agente (`lib/llm/agent.ts`, Claude Sonnet 4.5)
  conversa e agenda **24/7** — não tem "horário do bot" — usando os horários livres reais
  calculados a partir da Agenda. Confirma consulta emitindo um marcador interno
  (`AGENDAMENTO_CONFIRMADO: ...`) que o backend intercepta, revalida contra a disponibilidade
  (evita corrida com outro agendamento simultâneo) e grava.
- **Transferência para humano (handoff)** — tem horário próprio (`handoff_hours`, configurado em
  **Configurações → Bot WhatsApp**), independente do expediente da agenda. Disparado quando o
  Claude decide, quando o paciente pede explicitamente, ou após 8 trocas de mensagem. Fora do
  horário de handoff, o bot não finge transferir — avisa que vai responder e continua sozinho.
- **Meus locais** (`/locais`, módulo `locations`) — unidades/workspaces do account (múltiplas
  clínicas sob a mesma conta). Owner e admin gerenciam.
- **Meu expediente** (`/expediente`, módulo `schedule`) — regras de horário recorrente e bloqueios
  pontuais, usados pelo cálculo de disponibilidade acima.
- **Lista de espera** (`/lista-espera`, módulo `waitlist`) — pacientes aguardando vaga; um cron
  (`waitlist-notify`) avisa por WhatsApp (template aprovado na Meta) quando abre horário nos
  próximos dias, com cooldown pra não notificar em duplicidade.

### Pacientes e prontuário

- **Meus pacientes** (`/pacientes`, sempre ativo) — cadastro compartilhado entre todas as
  workspaces do account, com histórico de consultas por paciente.
- **Transcrição de consultas** (`/transcricoes`, módulo `transcriptions`) — grava o áudio da
  consulta (upload direto ao Supabase Storage via signed URL, sem passar pelo corpo de uma rota
  do Next.js), transcreve com Whisper (OpenAI), e gera um prontuário estruturado em SOAP
  (Subjetivo/Objetivo/Avaliação/Plano) com Claude — revisável e editável antes de assinar. Três
  formas de iniciar uma gravação: pela página do paciente, por uma consulta na Agenda, ou por um
  botão "Nova transcrição" na própria aba. Detalhes completos de arquitetura e setup em
  [TRANSCRICOES_COMO_FUNCIONA.md](TRANSCRICOES_COMO_FUNCIONA.md).

### Financeiro (exclusivo do owner)

- **Receita** (`/receita`, módulo `financial`) — lançamentos manuais de entradas confirmadas e
  previstas, vinculáveis a uma consulta.
- **Financeiro** (`/finance`, módulo `finance`) — agente de lançamentos PF/PJ por linguagem
  natural via um número de WhatsApp dedicado (`FINANCE_PHONE_NUMBER_ID`, separado do número da
  clínica): o owner manda algo como "gastei 200 no almoço" e o agente (`lib/finance/agent.ts`)
  interpreta (comando com barra via `parser.ts`, ou linguagem natural via Claude em
  `interpret.ts`), categoriza (`categorize.ts`) e responde por WhatsApp (`respond.ts`) — sem
  precisar abrir o painel. O owner é identificado pelo telefone (`profiles.phone`, normalizado
  ignorando o nono dígito).
- **Ambos são visíveis só pro owner** — nem admin nem member veem, mesmo com o módulo ativo na
  account ou liberado via `module_overrides` (dado financeiro é tratado como pessoal — ver RLS
  `is_account_owner()` em `revenue_entries`/`finance_entries`).

### Crescimento

- **Atribuição / Tráfego pago** (`/trafego`, módulo `campaigns`) — campanhas por canal
  (Instagram/Google/Facebook/TikTok), gasto, impressões, cliques e leads — custo por lead calculado
  na UI.
- **Meu painel** (`/dashboard`, sempre ativo) — KPIs do mês (consultas totais, % agendadas pelo
  bot, receita confirmada vs. prevista, taxa de no-show), agenda do dia, gráfico de receita,
  tabela de tráfego. Com mais de uma workspace, alterna entre visão por unidade e **visão
  consolidada** (soma tudo).

### Conta e equipe

- **Configurações** (`/configuracoes`, sempre ativo) — perfil pessoal, wizard de conexão do
  WhatsApp (Meta Graph API, com validação em tempo real), conexão do Google Agenda, atalhos para
  Expediente e Equipe.
- **Equipe** (`/configuracoes/equipe`, só owner) — convida gente por e-mail (papel Admin ou
  Member — não dá pra convidar como Owner por aqui, evita transferência de titularidade sem
  querer), troca papel, remove membro, e controla **por pessoa** quais módulos opcionais ela
  enxerga (`module_overrides`) além do padrão da account. Ver seção abaixo.

### Painel interno da MedScale (`/admin`)

Só para `medscale_admins` (staff da MedScale, não os clientes) — gerencia todas as accounts:
plano, módulos ativos, ativar/desativar, criar/gerenciar workspaces, convidar/atribuir membros
(inclusive como Owner, algo que o self-service de `/configuracoes/equipe` não permite), notas de
atividade por conta, e um board de tarefas (por conta ou internas, sem cliente atrelado) em
`/admin/tasks`.

---

## Papéis, módulos e visibilidade

Hierarquia: `accounts` → `workspaces` (unidades) → `memberships` (pessoa + papel numa account).

- **owner** — dono da conta. Único papel com acesso a Financeiro e Receita. É quem convida gente
  em `/configuracoes/equipe` e controla o que cada membro vê.
- **admin** — mesmo acesso operacional do owner (agenda, pacientes, bot, transcrições, locais,
  configuração), exceto o financeiro pessoal do owner.
- **member** — o mais restrito; só enxerga os módulos que a account tem ativos, filtrados ainda
  por `module_overrides` se o owner tiver configurado algo mais restrito pra essa pessoa
  especificamente (ex: só Agenda + Pacientes, mesmo com Lista de espera/Transcrições ativos na
  account).

`module_overrides` é uma lista de módulos por `membership`, `null` = herda todos os módulos ativos
da account. Financeiro/Receita **não** são controláveis por `module_overrides` — é sempre regra de
papel (`session.role === 'owner'`), reforçada tanto na UI (`OWNER_ONLY_MODULES` em
`components/layout/NavLinks.tsx`) quanto na API e na RLS de `finance_entries`/`revenue_entries`.

---

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
   - `ANTHROPIC_API_KEY`: console da Anthropic — usado pelo bot de agendamento, pelo agente financeiro e pela geração de prontuário SOAP.
   - `OPENAI_API_KEY`: console da OpenAI — usado só pela transcrição de áudio (Whisper). Ver `TRANSCRICOES_SETUP.md`.
   - `CRON_SECRET`: qualquer string aleatória — protege `/api/cron/{reminders,noshow,waitlist,reconcile-calendar,cleanup-recordings}` e `/api/transcriptions/{process,generate-record}`. É o Supabase pg_cron (ver `supabase/cron.sql`) que envia esse valor no header `Authorization`; o mesmo valor precisa estar salvo no Supabase Vault como o secret `cron_secret` (ver seção 1.1 de `supabase/cron.sql` — `ALTER DATABASE ... SET` não funciona mais em projetos Supabase, o Vault substituiu isso).
   - `FINANCE_PHONE_NUMBER_ID` / `FINANCE_META_TOKEN` / `FINANCE_META_APP_SECRET` (opcional): número de WhatsApp dedicado ao agente financeiro — só necessário se o módulo `finance` for usado. Sem `FINANCE_META_APP_SECRET`, cai em `META_APP_SECRET`.
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
   - Cada médico conecta a própria agenda em **Configurações → Google Agenda**, e cadastra os horários de atendimento em **Meu expediente**. Sem isso, `getFreeSlotsForBot` não retorna nenhum horário e o bot avisa o paciente que não há disponibilidade.

7. **Rodar em desenvolvimento**

   ```bash
   npm run dev
   ```

   Testando local o disparo de crons/transcrição (que dependem da Supabase alcançar seu servidor
   de volta via `pg_net`)? `localhost` não é alcançável de fora — use um túnel (`ngrok http 3000`)
   e aponte `NEXT_PUBLIC_APP_URL` pra URL pública temporária. Detalhes em `TRANSCRICOES_SETUP.md`.

## Notas de arquitetura

- **RLS ativo em todas as tabelas.** As rotas de API usam o client autenticado (`lib/supabase/server.ts#createClient`) para respeitar RLS; o client admin (`createAdminClient`) só é usado pelo webhook do WhatsApp, pelos crons e por lookups cross-user sem policy própria (ex: resolver e-mail/nome de outro membro) — nunca para servir dados de usuário comum sem antes validar a sessão.
- **Webhook da Meta** responde em menos de 1s e processa a mensagem depois, via `after()` do Next.js — a Meta exige resposta em até 20s. Um único endpoint (`/api/whatsapp/webhook`) atende tanto o bot de agendamento quanto o agente financeiro, roteando pelo `phone_number_id` recebido (`FINANCE_PHONE_NUMBER_ID` vai para `processFinancialMessage`, qualquer outro número mapeado numa `workspace` vai para `processIncomingMessage`).
- **Confirmação de agendamento pelo bot**: o prompt instrui o Claude a emitir uma linha `AGENDAMENTO_CONFIRMADO: AAAA-MM-DDTHH:mm-03:00` (offset de São Paulo explícito) quando o paciente confirma data/hora; essa linha é removida antes de enviar a resposta ao paciente e usada para criar o registro em `appointments` — o horário é revalidado contra `isSlotAvailable` antes de gravar, para o caso de o slot ter sido ocupado entre o cálculo da lista de horários e a confirmação do paciente.
- **Crons rodam via Supabase pg_cron** (`supabase/cron.sql`, de hora em hora cada — o plano Hobby da Vercel não permite frequência maior que diária): `appointment-reminders` envia o template `appointment_reminder` (precisa estar aprovado na Meta) 24h antes da consulta; `mark-noshow` marca como `no_show` consultas passadas sem confirmação; `waitlist-notify` avisa (template `waitlist_slot_available`, com cooldown via `waitlist.notified_at`) quem está na lista de espera quando abre vaga; `reconcile-calendar` sincroniza `appointments` com o Google Calendar como rede de segurança; `cleanup-old-recordings` apaga áudio de transcrições assinadas há mais de `RECORDING_RETENTION_DAYS` dias. Todos batem em `/api/cron/*`, validado via `CRON_SECRET` no header `Authorization` lido do Supabase Vault (`public.cron_secret()`).
- **Google Agenda é a fonte de verdade da disponibilidade real**: `availability_rules`/`availability_exceptions` definem o expediente recorrente do médico, e `lib/google/availability.ts` cruza isso com os eventos reais do Google Calendar (inclusive compromissos pessoais fora do MedScale) para calcular os horários livres — tanto para o bot quanto para `/api/agenda/slots`. Todo o cálculo usa `TZDate` (`@date-fns/tz`) fixado em `America/Sao_Paulo`, porque o servidor (Vercel) roda em UTC e um `Date` comum interpretaria "08:00" no fuso do processo, não no fuso do consultório.
- **Agendamentos criados no CRM ou pelo bot são sincronizados com o Google Calendar** (best-effort — se o Google falhar, o agendamento continua válido no Supabase) e guardam o `gcal_event_id` correspondente em `appointments`. `lib/google/reconcile.ts` faz o caminho inverso — lê os eventos do Google marcados como MedScale (`extendedProperties.private.medscale`) e reconcilia de volta, sem nunca sobrescrever um status terminal (`realizado`/`no_show`/`cancelado`) que só o MedScale controla.
- O callback OAuth do Google (`/api/google/callback`) valida que o `state` recebido bate com o usuário Supabase autenticado no momento — o `state` sozinho (só o `doctorId`) não é suficiente, pois pode ser reescrito na URL por qualquer pessoa.
- **`bot_config` personaliza o system prompt por médico** (`lib/bot/prompt-builder.ts`): nome do bot, especialidade, procedimentos, convênios, preço mínimo e mensagens automáticas. Sem uma `bot_config` com `is_active = true`, `processIncomingMessage` ignora a mensagem — o médico precisa concluir o wizard em **Configurações → Bot WhatsApp** primeiro.
- **O bot conversa e agenda 24/7** — não existe "horário de atendimento do bot". `business_hours` é só o texto que o bot mostra ao paciente sobre o horário presencial; os horários realmente oferecidos vêm de `availability_rules` + Google Calendar (podem estar vazios de madrugada, mas o bot continua respondendo e nunca se recusa a conversar).
- **Handoff para atendimento humano tem horário próprio** (`lib/bot/handoff.ts`), separado do bot: disparado quando o Claude emite `[HANDOFF]` no prompt, quando o paciente pede explicitamente por um humano, ou após 8 trocas de mensagem. `isHandoffAvailableNow` consulta `handoff_hours` (cadastrado em **Configurações → Bot WhatsApp**, formato idêntico a `availability_rules` mas independente dela) para decidir:
  - **Dentro do horário**: `executeHandoff` envia `handoff_message` + o número de `handoff_number`, marca a conversa como `handoff` e registra em `handoff_logs`.
  - **Fora do horário** (ou sem `handoff_hours` cadastrado — nesse caso o handoff fica disponível 24/7 por padrão, como `availability_rules`): o bot **não** finge transferir; envia `out_of_hours_message`, registra em `handoff_logs` com `trigger_reason = 'out_of_hours'` para a equipe ver depois, e continua a conversa sozinho — a conversa permanece `open`, não `handoff`.
- **Agente financeiro identifica o owner pelo telefone** (`lib/finance/agent.ts`): como `memberships` e `profiles` não têm FK direta entre si (ambas referenciam `auth.users` de forma independente), o match é em duas etapas — owners ativos da conta, depois `profiles.phone` comparado por uma chave canônica que ignora o nono dígito do celular. Se dois owners colidirem nessa chave, o agente recusa a registrar (ambíguo demais pra arriscar lançar na account errada).
- **Transcrição de consulta é upload direto ao Storage, não proxied**: o áudio vai do browser direto pro Supabase Storage via signed URL (`createSignedUploadUrl`/`uploadToSignedUrl`), nunca pelo corpo de uma rota do Next.js — evita o limite de corpo de funções serverless da Vercel (~4.5MB) mesmo em gravações longas. O pipeline (Whisper → Claude/SOAP) roda em rotas de API encadeadas via `pg_net` (não há worker separado), autenticadas por `CRON_SECRET`. Detalhes completos em `TRANSCRICOES_COMO_FUNCIONA.md`.
- **`GoogleConnectButton`/onboarding do bot nunca expõem o token ao client** — `meta_token` e `access_token`/`refresh_token` do Google só trafegam server-side, criptografados em repouso com a mesma `TOKEN_ENCRYPTION_KEY`.
