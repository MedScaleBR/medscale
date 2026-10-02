-- Migração incremental v3: kanban de tarefas + origem (alerta de custo/feedback).
-- Rode isto no SQL Editor do Supabase DEPOIS de já ter rodado
-- supabase/migration_crm_admin.sql e supabase/migration_crm_admin_v2.sql.
-- Este conteúdo também já foi incorporado em supabase/schema.sql.
--
-- - status passa de pending/done para todo/doing/done (pending vira todo);
-- - position ordena os cartões dentro de cada coluna do kanban;
-- - source_type/source_ref vinculam a tarefa à origem ("Virar tarefa"),
--   com índice único para impedir tarefa duplicada da mesma origem.
-- RLS de account_tasks continua só is_medscale_admin() — nada muda aqui.

alter table public.account_tasks drop constraint account_tasks_status_check;
update public.account_tasks set status = 'todo' where status = 'pending';
alter table public.account_tasks add constraint account_tasks_status_check
  check (status in ('todo','doing','done'));
alter table public.account_tasks alter column status set default 'todo';

alter table public.account_tasks add column position double precision not null default 0;

alter table public.account_tasks
  add column source_type text check (source_type in ('cost_alert','feedback')),
  add column source_ref  text;
create unique index uq_account_tasks_source
  on public.account_tasks(source_type, source_ref) where source_type is not null;

create index idx_account_tasks_board on public.account_tasks(status, position);
