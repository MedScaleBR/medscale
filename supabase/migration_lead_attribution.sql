-- Atribuição de lead: liga o paciente que chegou pelo WhatsApp ao anúncio que o
-- trouxe. Idempotente. Ver docs/superpowers/plans/2026-09-18-trafego-atribuicao-roi-funil.md
-- Aplicar no SQL Editor do Supabase.

-- 1. Origem de cada conversa que chegou por anúncio.
--
-- Tabela própria, e não coluna em `conversations`, porque o referral chega uma
-- vez só — na PRIMEIRA mensagem depois do clique — e a conversa pode ser
-- reaberta depois. Queremos guardar as duas passagens, não sobrescrever.
create table if not exists public.lead_attributions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  patient_phone text not null,
  -- ID do ANÚNCIO (não da campanha). A tradução vive em meta_ad_map.
  source_id text not null,
  source_type text not null default 'ad',
  -- Identificador único do clique. É o que torna o insert idempotente: a Meta
  -- reenvia o mesmo webhook quando não recebe 200 a tempo.
  ctwa_clid text,
  headline text,
  body text,
  source_url text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Idempotência do webhook. `ctwa_clid` pode vir nulo em anúncio antigo, por isso
-- o índice é parcial: sem clid caímos no segundo índice, por conversa.
create unique index if not exists idx_lead_attr_clid
  on public.lead_attributions(account_id, ctwa_clid)
  where ctwa_clid is not null;

create unique index if not exists idx_lead_attr_conversation
  on public.lead_attributions(conversation_id, source_id)
  where conversation_id is not null;

create index if not exists idx_lead_attr_lookup
  on public.lead_attributions(account_id, occurred_at desc);

alter table public.lead_attributions enable row level security;

drop policy if exists lead_attributions_select on public.lead_attributions;
create policy lead_attributions_select on public.lead_attributions
  for select using (account_id = any(public.my_account_ids()));

-- 2. Tradução anúncio -> campanha.
--
-- O referral traz o ID do anúncio; ad_campaigns guarda o ID da campanha. Sem
-- esta tabela as duas metades nunca se encontram.
create table if not exists public.meta_ad_map (
  account_id uuid not null references public.accounts(id) on delete cascade,
  ad_id text not null,
  campaign_id text not null,
  ad_name text,
  adset_name text,
  synced_at timestamptz not null default now(),
  primary key (account_id, ad_id)
);

alter table public.meta_ad_map enable row level security;

drop policy if exists meta_ad_map_select on public.meta_ad_map;
create policy meta_ad_map_select on public.meta_ad_map
  for select using (account_id = any(public.my_account_ids()));

-- As políticas acima só cobrem SELECT. A escrita das duas tabelas roda no
-- webhook e no sync, ambos com o admin client (service role), mesmo padrão de
-- workspace_ad_accounts.
