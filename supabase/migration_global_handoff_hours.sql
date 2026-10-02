-- Incremental: horário humano Global por conta. Preserva os horários das unidades.
begin;

create table if not exists public.account_handoff_hours (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (start_time < end_time)
);
create index if not exists idx_account_handoff_hours on public.account_handoff_hours(account_id, day_of_week);
alter table public.account_handoff_hours enable row level security;

drop policy if exists "account_handoff_hours: account members read" on public.account_handoff_hours;
create policy "account_handoff_hours: account members read" on public.account_handoff_hours
  for select using (account_id = any(public.my_account_ids()));

drop policy if exists "account_handoff_hours: managers write" on public.account_handoff_hours;
create policy "account_handoff_hours: managers write" on public.account_handoff_hours
  for all using (
    exists (select 1 from public.memberships m where m.account_id = account_handoff_hours.account_id
      and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'admin'))
  ) with check (
    exists (select 1 from public.memberships m where m.account_id = account_handoff_hours.account_id
      and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'admin'))
  );

commit;
