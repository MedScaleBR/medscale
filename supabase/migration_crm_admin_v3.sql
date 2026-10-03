-- Migração incremental v3: kanban de tarefas + origem (alerta de custo/feedback).
-- Rode isto no SQL Editor do Supabase DEPOIS de já ter rodado
-- supabase/migration_crm_admin.sql e supabase/migration_crm_admin_v2.sql.
-- Este conteúdo também já foi incorporado em supabase/schema.sql.
-- Idempotente: pode rodar de novo sem quebrar. O backfill de position só roda
-- enquanto todas as posições ainda são 0 — não desfaz a ordem arrumada no kanban.
-- Para voltar ao código anterior, veja supabase/rollback_crm_admin_v3.sql.
--
-- - status passa de pending/done para todo/doing/done (pending vira todo);
-- - position ordena os cartões dentro de cada coluna do kanban;
-- - source_type/source_ref vinculam a tarefa à origem ("Virar tarefa"),
--   com índice único para impedir tarefa duplicada da mesma origem.
-- RLS de account_tasks continua só is_medscale_admin() — nada muda aqui.

alter table public.account_tasks drop constraint if exists account_tasks_status_check;
update public.account_tasks set status = 'todo' where status = 'pending';
alter table public.account_tasks add constraint account_tasks_status_check
  check (status in ('todo','doing','done'));
alter table public.account_tasks alter column status set default 'todo';

alter table public.account_tasks add column if not exists position double precision not null default 0;

-- Backfill: sem isto toda tarefa existente nasceria com position 0 e a ordem
-- do kanban ficaria indefinida. Espaçamento de 1024 deixa espaço para inserir
-- entre dois cartões; dentro da coluna, prazo mais próximo primeiro.
update public.account_tasks t
   set position = s.rn * 1024
  from (
    select id, row_number() over (partition by status order by due_date nulls last, created_at) rn
      from public.account_tasks
  ) s
 where s.id = t.id
   and not exists (select 1 from public.account_tasks where position <> 0);

alter table public.account_tasks
  add column if not exists source_type text check (source_type in ('cost_alert','feedback')),
  add column if not exists source_ref  text;
create unique index if not exists uq_account_tasks_source
  on public.account_tasks(source_type, source_ref) where source_type is not null;

create index if not exists idx_account_tasks_board on public.account_tasks(status, position);
