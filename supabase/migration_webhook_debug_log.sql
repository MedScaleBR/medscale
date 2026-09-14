-- TEMPORARIO: log bruto de toda chamada ao webhook do WhatsApp, incluindo as
-- que falham na validacao de assinatura. Serve pra depurar o mismatch de
-- phone_number_id entre o que a Meta envia e o que esta configurado
-- (FINANCE_PHONE_NUMBER_ID / bot_config). Remover esta tabela e a página
-- /admin/webhook-debug quando o diagnostico terminar.
create table if not exists public.webhook_debug_log (
  id                uuid default uuid_generate_v4() primary key,
  phone_number_id   text,
  is_finance_number boolean not null default false,
  signature_valid   boolean not null,
  account_id        uuid references public.accounts(id) on delete set null,
  message_type      text,
  content           text,
  whatsapp_id       text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_webhook_debug_log_created
  on public.webhook_debug_log(created_at desc);

alter table public.webhook_debug_log enable row level security;

drop policy if exists "webhook_debug_log: medscale admin read" on public.webhook_debug_log;
create policy "webhook_debug_log: medscale admin read" on public.webhook_debug_log
  for select using (public.is_medscale_admin());

grant all on table public.webhook_debug_log to authenticated;
grant all on table public.webhook_debug_log to service_role;
