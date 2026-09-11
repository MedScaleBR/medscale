-- Migração incremental: feedback dos clientes (balão no workspace + painel admin)
-- Rode isto no SQL Editor do Supabase — NÃO rode supabase/schema.sql inteiro,
-- pois aquele arquivo é "drop and recreate" e apagaria todos os dados
-- existentes. Este arquivo só ADICIONA a tabela nova e uma coluna em profiles.
--
-- O conteúdo abaixo também já foi incorporado em supabase/schema.sql, que
-- continua sendo a fonte de verdade para reconstruções completas do zero.

create table public.feedback (
  id            uuid default uuid_generate_v4() primary key,
  account_id    uuid references public.accounts(id) on delete set null,
  workspace_id  uuid references public.workspaces(id) on delete set null,
  user_id       uuid references auth.users(id) on delete set null,
  message       text not null,
  status        text not null default 'new' check (status in ('new','reviewed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_feedback_status on public.feedback(status, created_at desc);

create trigger trg_feedback_updated_at
  before update on public.feedback
  for each row execute procedure public.handle_updated_at();

alter table public.feedback enable row level security;

-- O cliente só escreve, e só em nome próprio numa account da qual é membro.
create policy "feedback: member insert own" on public.feedback
  for insert with check (
    user_id = auth.uid()
    and account_id = any(public.my_account_ids())
  );

-- Ler e triar é exclusivo dos admins internos: um membro nunca vê o que
-- outro escreveu, nem o próprio texto de volta.
create policy "feedback: medscale admin read"   on public.feedback
  for select using (public.is_medscale_admin());
create policy "feedback: medscale admin update" on public.feedback
  for update using (public.is_medscale_admin());
create policy "feedback: medscale admin delete" on public.feedback
  for delete using (public.is_medscale_admin());

grant all on public.feedback to authenticated, service_role;

-- Marca da última interação com o balão (envio OU "agora não"). O default
-- now() faz o relógio de 15 dias começar na instalação, então nem quem já
-- usa o sistema é abordado no dia do deploy, nem quem acabou de se cadastrar
-- é abordado no primeiro login.
alter table public.profiles
  add column feedback_prompt_dismissed_at timestamptz default now();
