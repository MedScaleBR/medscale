-- MedScale — orquestração de crons via Supabase pg_cron
-- Execute no SQL Editor do Supabase. Idempotente: pode ser reexecutado sem
-- apagar dados (ao contrário de schema.sql, que faz reset completo).
--
-- Substitui os cron jobs diários da Vercel (plano Hobby não permite frequência
-- horária) por agendamento direto no Postgres, que dispara HTTP requests para
-- as rotas /api/cron/* já protegidas por CRON_SECRET.

-- ============================================================
-- 0. MIGRAÇÃO — coluna usada pelo cron/waitlist para não reavisar a cada
--    execução enquanto a vaga continuar aberta (ver app/api/cron/waitlist).
--    schema.sql já inclui esta coluna para instalações novas; para bancos
--    existentes, rode este ALTER.
-- ============================================================
alter table public.waitlist add column if not exists notified_at timestamptz;

-- ============================================================
-- 1. EXTENSÕES
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;   -- para HTTP requests dentro do Supabase

-- Salvar o CRON_SECRET como configuração do banco — substitua pelo mesmo
-- valor da env var CRON_SECRET (.env.local e Vercel).
alter database postgres
  set app.cron_secret = 'seu_secret_aqui';

-- ============================================================
-- 2. CRON JOBS
-- Substitua a URL base (https://app.medscalebr.com) pelo domínio de produção
-- real, se for diferente. Em staging, crie jobs separados com nomes distintos
-- apontando para a URL de staging.
-- ============================================================

-- REMINDERS: lembretes WhatsApp 24h antes da consulta — roda a cada hora, no ponto
select cron.schedule(
  'appointment-reminders',
  '0 * * * *',
  $$
    select net.http_post(
      url     := 'https://app.medscalebr.com/api/cron/reminders',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.cron_secret')
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- NO-SHOW: marca consultas passadas sem confirmação como no_show — 30min após o ponto
select cron.schedule(
  'mark-noshow',
  '30 * * * *',
  $$
    select net.http_post(
      url     := 'https://app.medscalebr.com/api/cron/noshow',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.cron_secret')
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- WAITLIST: notifica próximos da lista de espera quando abre vaga — 15min após o ponto
select cron.schedule(
  'waitlist-notify',
  '15 * * * *',
  $$
    select net.http_post(
      url     := 'https://app.medscalebr.com/api/cron/waitlist',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.cron_secret')
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- CLEANUP-RECORDINGS: apaga áudios de transcrições assinadas há mais de
-- RECORDING_RETENTION_DAYS dias (ver supabase/transcriptions.sql) — 3h da manhã
select cron.schedule(
  'cleanup-old-recordings',
  '0 3 * * *',
  $$
    select net.http_post(
      url     := 'https://app.medscalebr.com/api/cron/cleanup-recordings',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.cron_secret')
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- ============================================================
-- 3. VERIFICAÇÃO
-- ============================================================

-- Jobs registrados:
-- select jobname, schedule, command, active from cron.job;

-- Remover um job (exemplo):
-- select cron.unschedule('appointment-reminders');

-- Histórico de disparos (pg_net é assíncrono — isto mostra se o *disparo*
-- funcionou, não o resultado da rota; use os logs do Vercel para isso):
-- select jobname, start_time, end_time, status, return_message
-- from cron.job_run_details
-- order by start_time desc
-- limit 50;

-- Só falhas:
-- select jobname, start_time, return_message
-- from cron.job_run_details
-- where status = 'failed'
-- order by start_time desc;
