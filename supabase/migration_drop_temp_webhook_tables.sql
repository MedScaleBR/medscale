-- Remove as tabelas temporárias criadas para depurar o agente financeiro
-- (migration_finance_agent_messages.sql e migration_webhook_debug_log.sql).
-- O código que as usava já foi revertido no main (PR #96/#97) e na dev.
-- Rodar manualmente no SQL Editor do Supabase.
drop table if exists public.webhook_debug_log;
drop table if exists public.finance_agent_messages;
