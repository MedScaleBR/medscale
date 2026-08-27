-- Migração incremental: rate limiting do webhook do WhatsApp por
-- (workspace, número de telefone). Rode isto no SQL Editor do Supabase — NÃO
-- rode supabase/schema.sql inteiro (é "drop and recreate" e apagaria os dados
-- existentes). Este conteúdo já foi incorporado em supabase/schema.sql, que
-- continua sendo a fonte de verdade para reconstruções completas do zero.
--
-- Contexto: app/api/whatsapp/webhook/route.ts chama lib/rate-limit/webhook.ts
-- a cada mensagem recebida de paciente. Sem isso, um único número podia
-- disparar dezenas de chamadas ao Claude (custo por token) e respostas via
-- Graph API em segundos. Limite: 10 mensagens / 60s por (workspace, número).

-- ============================================================
-- 1. TABELA
-- Acesso exclusivo via service role (createAdminClient) dentro do webhook —
-- nunca pelo cliente autenticado do usuário. Sem FK para patients: o número
-- pode não ser de um paciente cadastrado ainda.
-- ============================================================
create table if not exists public.rate_limit_log (
  id            bigserial primary key,
  workspace_id  uuid        not null references public.workspaces(id) on delete cascade,
  phone         text        not null,
  window_start  timestamptz not null default now(),  -- início da janela deslizante atual
  message_count int         not null default 1,
  blocked_at    timestamptz,                          -- 1ª vez que o bloqueio foi ativado nesta janela
  notified      boolean     not null default false,   -- se a mensagem de aviso já foi enviada nesta janela
  unique (workspace_id, phone)  -- um registro por (workspace, número) — o UPSERT sempre atualiza o mesmo
);

-- A query de checagem sempre filtra por (workspace_id, phone). O unique
-- constraint acima já cria um índice que cobre isso, mas mantemos o índice
-- nomeado explícito em linha com o restante do schema (seção 9).
create index if not exists idx_rate_limit_workspace_phone
  on public.rate_limit_log(workspace_id, phone);

-- RLS habilitado + policy deny-all: trava a tabela para todo role
-- tenant-facing (o service role ignora RLS). Mesmo padrão de finance_sessions.
alter table public.rate_limit_log enable row level security;
drop policy if exists "rate_limit_log: service role only" on public.rate_limit_log;
create policy "rate_limit_log: service role only" on public.rate_limit_log
  for all using (false);

-- Grants básicos — tabelas criadas via SQL Editor não ganham os grants
-- automáticos do Table Editor; sem isto o webhook falha com
-- "permission denied for table rate_limit_log" (42501) mesmo com RLS ok.
grant all on public.rate_limit_log to service_role, authenticated;
grant usage, select on sequence public.rate_limit_log_id_seq to service_role, authenticated;

-- ============================================================
-- 2. LIMPEZA AUTOMÁTICA (pg_cron)
-- Registros com window_start antigo não têm mais utilidade — a janela já
-- expirou e a próxima mensagem daquele número recria a linha via UPSERT.
-- Registros velhos não causam comportamento incorreto, só acúmulo de dados;
-- a limpeza é manutenção, não correção de bug. DELETE direto no Postgres
-- (sem HTTP), diferente dos outros jobs em supabase/cron.sql que precisam
-- bater numa rota /api/cron/*.
-- ============================================================
create extension if not exists pg_cron;

select cron.schedule(
  'cleanup-rate-limits',
  '*/10 * * * *',
  $$
    delete from public.rate_limit_log
    where window_start < now() - interval '10 minutes';
  $$
);

-- Para remover depois: select cron.unschedule('cleanup-rate-limits');

-- ============================================================
-- 3. NOTAS DE ARQUITETURA (não implementar agora)
-- ============================================================
-- - Redis/Upstash é a evolução natural se o volume de mensagens crescer a
--   ponto do Postgres virar gargalo no path crítico do webhook. A interface
--   checkRateLimit(workspaceId, phone) não muda — só a implementação interna.
-- - Limite configurável por workspace (clínicas com tráfego pago legítimo):
--   adicionar coluna rate_limit_override em bot_config e ler no checkRateLimit.
