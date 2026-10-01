-- Banco efêmero de testes. Apenas a infraestrutura Supabase existente é
-- simulada aqui; tabelas/RLS/RPCs de faturamento vêm de billing.sql real.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema storage;
create table auth.users (id uuid primary key);
create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$$;
create table public.accounts (id uuid primary key, modules text[] not null default '{}', is_active boolean not null default true);
create table public.profiles (id uuid primary key references auth.users, full_name text not null, crm text);
create table public.workspaces (id uuid primary key, account_id uuid not null references public.accounts);
create table public.memberships (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users,
  account_id uuid not null references public.accounts, role text not null,
  workspace_ids uuid[], status text not null default 'active'
);
create table public.patients (id uuid primary key, account_id uuid not null references public.accounts, full_name text not null);
create table public.appointments (
  id uuid primary key, account_id uuid not null references public.accounts,
  workspace_id uuid not null references public.workspaces, doctor_id uuid references auth.users,
  patient_id uuid references public.patients, patient_name text not null,
  scheduled_at timestamptz not null, type text not null default 'consulta', status text not null default 'agendado'
);
create table public.transcriptions (
  id uuid primary key default gen_random_uuid(), appointment_id uuid references public.appointments,
  account_id uuid not null references public.accounts, workspace_id uuid not null references public.workspaces,
  medical_record_final jsonb, status text not null, signed_at timestamptz
);
create function public.handle_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = clock_timestamp(); return new; end; $$;
create function public.my_account_ids() returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.account_id), '{}') from public.memberships m
    join public.accounts a on a.id = m.account_id
    where m.user_id = auth.uid() and m.status = 'active' and a.is_active;
$$;
create function public.my_workspace_ids() returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(w.id), '{}') from public.workspaces w
    join public.memberships m on m.account_id = w.account_id join public.accounts a on a.id = w.account_id
    where m.user_id = auth.uid() and m.status = 'active' and a.is_active
      and (m.workspace_ids is null or w.id = any(m.workspace_ids));
$$;
create function public.is_account_admin(p_account_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.memberships where user_id = auth.uid() and account_id = p_account_id
    and status = 'active' and role in ('owner','admin'));
$$;
grant usage on schema auth, public to authenticated, service_role, anon;
grant select on public.accounts, public.appointments, public.workspaces, public.profiles, public.patients, public.transcriptions to authenticated, service_role;
alter table public.accounts enable row level security;
create policy account_read on public.accounts for select using (id = any(public.my_account_ids()));
alter table public.appointments enable row level security;
create policy appointment_read on public.appointments for select using (workspace_id = any(public.my_workspace_ids()));
alter table public.workspaces enable row level security;
create policy workspace_read on public.workspaces for select using (id = any(public.my_workspace_ids()));
alter table public.profiles enable row level security;
create policy profile_own on public.profiles for select using (id = auth.uid());
alter table public.patients enable row level security;
create policy patient_read on public.patients for select using (account_id = any(public.my_account_ids()));
alter table public.transcriptions enable row level security;
create policy transcription_read on public.transcriptions for select using (workspace_id = any(public.my_workspace_ids()));
