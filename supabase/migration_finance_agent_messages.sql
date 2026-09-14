-- Log interno das mensagens recebidas no número compartilhado do agente financeiro.
create table if not exists public.finance_agent_messages (
  id          uuid default uuid_generate_v4() primary key,
  account_id  uuid references public.accounts(id) on delete set null,
  phone       text not null,
  direction   text not null default 'inbound' check (direction in ('inbound','outbound')),
  content     text not null,
  whatsapp_id text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_finance_agent_messages_created
  on public.finance_agent_messages(created_at desc);
create index if not exists idx_finance_agent_messages_account
  on public.finance_agent_messages(account_id, created_at desc);

alter table public.finance_agent_messages enable row level security;

drop policy if exists "finance_agent_messages: medscale admin read" on public.finance_agent_messages;
create policy "finance_agent_messages: medscale admin read" on public.finance_agent_messages
  for select using (public.is_medscale_admin());

grant all on table public.finance_agent_messages to authenticated;
grant all on table public.finance_agent_messages to service_role;
