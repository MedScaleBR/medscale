-- Migração incremental: configuração compartilhada por account
-- (Maria, Google Calendar e recorte por unidade no financeiro)
--
-- Rode isto no SQL Editor do Supabase — NÃO rode supabase/schema.sql inteiro
-- (é "drop and recreate" e apagaria todos os dados existentes). Este conteúdo
-- já foi incorporado em supabase/schema.sql, que continua sendo a fonte de
-- verdade para reconstruções completas do zero.
--
-- O que muda:
--   1. bot_config passa a ser 1 por account (era 1 por workspace). A conexão
--      WhatsApp (phone_number_id/meta_token/meta_app_secret/whatsapp_number)
--      migra de workspaces -> bot_config: número único por account.
--   2. Campos exibidos pela Maria que variam por unidade (business_hours,
--      directions_parking, contact_info, consultation_price_from,
--      handoff_number) migram de bot_config -> workspaces. address já existia
--      em workspaces e passa a ser a fonte.
--   3. google_tokens passa a ser 1 por account (era 1 por workspace). Cada
--      unidade aponta para um calendário via workspaces.gcal_calendar_id.
--   4. conversations.workspace_id vira nullable — a Maria só sabe a unidade
--      depois de perguntar; a unidade real de cada consulta fica em
--      appointments.workspace_id.
--   5. finance_entries ganha workspace_id nullable (NULL = consolidado).
--
-- Expediente (availability_rules/availability_exceptions), handoff_hours e
-- procedure_catalog CONTINUAM por unidade — sem mudança.
--
-- Nota de colapso: quando um account tem mais de uma workspace com bot_config
-- ou google_tokens próprios, a migração mantém a linha da workspace padrão
-- (is_default, depois menor display_order, depois mais antiga) e descarta as
-- demais, consolidando a conexão WhatsApp de qualquer linha irmã que a tenha.
-- Depois de rodar, revise em /configuracoes o mapa unidade → calendário Google.

begin;

-- ============================================================
-- 0. RLS — remove as policies antigas ANTES de mexer nas colunas de que elas
--    dependem (workspace_id em bot_config/google_tokens). As novas são
--    recriadas na seção 6.
-- ============================================================
drop policy if exists "bot_config: workspace members"    on public.bot_config;
drop policy if exists "google_tokens: workspace members"  on public.google_tokens;

-- ============================================================
-- 1. WORKSPACES — campos que variam por unidade
-- ============================================================
alter table public.workspaces
  add column if not exists business_hours          text,
  add column if not exists directions_parking      text,
  add column if not exists contact_info            text,
  add column if not exists consultation_price_from numeric(10,2),
  add column if not exists handoff_number          text,
  add column if not exists gcal_calendar_id        text;

comment on column public.workspaces.gcal_calendar_id is
  'ID do calendário Google desta unidade dentro da conexão única da account (google_tokens é por account). NULL = usar o calendário "primary".';
comment on column public.workspaces.handoff_number is
  'Número de transferência para atendimento humano desta unidade. Opcional — sem ele o handoff acontece mesmo assim, só não manda "Contato: ..." ao paciente.';

-- Backfill dos campos por-unidade a partir do bot_config atual (1 por workspace).
-- coalesce preserva o que a workspace já tiver (address costuma já estar preenchido).
update public.workspaces w set
  business_hours          = coalesce(w.business_hours, bc.business_hours),
  directions_parking      = coalesce(w.directions_parking, bc.directions_parking),
  contact_info            = coalesce(w.contact_info, bc.contact_info),
  consultation_price_from = coalesce(w.consultation_price_from, bc.consultation_price_from),
  handoff_number          = coalesce(w.handoff_number, bc.handoff_number),
  address                 = coalesce(w.address, bc.address)
from public.bot_config bc
where bc.workspace_id = w.id;

-- ============================================================
-- 2. BOT_CONFIG — 1 por account; recebe a conexão WhatsApp
-- ============================================================
alter table public.bot_config
  add column if not exists whatsapp_number text,
  add column if not exists phone_number_id text,
  add column if not exists meta_token      text,
  add column if not exists meta_app_secret text;

-- Traz a conexão WhatsApp de workspaces para bot_config (a linha do bot_config
-- referencia a mesma workspace via workspace_id, ainda presente neste ponto).
update public.bot_config bc set
  whatsapp_number = coalesce(bc.whatsapp_number, w.whatsapp_number),
  phone_number_id = coalesce(bc.phone_number_id, w.phone_number_id),
  meta_token      = coalesce(bc.meta_token, w.meta_token),
  meta_app_secret = coalesce(bc.meta_app_secret, w.meta_app_secret)
from public.workspaces w
where w.id = bc.workspace_id;

-- Colapsa para 1 bot_config por account.
do $$
declare
  r record;
  v_keep_id uuid;
begin
  for r in (
    select account_id
    from public.bot_config
    group by account_id
    having count(*) > 1
  ) loop
    select bc.id into v_keep_id
    from public.bot_config bc
    left join public.workspaces w on w.id = bc.workspace_id
    where bc.account_id = r.account_id
    order by coalesce(w.is_default, false) desc,
             coalesce(w.display_order, 2147483647) asc,
             bc.created_at asc
    limit 1;

    -- Consolida a conexão WhatsApp de alguma linha irmã, se a vencedora não tiver.
    update public.bot_config keep set
      phone_number_id = coalesce(keep.phone_number_id, src.phone_number_id),
      meta_token      = coalesce(keep.meta_token, src.meta_token),
      meta_app_secret = coalesce(keep.meta_app_secret, src.meta_app_secret),
      whatsapp_number = coalesce(keep.whatsapp_number, src.whatsapp_number)
    from (
      select phone_number_id, meta_token, meta_app_secret, whatsapp_number
      from public.bot_config
      where account_id = r.account_id
        and id <> v_keep_id
        and phone_number_id is not null
      limit 1
    ) src
    where keep.id = v_keep_id;

    delete from public.bot_config
    where account_id = r.account_id
      and id <> v_keep_id;
  end loop;
end $$;

-- Remove a chave por-workspace e os campos que migraram para workspaces.
-- (o FK e o unique de workspace_id caem junto com a coluna)
alter table public.bot_config drop column if exists workspace_id;
alter table public.bot_config drop column if exists business_hours;
alter table public.bot_config drop column if exists address;
alter table public.bot_config drop column if exists directions_parking;
alter table public.bot_config drop column if exists contact_info;
alter table public.bot_config drop column if exists consultation_price_from;
alter table public.bot_config drop column if exists handoff_number;

create unique index if not exists bot_config_account_id_key on public.bot_config(account_id);

-- Lookup do webhook do WhatsApp: phone_number_id recebido -> account/bot_config.
create index if not exists idx_bot_config_phone_number_id
  on public.bot_config(phone_number_id) where phone_number_id is not null;

-- workspaces perde a conexão WhatsApp (agora única, em bot_config)
alter table public.workspaces drop column if exists phone_number_id;
alter table public.workspaces drop column if exists meta_token;
alter table public.workspaces drop column if exists meta_app_secret;
alter table public.workspaces drop column if exists whatsapp_number;

-- ============================================================
-- 3. GOOGLE_TOKENS — 1 conexão por account
-- ============================================================
alter table public.google_tokens
  add column if not exists account_id uuid references public.accounts(id) on delete cascade;

update public.google_tokens gt set account_id = w.account_id
from public.workspaces w
where w.id = gt.workspace_id and gt.account_id is null;

-- Cada workspace que tinha conexão herda o calendar_id como seu calendário.
update public.workspaces w set gcal_calendar_id = coalesce(w.gcal_calendar_id, gt.calendar_id)
from public.google_tokens gt
where gt.workspace_id = w.id;

-- Colapsa para 1 google_tokens por account (mantém o da workspace padrão).
do $$
declare
  r record;
  v_keep_id uuid;
begin
  for r in (
    select account_id
    from public.google_tokens
    where account_id is not null
    group by account_id
    having count(*) > 1
  ) loop
    select gt.id into v_keep_id
    from public.google_tokens gt
    left join public.workspaces w on w.id = gt.workspace_id
    where gt.account_id = r.account_id
    order by coalesce(w.is_default, false) desc,
             coalesce(w.display_order, 2147483647) asc,
             gt.connected_at asc
    limit 1;

    delete from public.google_tokens
    where account_id = r.account_id
      and id <> v_keep_id;
  end loop;
end $$;

-- Tokens órfãos (workspace apagada antes desta migração) não têm account —
-- são inúteis sem a unidade que os originou.
delete from public.google_tokens where account_id is null;

alter table public.google_tokens drop column if exists workspace_id;
alter table public.google_tokens drop column if exists calendar_id;
alter table public.google_tokens alter column account_id set not null;
create unique index if not exists google_tokens_account_id_key on public.google_tokens(account_id);

-- ============================================================
-- 4. CONVERSATIONS — workspace_id nullable
-- ============================================================
alter table public.conversations alter column workspace_id drop not null;

-- FK de cascade -> set null: a conversa pertence ao account; apagar uma
-- unidade não deve apagar o histórico de conversa do paciente.
alter table public.conversations drop constraint if exists conversations_workspace_id_fkey;
alter table public.conversations
  add constraint conversations_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces(id) on delete set null;

-- ============================================================
-- 5. FINANCE_ENTRIES — recorte opcional por unidade
-- ============================================================
alter table public.finance_entries
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;

comment on column public.finance_entries.workspace_id is
  'Unidade do lançamento. NULL = consolidado / account-wide (padrão para PF). Para PJ a Maria financeira pergunta qual unidade antes de gravar.';

create index if not exists idx_finance_entries_workspace
  on public.finance_entries(account_id, workspace_id, entry_date desc);

-- ============================================================
-- 5b. RATE_LIMIT_LOG — por account (o número da Maria é único por account)
-- ============================================================
-- Bucket muda de (workspace_id, phone) para (account_id, phone). Não vale a
-- pena migrar contadores em voo — só esvaziamos a tabela (a janela é de 60s).
truncate table public.rate_limit_log;
alter table public.rate_limit_log drop column if exists workspace_id;
alter table public.rate_limit_log
  add column if not exists account_id uuid references public.accounts(id) on delete cascade;
alter table public.rate_limit_log alter column account_id set not null;
drop index if exists public.idx_rate_limit_workspace_phone;
create unique index if not exists rate_limit_log_account_id_phone_key
  on public.rate_limit_log(account_id, phone);

-- ============================================================
-- 6. RLS — bot_config e google_tokens passam a ser por account
--    (as policies antigas já foram removidas na seção 0)
-- ============================================================
drop policy if exists "bot_config: account members" on public.bot_config;
create policy "bot_config: account members" on public.bot_config
  for all using (account_id = any(public.my_account_ids()));

drop policy if exists "google_tokens: account members" on public.google_tokens;
create policy "google_tokens: account members" on public.google_tokens
  for all using (account_id = any(public.my_account_ids()));

commit;
