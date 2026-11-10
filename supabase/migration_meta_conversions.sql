-- Conversões para a Meta: cada consulta marcada por paciente que veio de anúncio
-- Click-to-WhatsApp vira um LeadSubmitted na Conversions API for Business
-- Messaging. Idempotente. Ver docs/superpowers/specs/2026-11-09-meta-capi-agendamento-design.md
-- Aplicar no SQL Editor do Supabase.

-- 1. Um evento por linha. A Meta NÃO deduplica, então quem garante "uma vez
-- só" é o unique (account_id, dedup_key):
--   appt:<appointment_id>                 agenda interna e terceirizado
--   ext:<conversation_id>:<AAAA-MM-DD>    solicitação da agenda externa
create table if not exists public.meta_conversion_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  dedup_key text not null,
  event_name text not null default 'LeadSubmitted',
  ctwa_clid text not null,
  event_time timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts int not null default 0,
  -- Só código e mensagem da Meta — nunca dado de paciente.
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (account_id, dedup_key)
);

-- O cron de reenvio só olha o que ainda não foi.
create index if not exists idx_meta_conv_retry
  on public.meta_conversion_events(status, event_time)
  where status <> 'sent';

alter table public.meta_conversion_events enable row level security;

-- Escrita só pelo admin client (service role, que ignora RLS).
drop policy if exists meta_conversion_events_select on public.meta_conversion_events;
create policy meta_conversion_events_select on public.meta_conversion_events
  for select using (account_id = any(public.my_account_ids()));

-- 2. Dataset da Meta ligado ao WABA da account, criado no primeiro envio.
alter table public.bot_config add column if not exists meta_dataset_id text;
