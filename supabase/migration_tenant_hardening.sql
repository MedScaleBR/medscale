-- Migração incremental: tranca a coluna account_id das tabelas operacionais
-- (auditoria de segurança F1 + F4).
--
-- Rode isto no SQL Editor do Supabase — NÃO rode supabase/schema.sql inteiro
-- (é "drop and recreate" e apagaria os dados). Este conteúdo já foi
-- incorporado em supabase/schema.sql, a fonte de verdade para rebuilds.
--
-- Problema: appointments, conversations, waitlist, ad_campaigns e
-- transcriptions carregam workspace_id E account_id, mas as policies de RLS só
-- testavam workspace_id. Sem WITH CHECK explícito, o Postgres reutiliza o
-- USING como WITH CHECK — só o workspace_id novo era validado num UPDATE, o
-- account_id novo não. Uma rota que repassasse o corpo cru para .update()
-- (corrigido em paralelo na API) permitia carimbar um account_id de outra
-- conta na própria linha, poluindo agregações feitas por .eq('account_id', X).
--
-- Correção em duas camadas:
--   1. Trigger BEFORE INSERT/UPDATE que DERIVA account_id de workspace_id —
--      account_id deixa de ser um valor que o cliente escolhe.
--   2. WITH CHECK explícito nas policies, incluindo account_id — defesa em
--      profundidade caso a trigger seja removida.
--
-- revenue_entries / revenue_settings / finance_entries já testam account_id na
-- própria policy (is_account_owner(account_id)), então já rejeitavam um
-- account_id forjado — a trigger entra só para manter a coerência.

begin;

-- ============================================================
-- 1. TRIGGER — account_id sempre derivado de workspace_id
-- ============================================================
create or replace function public.enforce_workspace_account()
returns trigger language plpgsql as $$
begin
  if new.workspace_id is not null then
    select w.account_id into new.account_id
    from public.workspaces w
    where w.id = new.workspace_id;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'appointments', 'conversations', 'waitlist', 'ad_campaigns',
    'transcriptions', 'revenue_entries', 'revenue_settings'
  ] loop
    execute format('drop trigger if exists trg_enforce_ws_account on public.%I', t);
    execute format(
      'create trigger trg_enforce_ws_account before insert or update on public.%I
         for each row execute procedure public.enforce_workspace_account()', t);
  end loop;
end $$;

-- Conserta linhas que já estejam incoerentes (se houver).
update public.appointments  a set account_id = w.account_id from public.workspaces w where w.id = a.workspace_id and a.account_id <> w.account_id;
update public.conversations c set account_id = w.account_id from public.workspaces w where w.id = c.workspace_id and c.account_id <> w.account_id;
update public.waitlist      x set account_id = w.account_id from public.workspaces w where w.id = x.workspace_id and x.account_id <> w.account_id;
update public.ad_campaigns   x set account_id = w.account_id from public.workspaces w where w.id = x.workspace_id and x.account_id <> w.account_id;
update public.transcriptions x set account_id = w.account_id from public.workspaces w where w.id = x.workspace_id and x.account_id <> w.account_id;

-- ============================================================
-- 2. POLICIES — WITH CHECK explícito incluindo account_id
-- ============================================================
drop policy if exists "appointments: workspace members" on public.appointments;
create policy "appointments: workspace members" on public.appointments
  for all
  using (workspace_id = any(public.my_workspace_ids()))
  with check (
    workspace_id = any(public.my_workspace_ids())
    and account_id = any(public.my_account_ids())
  );

drop policy if exists "waitlist: workspace members" on public.waitlist;
create policy "waitlist: workspace members" on public.waitlist
  for all
  using (workspace_id = any(public.my_workspace_ids()))
  with check (
    workspace_id = any(public.my_workspace_ids())
    and account_id = any(public.my_account_ids())
  );

drop policy if exists "ad_campaigns: workspace members" on public.ad_campaigns;
create policy "ad_campaigns: workspace members" on public.ad_campaigns
  for all
  using (workspace_id = any(public.my_workspace_ids()))
  with check (
    workspace_id = any(public.my_workspace_ids())
    and account_id = any(public.my_account_ids())
  );

drop policy if exists "transcriptions: workspace members" on public.transcriptions;
create policy "transcriptions: workspace members" on public.transcriptions
  for all
  using (workspace_id = any(public.my_workspace_ids()))
  with check (
    workspace_id = any(public.my_workspace_ids())
    and account_id = any(public.my_account_ids())
  );

commit;
