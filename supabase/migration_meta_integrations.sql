-- Integrações Meta: Embedded Signup do WhatsApp + Login com Facebook (Ads).
-- Idempotente. Ver docs/superpowers/specs/2026-09-16-integracoes-meta-design.md
-- Aplicar no SQL Editor do Supabase.

-- 1. Conexão do Facebook Ads (uma por account, espelha google_tokens)
create table if not exists public.meta_ads_connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.accounts(id) on delete cascade,
  fb_user_id text not null,
  access_token text not null,          -- cifrado (lib/crypto.ts)
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  connected_by uuid references auth.users(id) on delete set null,
  is_valid boolean not null default true,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.meta_ads_connections enable row level security;

drop policy if exists meta_ads_connections_select on public.meta_ads_connections;
create policy meta_ads_connections_select on public.meta_ads_connections
  for select using (account_id in (select public.my_account_ids()));

-- 2. Mapeamento unidade -> conta de anúncio
create table if not exists public.workspace_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  ad_account_id text not null,         -- formato act_<id>
  ad_account_name text,
  created_at timestamptz not null default now(),
  unique (workspace_id, ad_account_id)
);

alter table public.workspace_ad_accounts enable row level security;

drop policy if exists workspace_ad_accounts_select on public.workspace_ad_accounts;
create policy workspace_ad_accounts_select on public.workspace_ad_accounts
  for select using (account_id in (select public.my_account_ids()));

-- 3. ad_campaigns: separar o que veio do sync do que foi digitado à mão
alter table public.ad_campaigns add column if not exists source text not null default 'manual';
alter table public.ad_campaigns add column if not exists external_campaign_id text;

alter table public.ad_campaigns drop constraint if exists ad_campaigns_source_check;
alter table public.ad_campaigns add constraint ad_campaigns_source_check
  check (source in ('manual','meta_sync'));

-- Torna o upsert do sync idempotente sem impor unicidade às linhas manuais.
create unique index if not exists uq_ad_campaigns_meta_sync
  on public.ad_campaigns (workspace_id, external_campaign_id, period_start)
  where source = 'meta_sync';

-- 4. bot_config: dados do Embedded Signup; App Secret por account sai de cena
alter table public.bot_config add column if not exists waba_id text;
alter table public.bot_config add column if not exists whatsapp_pin text;  -- cifrado

-- 5. Limpeza das conexões de teste do fluxo antigo (não há produção real;
--    todos reconectam pelo botão novo).
update public.bot_config
set meta_token = null,
    phone_number_id = null,
    whatsapp_number = null,
    is_active = false;

alter table public.bot_config drop column if exists meta_app_secret;
