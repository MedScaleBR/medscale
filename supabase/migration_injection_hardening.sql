-- Hardening contra prompt injection — auditoria do conteúdo descartado.
-- Idempotente. Ver docs/superpowers/specs/2026-09-12-prompt-injection-hardening-design.md
-- Aplicar no SQL Editor do Supabase.

-- Resposta do bot descartada por prometer desconto não configurado (decisão 9
-- do design). Fica só aqui — nunca em console.*, Sentry ou PostHog: o scrub do
-- Sentry (lib/observability/sentry-scrub.ts) redige apenas telefone, e
-- handoff_logs já é coberto por RLS.
-- Nome rejeitado em NOME_PACIENTE NÃO usa esta coluna (decisão 7a): ele não
-- dispara handoff, então não há linha aqui — a mensagem original já está em
-- `messages`, sob RLS.
alter table public.handoff_logs add column if not exists flagged_content text;

-- trigger_reason é text livre, sem CHECK — 'injection_suspected' não exige
-- constraint nova. Só o comentário em schema.sql é atualizado.
