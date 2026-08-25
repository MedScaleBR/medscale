-- Migração incremental: arquivamento de transcrições.
-- Rode isto no SQL Editor do Supabase — NÃO rode supabase/schema.sql
-- inteiro, pois aquele arquivo é "drop and recreate" e apagaria todos os
-- dados existentes. Este arquivo só ADICIONA a coluna nova.
--
-- O conteúdo abaixo também já foi incorporado em supabase/schema.sql, que
-- continua sendo a fonte de verdade para reconstruções completas do zero.

alter table public.transcriptions
  add column archived_at timestamptz;

create index idx_transcriptions_archived_at on public.transcriptions(archived_at);
