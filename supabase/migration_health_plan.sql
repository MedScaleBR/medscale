-- Migração incremental: plano de saúde (convênio) no agendamento
--
-- Rode no SQL Editor do Supabase — NÃO rode supabase/schema.sql inteiro, que é
-- "drop and recreate". Este arquivo só ADICIONA uma coluna. Idempotente.
--
-- O conteúdo abaixo já foi incorporado em supabase/schema.sql (fonte de verdade
-- para reconstruções do zero).
--
-- A lista de convênios atendidos continua vindo de bot_config.insurance_plans
-- (text[]). Aqui só guardamos, por agendamento, QUAL convênio foi usado —
-- snapshot do nome, NULL = consulta particular. Consulta por convênio não gera
-- revenue_entry (o repasse do plano é tratado fora do ciclo de receita); ela
-- aparece nas telas de receita apenas como contagem, filtrável por plano.

alter table public.appointments
  add column if not exists health_plan text;

create index if not exists idx_appointments_health_plan
  on public.appointments(workspace_id, health_plan)
  where health_plan is not null;
