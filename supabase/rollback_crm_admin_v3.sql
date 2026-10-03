-- Rollback da migração v3 (kanban de tarefas). Só rode isto se o código do
-- /admin voltar para a versão anterior ao kanban (que grava status 'pending').
-- Rode DEPOIS do deploy do código antigo — o código novo não aceita 'pending'.
--
-- Não apaga dados: position, source_type e source_ref ficam na tabela (o
-- código antigo simplesmente os ignora) para que a v3 possa ser reaplicada
-- sem perder a ordem do kanban nem o vínculo com alertas/feedbacks. Única
-- perda: 'doing' (Em andamento) vira 'pending', igual a 'todo'.

alter table public.account_tasks drop constraint if exists account_tasks_status_check;
update public.account_tasks set status = 'pending' where status in ('todo', 'doing');
alter table public.account_tasks add constraint account_tasks_status_check
  check (status in ('pending','done'));
alter table public.account_tasks alter column status set default 'pending';
