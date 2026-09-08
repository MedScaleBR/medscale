-- Lista de espera pela Maria — dia/horário desejado + origem da entrada.
-- Idempotente. Ver docs/superpowers/specs/2026-09-08-waitlist-maria-design.md
-- Aplicar no SQL Editor do Supabase.

alter table public.waitlist add column if not exists desired_date date;
alter table public.waitlist add column if not exists desired_time time;
alter table public.waitlist add column if not exists source text not null default 'manual';

alter table public.waitlist drop constraint if exists waitlist_source_check;
alter table public.waitlist add constraint waitlist_source_check
  check (source in ('manual','bot'));

-- schema.sql define o check de status inline (nome auto-gerado waitlist_status_check).
alter table public.waitlist drop constraint if exists waitlist_status_check;
alter table public.waitlist add constraint waitlist_status_check
  check (status in ('waiting','scheduled','cancelled','expired'));

-- De-dupe: um paciente, um dia desejado, uma entrada ativa por unidade.
create unique index if not exists uq_waitlist_active_desired
  on public.waitlist (workspace_id, patient_phone, desired_date)
  where status = 'waiting' and desired_date is not null;

-- Match do cron por dia desejado.
create index if not exists idx_waitlist_desired
  on public.waitlist (desired_date, status)
  where desired_date is not null;
