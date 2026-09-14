-- Migração incremental: custo variável por workspace (painel /admin/costs).
-- Rode isto no SQL Editor do Supabase — NÃO rode supabase/schema.sql inteiro,
-- pois aquele arquivo é "drop and recreate" e apagaria todos os dados
-- existentes. Este arquivo só ADICIONA a tabela nova.
--
-- O conteúdo abaixo também já foi incorporado em supabase/schema.sql, que
-- continua sendo a fonte de verdade para reconstruções completas do zero.
--
-- Cada linha é UM evento de custo real já incorrido pela MedScale: uma chamada
-- ao Claude, uma transcrição no Whisper, ou uma janela de 24h do WhatsApp que
-- a MedScale paga à Meta (só quando bot_config.number_source = 'medscale').
-- Não é previsão nem rateio — é o que já foi gasto.

create table public.cost_events (
  id            uuid default uuid_generate_v4() primary key,
  -- account_id é NOT NULL e workspace_id é anulável de propósito: a Clara é
  -- configurada por account (bot_config.account_id é unique) e
  -- conversations.workspace_id fica NULL até o paciente indicar a unidade numa
  -- conta multi-unidade. Forçar uma unidade aqui seria inventar atribuição; o
  -- painel mostra esse custo num balde "sem unidade" explícito.
  account_id    uuid references public.accounts(id)   on delete cascade not null,
  workspace_id  uuid references public.workspaces(id) on delete set null,
  provider      text not null check (provider in (
                  'claude_agendamento',
                  'claude_financeiro',
                  'claude_soap',
                  'whisper',
                  'whatsapp_conversation'
                )),
  -- Id do modelo cobrado (ex: 'claude-sonnet-4-5', 'claude-opus-5', 'whisper-1').
  -- Null para whatsapp_conversation, que não tem modelo.
  model         text,
  input_tokens  int,
  output_tokens int,
  -- Unidade cobrada quando não são tokens: segundos de áudio no whisper,
  -- 1 no whatsapp_conversation (uma janela de 24h).
  quantity      numeric(12,2),
  -- Custo em reais, congelado no momento do evento. É a unidade canônica: o
  -- que a MedScale quer olhar é margem em R$, e a cotação do dia do gasto é a
  -- correta para um custo já incorrido. O valor em USD e a cotação usada ficam
  -- em metadata para auditoria.
  cost_brl      numeric(12,4) not null default 0,
  -- Origem do evento: conversation_id (bot e whatsapp), transcription_id
  -- (whisper e soap). Sem FK: aponta para tabelas diferentes por provider, e
  -- apagar a origem não deve apagar o custo já gasto.
  related_id    uuid,
  -- Só dado técnico (etapa do agente financeiro, cotação, custo em USD).
  -- Nunca conteúdo de paciente — LGPD.
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- O painel sempre corta por período; conta e unidade são os dois agrupamentos.
create index idx_cost_events_account   on public.cost_events(account_id, created_at desc);
create index idx_cost_events_workspace on public.cost_events(workspace_id, created_at desc);
create index idx_cost_events_provider  on public.cost_events(provider, created_at desc);
-- Serve a checagem da janela de 24h do WhatsApp, que busca por conversa.
create index idx_cost_events_related   on public.cost_events(provider, related_id, created_at desc);

alter table public.cost_events enable row level security;

-- Custo é informação interna da MedScale sobre a própria margem: nenhuma
-- clínica vê a própria linha, nem a de outra. Só admin interno lê. A escrita
-- acontece exclusivamente via service_role (webhooks e jobs), que bypassa RLS
-- — por isso não existe policy de insert para `authenticated`.
create policy "cost_events: medscale admin read" on public.cost_events
  for select using (public.is_medscale_admin());

grant all on public.cost_events to service_role;
grant select on public.cost_events to authenticated;
