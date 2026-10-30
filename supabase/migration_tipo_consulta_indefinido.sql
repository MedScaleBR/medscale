-- Tipo da consulta pode ficar vazio ("Não definido").
-- A Clara não pergunta mais "primeira consulta ou retorno": o sistema decide
-- pelo histórico do paciente (lib/appointment-type.ts) e, sem certeza, deixa
-- o tipo vazio para a equipe definir na agenda.
--
-- Ordem: 1) este arquivo; 2) reaplicar supabase/billing-authenticated.sql
-- (a guia TISS de consulta sem tipo passa a ficar pendente em vez de sair
-- como "primeira consulta"). Idempotente.

alter table public.appointments alter column type drop not null;
