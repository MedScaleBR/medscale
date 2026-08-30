-- MedScale — schema completo (modelo multi-tenant: accounts → workspaces → memberships)
-- Execute no Supabase SQL Editor, na ordem exata abaixo.
-- Este arquivo substitui integralmente qualquer versão anterior — não é incremental.
-- A seção 0 abaixo apaga TUDO que já existir (tabelas, policies, triggers,
-- funções) antes de recriar do zero — não rode isto num projeto com dados
-- que você queira manter.

-- ============================================================
-- 0. RESET — apaga tudo que uma execução anterior deste script possa ter
--    criado, para este arquivo poder ser reexecutado do zero a qualquer
--    momento sem erros de "already exists".
-- ============================================================

-- Trigger em auth.users não é apagado pelo drop table das tabelas public
-- abaixo (auth.users não é uma das tabelas que este script possui).
drop trigger if exists on_auth_user_created on auth.users;

-- `cascade` aqui também remove automaticamente todas as policies, índices e
-- triggers de cada tabela — não é preciso dropar isso separadamente.
drop table if exists
  public.finance_sessions,
  public.finance_entries,
  public.transcriptions,
  public.push_subscriptions,
  public.handoff_hours,
  public.handoff_logs,
  public.rate_limit_log,
  public.webhook_logs,
  public.google_tokens,
  public.bot_config,
  public.ad_campaigns,
  public.revenue_settings,
  public.revenue_entries,
  public.procedure_catalog,
  public.waitlist,
  public.availability_exceptions,
  public.availability_rules,
  public.messages,
  public.conversations,
  public.appointments,
  public.patients,
  public.profiles,
  public.account_tasks,
  public.account_notes,
  public.medscale_admins,
  public.invites,
  public.memberships,
  public.workspaces,
  public.accounts
cascade;

drop type if exists public.transcription_status cascade;

drop function if exists public.is_medscale_admin() cascade;
drop function if exists public.is_account_owner(uuid) cascade;
drop function if exists public.is_account_admin(uuid) cascade;
drop function if exists public.my_workspace_ids() cascade;
drop function if exists public.my_account_ids() cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.handle_updated_at() cascade;
drop function if exists public.trigger_transcription_process(uuid, text) cascade;
drop function if exists public.trigger_transcription_generate(uuid, text) cascade;

-- ============================================================
-- 1. EXTENSÕES
-- ============================================================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto"; -- gen_random_bytes() para tokens de convite

-- ============================================================
-- 2. ACCOUNTS (contratos / clientes da MedScale)
-- ============================================================
create table public.accounts (
  id              uuid default uuid_generate_v4() primary key,
  name            text not null,                    -- "Grupo Médico São Lucas"
  slug            text not null unique,              -- "grupo-medico-sao-lucas"
  plan            text not null default 'essencial'
                  check (plan in ('essencial','avancado','premium')),
  is_active       boolean not null default true,
  -- Módulos ativos — array de slugs. dashboard, patients, settings são
  -- sempre tratados como ativos pelo app, independente deste array.
  modules         text[] not null default '{dashboard,agenda,patients,settings}',
  max_workspaces  int not null default 1,
  max_members     int not null default 3,
  billing_email   text,
  billing_ref     text,                              -- ID no sistema de cobrança (ex: Stripe)
  created_by      uuid references auth.users(id),     -- admin MedScale que criou
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ============================================================
-- 3. WORKSPACES (clínicas/unidades dentro de um account)
-- ============================================================
create table public.workspaces (
  id              uuid default uuid_generate_v4() primary key,
  account_id      uuid references public.accounts(id) on delete cascade not null,
  name            text not null,                     -- "Unidade Moema"
  slug            text not null,
  address         text,
  city            text,
  state           text,
  zip_code        text,
  -- WhatsApp desta workspace
  whatsapp_number text,
  phone_number_id text,
  meta_token      text,                               -- criptografado (lib/crypto.ts)
  -- App Secret do App Meta próprio da workspace (fluxo "número próprio" — só
  -- preenchido quando number_source = 'own' em bot_config). Necessário porque
  -- a assinatura HMAC (x-hub-signature-256) de cada mensagem recebida é
  -- calculada pela Meta com o App Secret do App que possui o número — o App
  -- único da MedScale (META_APP_SECRET) só assina para números do modelo
  -- compartilhado. Ver validateMetaSignature em app/api/whatsapp/webhook/route.ts.
  meta_app_secret text,                               -- criptografado (lib/crypto.ts)
  is_active       boolean not null default true,
  is_default      boolean not null default false,     -- workspace padrão do account
  display_order   int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(account_id, slug)
);

-- ============================================================
-- 4. MEMBERSHIPS (usuário ↔ account, com papel)
-- ============================================================
create table public.memberships (
  id                uuid default uuid_generate_v4() primary key,
  account_id        uuid references public.accounts(id) on delete cascade not null,
  user_id           uuid references auth.users(id)    on delete cascade not null,
  role              text not null default 'member'
                    check (role in ('owner','admin','member')),
  -- Módulos que este usuário específico pode ver — null = herda do account
  module_overrides  text[],
  -- Workspaces que este usuário pode acessar — null = acesso a todos
  workspace_ids     uuid[],
  invited_by        uuid references auth.users(id),
  invited_at        timestamptz not null default now(),
  accepted_at       timestamptz,
  status            text not null default 'active'
                    check (status in ('pending','active','suspended')),
  -- Opt-in por membro: quer receber notificação push quando um handoff real
  -- acontecer numa workspace da account (ver push_subscriptions + lib/push).
  handoff_push_enabled boolean not null default false,
  unique(account_id, user_id)
);

-- ============================================================
-- 5. CONVITES PENDENTES (por e-mail, antes do cadastro/aceite)
-- ============================================================
create table public.invites (
  id           uuid default uuid_generate_v4() primary key,
  account_id   uuid references public.accounts(id) on delete cascade not null,
  email        text not null,
  role         text not null default 'member'
               check (role in ('owner','admin','member')),
  token        text not null unique default encode(gen_random_bytes(32), 'hex'),
  invited_by   uuid references auth.users(id),
  expires_at   timestamptz not null default (now() + interval '7 days'),
  accepted_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- 6. MEDSCALE_ADMINS (admins internos da MedScale — painel /admin)
-- ============================================================
create table public.medscale_admins (
  user_id    uuid references auth.users(id) on delete cascade primary key,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 7. PROFILES (dados pessoais do usuário — não mais dados de clínica)
-- ============================================================
create table public.profiles (
  id                uuid references auth.users(id) on delete cascade primary key,
  full_name         text not null,
  email             text,
  avatar_url        text,
  phone             text,
  crm               text,                             -- registro médico pessoal
  specialty         text,
  last_workspace_id uuid references public.workspaces(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ============================================================
-- 7A. CRM ADMIN (notas e tarefas de acompanhamento por account, uso
--     exclusivo dos admins internos da MedScale — nunca exposto a membros
--     de account)
-- ============================================================

-- Timeline de interações (ligação, e-mail, reunião, nota livre) registrada
-- por um admin sobre uma account. Append-only por design — só create/delete,
-- sem edição, pra manter a timeline como um log confiável.
create table public.account_notes (
  id          uuid default uuid_generate_v4() primary key,
  account_id  uuid references public.accounts(id) on delete cascade not null,
  type        text not null default 'note'
              check (type in ('note','call','email','meeting')),
  body        text not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Tarefas/lembretes de follow-up (ex: "renovação em 30 dias"). account_id é
-- opcional — uma tarefa pode não estar atrelada a nenhum cliente (ex: tarefa
-- interna do time), por isso não tem "on delete cascade" implícito em nada
-- além do cliente em si sendo removido.
create table public.account_tasks (
  id            uuid default uuid_generate_v4() primary key,
  account_id    uuid references public.accounts(id) on delete cascade,
  title         text not null,
  description   text,
  due_date      date,
  assigned_to   uuid references auth.users(id) on delete set null,
  status        text not null default 'pending' check (status in ('pending','done')),
  created_by    uuid references auth.users(id) on delete set null,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============================================================
-- 7B. AGENTE FINANCEIRO (lançamentos PF/PJ via WhatsApp, número dedicado
--     da MedScale — ver FINANCE_PHONE_NUMBER_ID/FINANCE_META_TOKEN)
-- ============================================================

-- Lançamento individual, criado pelo owner via comando no WhatsApp
-- (/pf, /pj). Por account, não por workspace: um owner com múltiplas
-- clínicas tem uma única visão financeira consolidada.
create table public.finance_entries (
  id                uuid default uuid_generate_v4() primary key,
  account_id        uuid references public.accounts(id) on delete cascade not null,
  recorded_by_phone text not null,
  type              text not null check (type in ('pf','pj')),
  description       text,
  amount            numeric(12, 2) not null check (amount > 0),
  category          text,
  raw_message       text not null,
  entry_date        date not null default current_date,
  created_at        timestamptz not null default now()
);

-- Contexto de conversa por telefone, para manter estado entre mensagens
-- (ex: confirmação pendente). Lida/gravada só via createAdminClient().
create table public.finance_sessions (
  phone             text primary key,
  account_id        uuid references public.accounts(id) on delete cascade not null,
  pending_entry     jsonb,
  last_message_at   timestamptz not null default now()
);

-- ============================================================
-- 8. TABELAS DE DADOS OPERACIONAIS
-- ============================================================

-- Pacientes — compartilhados entre as workspaces do mesmo account
create table public.patients (
  id          uuid default uuid_generate_v4() primary key,
  account_id  uuid references public.accounts(id) on delete cascade not null,
  full_name   text not null,
  phone       text not null,               -- formato E.164: +5511999999999
  email       text,
  birth_date  date,
  notes       text,
  tags        text[] default '{}',
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  unique(account_id, phone)
);

-- Catálogo de procedimentos (por workspace) — nome + preço estruturados que
-- alimentam a agenda, o bot e o ciclo de receita. bot_config.procedures (text[])
-- continua existindo em paralelo para o prompt da Maria.
create table public.procedure_catalog (
  id            uuid default uuid_generate_v4() primary key,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null,
  code          text,                 -- código interno da clínica (opcional)
  default_price numeric(10,2) not null,
  duration_min  int,                  -- duração em minutos (alimenta o agendador)
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Consultas / agendamentos
create table public.appointments (
  id              uuid default uuid_generate_v4() primary key,
  workspace_id    uuid references public.workspaces(id) on delete cascade not null,
  account_id      uuid references public.accounts(id)   on delete cascade not null,
  doctor_id       uuid references auth.users(id)        on delete set null,
  patient_id      uuid references public.patients(id)   on delete set null,
  patient_name    text not null,
  patient_phone   text not null,
  scheduled_at    timestamptz not null,
  duration_min    int not null default 30,
  type            text not null default 'consulta'
                  check (type in ('consulta','retorno','avaliacao','procedimento','outro')),
  source          text not null default 'manual'
                  check (source in ('bot','manual','importado')),
  status          text not null default 'agendado'
                  check (status in ('agendado','confirmado','realizado','cancelado','no_show')),
  notes           text,
  -- procedure_id + snapshots de nome/preço no momento do agendamento. O
  -- snapshot é imutável: mudar o preço do procedimento depois não altera
  -- agendamentos passados (ver revenue_entries.amount).
  procedure_id    uuid references public.procedure_catalog(id) on delete set null,
  procedure_name  text,
  price           numeric(10,2),
  -- Convênio usado na consulta — snapshot do nome (a lista vive em
  -- bot_config.insurance_plans). NULL = particular. Consulta por convênio não
  -- gera revenue_entry; entra nas telas de receita só como contagem.
  health_plan     text,
  gcal_event_id   text,
  reminder_sent   boolean default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Google Calendar é a fonte de verdade da /agenda (ver lib/google/reconcile.ts)
-- — este índice garante que o upsert de reconciliação não duplique a mesma
-- consulta quando duas leituras concorrentes (duas abas, ou o cron em cima de
-- um load manual) importam o mesmo evento do Google ao mesmo tempo.
create unique index appointments_gcal_event_id_key
  on public.appointments (gcal_event_id)
  where gcal_event_id is not null;

-- Transcrição de consultas — áudio gravado, transcrito pelo Whisper, e
-- prontuário SOAP gerado pelo Claude (ver lib/transcriptions/*). Módulo
-- "transcriptions" em accounts.modules, inativo por padrão.
create type public.transcription_status as enum (
  'pending',
  'transcribing',
  'transcribed',
  'generating',
  'draft_ready',
  'signed',
  'error'
);

create table public.transcriptions (
  id                    uuid default uuid_generate_v4() primary key,
  workspace_id          uuid references public.workspaces(id) on delete cascade not null,
  account_id            uuid references public.accounts(id)   on delete cascade not null,
  appointment_id        uuid references public.appointments(id) on delete set null,
  patient_id            uuid references public.patients(id)   on delete restrict not null,
  recorded_by           uuid references auth.users(id)        on delete restrict not null,
  audio_path            text not null,
  duration_seconds      int,
  transcript_text       text,
  medical_record_draft  jsonb,
  medical_record_final  jsonb,
  status                public.transcription_status not null default 'pending',
  consent_confirmed     boolean not null default false,
  source                text not null default 'system' check (source in ('system', 'whatsapp')),
  error_message         text,
  retry_count           int not null default 0,
  signed_at             timestamptz,
  signed_by             uuid references auth.users(id) on delete set null,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Conversas do bot WhatsApp
create table public.conversations (
  id              uuid default uuid_generate_v4() primary key,
  workspace_id    uuid references public.workspaces(id) on delete cascade not null,
  account_id      uuid references public.accounts(id)   on delete cascade not null,
  patient_id      uuid references public.patients(id)   on delete set null,
  patient_phone   text not null,
  status          text not null default 'open' check (status in ('open','resolved','handoff')),
  -- Pausa o bot pra esta conversa (intervenção manual de um humano, ou um
  -- handoff real já em andamento) — enquanto true, o webhook só registra as
  -- mensagens recebidas e não chama o LLM nem responde. Independente de
  -- `status`: resolver a conversa não mexe nisso, só a equipe reativa
  -- explicitamente (ou o próprio handoff, quando aplicável).
  bot_paused      boolean not null default false,
  appointment_id  uuid references public.appointments(id) on delete set null,
  started_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  archived_at     timestamptz,
  summary         text
);

-- Mensagens individuais
create table public.messages (
  id              uuid default uuid_generate_v4() primary key,
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  role            text not null check (role in ('user','assistant','system')),
  content         text not null,
  whatsapp_id     text,
  sent_at         timestamptz not null default now()
);

-- Expediente (horários de atendimento recorrentes por médico/workspace)
create table public.availability_rules (
  id            uuid default uuid_generate_v4() primary key,
  workspace_id  uuid references public.workspaces(id) on delete cascade not null,
  doctor_id     uuid references auth.users(id) on delete cascade not null,
  day_of_week   int not null check (day_of_week between 0 and 6), -- 0=Dom, 1=Seg...6=Sáb
  start_time    time not null,
  end_time      time not null,
  slot_duration int not null default 30,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Exceções de expediente (dias bloqueados / horários extras)
create table public.availability_exceptions (
  id            uuid default uuid_generate_v4() primary key,
  workspace_id  uuid references public.workspaces(id) on delete cascade not null,
  doctor_id     uuid references auth.users(id) on delete cascade not null,
  date          date not null,
  type          text not null check (type in ('blocked', 'extra')),
  start_time    time,     -- null = dia inteiro bloqueado
  end_time      time,
  reason        text,
  created_at    timestamptz not null default now()
);

-- Lista de espera
create table public.waitlist (
  id              uuid default uuid_generate_v4() primary key,
  workspace_id    uuid references public.workspaces(id) on delete cascade not null,
  account_id      uuid references public.accounts(id)   on delete cascade not null,
  patient_id      uuid references public.patients(id)   on delete set null,
  patient_name    text not null,
  patient_phone   text not null,
  doctor_id       uuid references auth.users(id) on delete set null,
  preferred_days  text[],                             -- ['segunda','quarta']
  preferred_times text[],                             -- ['manha','tarde']
  notes           text,
  status          text not null default 'waiting'
                  check (status in ('waiting','scheduled','cancelled')),
  notified_at     timestamptz,                        -- último aviso de vaga (cron/waitlist)
  created_at      timestamptz not null default now()
);

-- Entradas de receita. `status` (previsto/confirmado/cancelado) é mantido por
-- compatibilidade; `payment_status` é o campo canônico do ciclo de receita
-- automático (ver prompts/CICLO_RECEITA_COMO_FUNCIONA.md).
create table public.revenue_entries (
  id              uuid default uuid_generate_v4() primary key,
  workspace_id    uuid references public.workspaces(id) on delete cascade not null,
  account_id      uuid references public.accounts(id)   on delete cascade not null,
  appointment_id  uuid references public.appointments(id) on delete set null,
  patient_id      uuid references public.patients(id)   on delete set null,
  procedure_id    uuid references public.procedure_catalog(id) on delete set null,
  procedure_name  text,                    -- snapshot do nome no momento do lançamento
  amount          numeric(10,2) not null,
  status          text not null default 'previsto'
                  check (status in ('previsto','confirmado','cancelado')),
  payment_status  text not null default 'pending'
                  check (payment_status in ('pending','realized','paid','cancelled','refunded')),
  payment_method  text
                  check (payment_method is null or payment_method in (
                    'pix','cartao_credito','cartao_debito','dinheiro','transferencia','outro'
                  )),
  installments    int not null default 1,
  source          text not null default 'manual'
                  check (source in ('bot','manual','whatsapp_agent')),
  due_date        date,                    -- data esperada de recebimento
  paid_at         timestamptz,             -- quando o pagamento foi confirmado
  notes           text,
  entry_date      date not null default current_date,
  created_at      timestamptz not null default now()
);

-- Preferências do ciclo de receita automático (por workspace) — alimenta o
-- cron daily-revenue-summary e a tela /configuracoes/receita. Exclusivo do
-- owner, como revenue_entries.
create table public.revenue_settings (
  workspace_id                     uuid primary key references public.workspaces(id) on delete cascade,
  account_id                       uuid not null references public.accounts(id) on delete cascade,
  daily_summary_enabled            boolean not null default true,
  daily_summary_hour               int not null default 20 check (daily_summary_hour between 0 and 23),
  daily_summary_only_with_activity boolean not null default false,
  overdue_tolerance_days           int not null default 2 check (overdue_tolerance_days >= 0),
  updated_at                       timestamptz not null default now()
);

-- Campanhas de tráfego pago
create table public.ad_campaigns (
  id              uuid default uuid_generate_v4() primary key,
  workspace_id    uuid references public.workspaces(id) on delete cascade not null,
  account_id      uuid references public.accounts(id)   on delete cascade not null,
  channel         text not null check (channel in ('instagram','google','facebook','tiktok','outro')),
  campaign_name   text,
  period_start    date not null,
  period_end      date not null,
  spend           numeric(10,2) not null default 0,
  impressions     int default 0,
  clicks          int default 0,
  leads           int default 0,
  created_at      timestamptz not null default now()
);

-- Configuração do bot (uma por workspace)
create table public.bot_config (
  id                      uuid default uuid_generate_v4() primary key,
  workspace_id            uuid references public.workspaces(id) on delete cascade not null unique,
  account_id              uuid references public.accounts(id)   on delete cascade not null,
  -- Nome fixo em todo o produto ("Maria", ver lib/bot/constants.ts) — esta
  -- coluna não é mais lida pelo app, mantida só por compatibilidade de schema.
  bot_name                text not null default 'Maria',
  specialty               text,
  procedures              text[] default '{}',
  insurance_plans         text[] default '{}',
  accepts_private         boolean not null default true,
  consultation_price_from numeric(10,2),
  business_hours          text,
  address                 text,
  directions_parking      text,
  contact_info            text,
  payment_methods         text[] default '{}',
  pricing_info            text,
  exam_preparation        text,
  policies                text,
  tone_of_voice           text,
  handoff_instructions    text,
  forbidden_actions       text,
  faq                     jsonb not null default '[]'::jsonb,
  handoff_number          text,
  handoff_message         text not null default
    'Vou te conectar com nossa equipe agora. Um momento!',
  welcome_message         text not null default
    'Olá! Posso ajudar com agendamentos e informações. Como posso ajudar?',
  -- O bot conversa e agenda 24/7 — esta mensagem NÃO pausa o bot. É usada só
  -- quando o paciente pede humano fora do horário de `handoff_hours`.
  out_of_hours_message    text not null default
    'No momento nossa equipe não está disponível para atendimento humano — já registrei sua mensagem e vamos retornar assim que possível. Enquanto isso, posso continuar te ajudando por aqui!',
  is_active               boolean not null default false,
  number_source           text not null default 'own'
                          check (number_source in ('own', 'medscale')),
  onboarding_step         text not null default 'pending'
    check (onboarding_step in (
      'pending', 'meta_app_created', 'number_added', 'webhook_set',
      'verified', 'provisioning', 'active'
    )),
  -- Verify token único desta workspace, usado quando ela traz seu próprio
  -- App Meta (cada App configura seu próprio verify token de webhook).
  webhook_verify_token    uuid not null default uuid_generate_v4() unique,
  -- Pedido de número provisionado pela MedScale (fluxo 'medscale')
  provisioning_request    jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Tokens Google (por workspace) — criptografados (lib/crypto.ts)
create table public.google_tokens (
  id             uuid default uuid_generate_v4() primary key,
  workspace_id   uuid references public.workspaces(id) on delete cascade not null unique,
  doctor_id      uuid references auth.users(id) on delete cascade not null, -- quem conectou
  access_token   text not null,
  refresh_token  text not null,
  token_expiry   timestamptz not null,
  calendar_id    text not null default 'primary',
  google_email   text,
  connected_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Logs de webhooks Meta (debugging)
create table public.webhook_logs (
  id           uuid default uuid_generate_v4() primary key,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  payload      jsonb not null,
  processed    boolean default false,
  error        text,
  received_at  timestamptz not null default now()
);

-- Rate limiting do webhook do WhatsApp por (workspace, número). Acesso
-- exclusivo via service role (ver lib/rate-limit/webhook.ts) — RLS habilitado
-- sem policies na seção 13. Sem FK para patients: o número pode ainda não ser
-- de um paciente cadastrado.
create table public.rate_limit_log (
  id            bigserial primary key,
  workspace_id  uuid        references public.workspaces(id) on delete cascade not null,
  phone         text        not null,
  window_start  timestamptz not null default now(),  -- início da janela deslizante atual
  message_count int         not null default 1,
  blocked_at    timestamptz,                          -- 1ª vez que o bloqueio foi ativado nesta janela
  notified      boolean     not null default false,   -- se o aviso já foi enviado nesta janela
  unique (workspace_id, phone)
);

-- Log de handoffs (auditoria)
create table public.handoff_logs (
  id              uuid default uuid_generate_v4() primary key,
  workspace_id    uuid references public.workspaces(id) on delete cascade not null,
  conversation_id uuid references public.conversations(id) on delete set null,
  patient_phone   text not null,
  trigger_reason  text,        -- 'user_request' | 'bot_uncertain' | 'max_turns' | 'out_of_hours'
  handoff_to      text,
  sent_at         timestamptz not null default now()
);

-- Horário de atendimento humano (handoff) — independente de availability_rules
create table public.handoff_hours (
  id            uuid default uuid_generate_v4() primary key,
  workspace_id  uuid references public.workspaces(id) on delete cascade not null,
  day_of_week   int not null check (day_of_week between 0 and 6),
  start_time    time not null,
  end_time      time not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Web Push subscriptions (VAPID) — uma por browser/dispositivo de cada usuário,
-- por workspace. Usadas por lib/push/send.ts para avisar a equipe quando
-- executeHandoff() roda. Fire-and-forget: subscriptions inválidas (404/410) são
-- apagadas na hora do envio.
create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  unique (workspace_id, endpoint)
);

-- ============================================================
-- 9. ÍNDICES
-- ============================================================
create index idx_memberships_user           on public.memberships(user_id);
create index idx_memberships_account         on public.memberships(account_id);
create index idx_invites_account             on public.invites(account_id);
create index idx_invites_email               on public.invites(email);
create index idx_workspaces_account          on public.workspaces(account_id);
create index idx_patients_account            on public.patients(account_id, phone);
create index idx_appointments_workspace      on public.appointments(workspace_id, scheduled_at);
create index idx_appointments_doctor         on public.appointments(doctor_id, scheduled_at);
create index idx_appointments_health_plan    on public.appointments(workspace_id, health_plan) where health_plan is not null;
create index idx_conversations_workspace     on public.conversations(workspace_id, status);
create index idx_conversations_archived_at   on public.conversations(archived_at);
create index idx_messages_conversation       on public.messages(conversation_id, sent_at);
create index idx_availability_workspace      on public.availability_rules(workspace_id, day_of_week);
create index idx_availability_exc_workspace  on public.availability_exceptions(workspace_id, date);
create index idx_waitlist_workspace          on public.waitlist(workspace_id, status);
create index idx_revenue_workspace           on public.revenue_entries(workspace_id, entry_date);
create index idx_revenue_appointment         on public.revenue_entries(appointment_id);
create index idx_revenue_payment_status      on public.revenue_entries(workspace_id, payment_status, due_date);
create index idx_procedure_catalog_workspace on public.procedure_catalog(workspace_id, is_active);
create index idx_ad_campaigns_workspace      on public.ad_campaigns(workspace_id, period_start);
create index idx_webhook_logs_workspace      on public.webhook_logs(workspace_id, received_at desc);
create index idx_rate_limit_workspace_phone  on public.rate_limit_log(workspace_id, phone);
create index idx_handoff_logs_workspace      on public.handoff_logs(workspace_id, sent_at desc);
create index idx_handoff_hours_workspace     on public.handoff_hours(workspace_id, day_of_week);
create index idx_push_subscriptions_workspace on public.push_subscriptions(workspace_id);
create index idx_push_subscriptions_user      on public.push_subscriptions(user_id);
create index idx_transcriptions_workspace    on public.transcriptions(workspace_id, created_at desc);
create index idx_transcriptions_appointment  on public.transcriptions(appointment_id);
create index idx_transcriptions_patient      on public.transcriptions(patient_id);
create index idx_transcriptions_status       on public.transcriptions(status);
create index idx_transcriptions_archived_at  on public.transcriptions(archived_at);
create index idx_account_notes_account       on public.account_notes(account_id, created_at desc);
create index idx_account_tasks_account       on public.account_tasks(account_id, status);
create index idx_account_tasks_assignee      on public.account_tasks(assigned_to, status, due_date);
create index idx_finance_entries_account     on public.finance_entries(account_id, entry_date desc);
create index idx_finance_entries_type        on public.finance_entries(account_id, type);

-- ============================================================
-- 10. TRIGGERS updated_at
-- ============================================================
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger trg_accounts_updated_at
  before update on public.accounts
  for each row execute procedure public.handle_updated_at();

create trigger trg_workspaces_updated_at
  before update on public.workspaces
  for each row execute procedure public.handle_updated_at();

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();

create trigger trg_appointments_updated_at
  before update on public.appointments
  for each row execute procedure public.handle_updated_at();

create trigger trg_procedure_catalog_updated_at
  before update on public.procedure_catalog
  for each row execute procedure public.handle_updated_at();

create trigger trg_revenue_settings_updated_at
  before update on public.revenue_settings
  for each row execute procedure public.handle_updated_at();

create trigger trg_bot_config_updated_at
  before update on public.bot_config
  for each row execute procedure public.handle_updated_at();

create trigger trg_google_tokens_updated_at
  before update on public.google_tokens
  for each row execute procedure public.handle_updated_at();

create trigger trg_transcriptions_updated_at
  before update on public.transcriptions
  for each row execute procedure public.handle_updated_at();

create trigger trg_account_notes_updated_at
  before update on public.account_notes
  for each row execute procedure public.handle_updated_at();

create trigger trg_account_tasks_updated_at
  before update on public.account_tasks
  for each row execute procedure public.handle_updated_at();

-- ============================================================
-- 11. TRIGGER: criar profile automaticamente ao cadastrar usuário
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- 12. FUNÇÕES AUXILIARES DE AUTORIZAÇÃO (usadas pelas policies)
-- ============================================================

-- account_ids em que o usuário atual é membro ativo
create or replace function public.my_account_ids()
returns uuid[] language sql security definer stable as $$
  select coalesce(array_agg(account_id), '{}')
  from public.memberships
  where user_id = auth.uid()
    and status = 'active'
$$;

-- workspace_ids que o usuário atual pode acessar (respeita workspace_ids do
-- membership — null nesse campo significa acesso a todos os da account)
create or replace function public.my_workspace_ids()
returns uuid[] language sql security definer stable as $$
  select coalesce(array_agg(w.id), '{}')
  from public.workspaces w
  join public.memberships m on m.account_id = w.account_id
  where m.user_id = auth.uid()
    and m.status  = 'active'
    and w.is_active = true
    and (
      m.workspace_ids is null
      or w.id = any(m.workspace_ids)
    )
$$;

-- papel >= admin do usuário atual num account
create or replace function public.is_account_admin(p_account_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.memberships
    where account_id = p_account_id
      and user_id    = auth.uid()
      and status     = 'active'
      and role in ('owner','admin')
  )
$$;

-- é admin interno da MedScale (painel /admin)
create or replace function public.is_medscale_admin()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.medscale_admins
    where user_id = auth.uid()
  )
$$;

-- papel = owner do usuário atual num account. Distinto de is_account_admin
-- (que também aceita 'admin') porque o painel financeiro e finance_entries
-- são exclusivos do owner — dado pessoal, não estendido a sócios/secretárias
-- convidados como 'admin'.
create or replace function public.is_account_owner(p_account_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.memberships
    where account_id = p_account_id
      and user_id    = auth.uid()
      and status     = 'active'
      and role       = 'owner'
  )
$$;

-- ============================================================
-- 12.1 FUNÇÕES — disparo assíncrono do pipeline de transcrição via pg_net.
-- Mesmo padrão de supabase/cron.sql: net.http_post + CRON_SECRET lido do
-- Supabase Vault via public.cron_secret() (definida em cron.sql — rode
-- aquele arquivo antes de ativar o módulo de transcrições, senão estas duas
-- funções existem mas falham em runtime com "function public.cron_secret()
-- does not exist"). p_app_url vem do Node (NEXT_PUBLIC_APP_URL).
-- ============================================================
create or replace function public.trigger_transcription_process(
  p_transcription_id uuid,
  p_app_url text
) returns void language plpgsql security definer as $$
begin
  perform net.http_post(
    url     := p_app_url || '/api/transcriptions/process',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.cron_secret()
    ),
    body    := jsonb_build_object('transcription_id', p_transcription_id)
  );
end;
$$;

create or replace function public.trigger_transcription_generate(
  p_transcription_id uuid,
  p_app_url text
) returns void language plpgsql security definer as $$
begin
  perform net.http_post(
    url     := p_app_url || '/api/transcriptions/generate-record',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.cron_secret()
    ),
    body    := jsonb_build_object('transcription_id', p_transcription_id)
  );
end;
$$;

-- ============================================================
-- 13. ROW LEVEL SECURITY
-- ============================================================
alter table public.accounts               enable row level security;
alter table public.workspaces             enable row level security;
alter table public.memberships            enable row level security;
alter table public.invites                enable row level security;
alter table public.medscale_admins        enable row level security;
alter table public.profiles               enable row level security;
alter table public.patients               enable row level security;
alter table public.appointments           enable row level security;
alter table public.conversations          enable row level security;
alter table public.messages               enable row level security;
alter table public.availability_rules     enable row level security;
alter table public.availability_exceptions enable row level security;
alter table public.waitlist               enable row level security;
alter table public.procedure_catalog      enable row level security;
alter table public.revenue_entries        enable row level security;
alter table public.revenue_settings       enable row level security;
alter table public.ad_campaigns           enable row level security;
alter table public.bot_config             enable row level security;
alter table public.google_tokens          enable row level security;
alter table public.webhook_logs           enable row level security;
alter table public.rate_limit_log         enable row level security;
alter table public.handoff_logs           enable row level security;
alter table public.handoff_hours          enable row level security;
alter table public.push_subscriptions     enable row level security;
alter table public.transcriptions         enable row level security;
alter table public.account_notes          enable row level security;
alter table public.account_tasks          enable row level security;
alter table public.finance_entries        enable row level security;
alter table public.finance_sessions       enable row level security;

-- Accounts: membro lê o(s) próprio(s); admin do account edita
create policy "accounts: members read" on public.accounts
  for select using (id = any(public.my_account_ids()));
create policy "accounts: admin update" on public.accounts
  for update using (public.is_account_admin(id));
create policy "accounts: medscale admin full" on public.accounts
  for all using (public.is_medscale_admin());

-- Workspaces: membros com acesso leem; admin do account gerencia
create policy "workspaces: members read" on public.workspaces
  for select using (id = any(public.my_workspace_ids()));
create policy "workspaces: admin manage" on public.workspaces
  for all using (public.is_account_admin(account_id));
create policy "workspaces: medscale admin full" on public.workspaces
  for all using (public.is_medscale_admin());

-- Memberships: cada um vê as próprias; admin do account gerencia
create policy "memberships: own" on public.memberships
  for select using (user_id = auth.uid());
create policy "memberships: admin manage" on public.memberships
  for all using (public.is_account_admin(account_id));
create policy "memberships: medscale admin full" on public.memberships
  for all using (public.is_medscale_admin());

-- Invites: só o admin do account em questão gerencia. Não existe policy de
-- leitura pública por token — a página de aceite resolve o convite no
-- servidor via service role, exatamente para não expor a tabela inteira
-- (com e-mails e tokens de todo mundo) através da anon key.
create policy "invites: admin manage" on public.invites
  for all using (public.is_account_admin(account_id));
create policy "invites: medscale admin full" on public.invites
  for all using (public.is_medscale_admin());

-- medscale_admins: ninguém acessa via client — só service role (sem policy
-- de select/insert/update/delete para authenticated/anon = acesso negado).

-- Profiles: cada um gerencia o próprio
create policy "profiles: own" on public.profiles
  for all using (id = auth.uid());
-- Sem isto, o admin MedScale não consegue ler nome/e-mail de outros usuários
-- ao listar membros em /admin/accounts/[id] — qualquer leitura de profiles de
-- outro auth.uid() volta vazia.
create policy "profiles: medscale admin full" on public.profiles
  for all using (public.is_medscale_admin());

-- Patients: qualquer membro ativo do account (compartilhado entre workspaces)
create policy "patients: account members" on public.patients
  for all using (account_id = any(public.my_account_ids()));

-- Padrão para as demais tabelas operacionais: workspace_id = um dos meus
create policy "appointments: workspace members" on public.appointments
  for all using (workspace_id = any(public.my_workspace_ids()));

create policy "conversations: workspace members" on public.conversations
  for all using (workspace_id = any(public.my_workspace_ids()));

create policy "messages: via conversation" on public.messages
  for all using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and c.workspace_id = any(public.my_workspace_ids())
    )
  );

create policy "availability_rules: workspace members" on public.availability_rules
  for all using (workspace_id = any(public.my_workspace_ids()));

create policy "availability_exceptions: workspace members" on public.availability_exceptions
  for all using (workspace_id = any(public.my_workspace_ids()));

create policy "waitlist: workspace members" on public.waitlist
  for all using (workspace_id = any(public.my_workspace_ids()));

-- Catálogo de procedimentos: leitura/escrita por membro da workspace (o bot e
-- a /agenda leem os preços). O cadastro (create/update) é restrito a owner na
-- camada de API — não é dado sensível como revenue_entries.
create policy "procedure_catalog: workspace members" on public.procedure_catalog
  for all using (workspace_id = any(public.my_workspace_ids()));

-- Exclusivo do owner — mesmo padrão de finance_entries (dado financeiro não
-- é estendido a admin/member, nem via module_overrides).
create policy "revenue_entries: owner only" on public.revenue_entries
  for all using (public.is_account_owner(account_id));

create policy "revenue_settings: owner only" on public.revenue_settings
  for all using (public.is_account_owner(account_id));

create policy "ad_campaigns: workspace members" on public.ad_campaigns
  for all using (workspace_id = any(public.my_workspace_ids()));

create policy "bot_config: workspace members" on public.bot_config
  for all using (workspace_id = any(public.my_workspace_ids()));

create policy "google_tokens: workspace members" on public.google_tokens
  for all using (workspace_id = any(public.my_workspace_ids()));

create policy "webhook_logs: workspace members" on public.webhook_logs
  for all using (workspace_id = any(public.my_workspace_ids()));

create policy "handoff_logs: workspace members" on public.handoff_logs
  for all using (workspace_id = any(public.my_workspace_ids()));

create policy "handoff_hours: workspace members" on public.handoff_hours
  for all using (workspace_id = any(public.my_workspace_ids()));

-- push_subscriptions: cada usuário só enxerga/gerencia as próprias. O envio
-- (lib/push/send.ts) roda com service_role e ignora esta policy.
create policy "push_subscriptions: own" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "transcriptions: workspace members" on public.transcriptions
  for all using (workspace_id = any(public.my_workspace_ids()));

-- account_notes/account_tasks: dado interno de CRM, uso exclusivo dos admins
-- MedScale — sem policy tenant-facing, nunca exposto a membros de account.
create policy "account_notes: medscale admin full" on public.account_notes
  for all using (public.is_medscale_admin());

create policy "account_tasks: medscale admin full" on public.account_tasks
  for all using (public.is_medscale_admin());

-- finance_entries: dado financeiro pessoal — exclusivo do owner do account,
-- não estendido a admin/member como o restante dos dados operacionais.
create policy "finance_entries: owner only" on public.finance_entries
  for all using (public.is_account_owner(account_id));

-- finance_sessions: contexto de conversa do bot financeiro — só o webhook
-- (service role) acessa; sem policy tenant-facing.
create policy "finance_sessions: service role only" on public.finance_sessions
  for all using (false);

-- rate_limit_log: controle de rate limiting do webhook do WhatsApp — só o
-- webhook (service role, que ignora RLS) acessa; deny-all para todo role
-- tenant-facing, mesmo padrão de finance_sessions.
create policy "rate_limit_log: service role only" on public.rate_limit_log
  for all using (false);

-- Necessário para a subscription Realtime da página de detalhe de
-- transcrição (RLS habilitado não é suficiente, a tabela precisa estar na
-- publicação replicada explicitamente).
alter publication supabase_realtime add table public.transcriptions;

-- ============================================================
-- 14. PERMISSÕES (GRANTS) — necessárias ALÉM das policies de RLS
-- ============================================================
-- RLS só entra em ação depois que o Postgres já concedeu o privilégio
-- básico na tabela para o role. Tabelas criadas via SQL Editor (como este
-- script) não ganham os grants automáticos que o Table Editor do Supabase
-- aplica — sem isto, toda operação falha com "permission denied for table X"
-- (código 42501), mesmo autenticado e com a policy de RLS correta.
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;

alter default privileges in schema public grant all on tables to authenticated;
alter default privileges in schema public grant all on sequences to authenticated;

-- 'service_role' (createAdminClient() em lib/supabase/server.ts) ignora RLS
-- mas ainda precisa destes grants básicos — usado por app/api/cron/*,
-- app/api/admin/accounts/*, app/(auth)/invite/[token], app/api/invites/*,
-- app/api/whatsapp/webhook, lib/llm/agent.ts, lib/bot/*, lib/google/*. Sem
-- isto, todas essas rotas falham com "permission denied for table X".
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

grant execute on function public.trigger_transcription_process(uuid, text) to authenticated, service_role;
grant execute on function public.trigger_transcription_generate(uuid, text) to authenticated, service_role;

-- 'anon' propositalmente não recebe grants — nenhuma tabela deste app deve
-- ser lida por usuários não autenticados.
