-- Migração incremental v2: permite tarefas sem cliente atrelado.
-- Rode isto no SQL Editor do Supabase DEPOIS de já ter rodado
-- supabase/migration_crm_admin.sql (que cria account_notes/account_tasks).
-- Este conteúdo também já foi incorporado em supabase/schema.sql.

alter table public.account_tasks
  alter column account_id drop not null;
