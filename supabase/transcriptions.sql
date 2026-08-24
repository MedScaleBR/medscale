-- MedScale — módulo de Transcrição de Consultas
-- Execute no SQL Editor do Supabase. Idempotente na medida do possível (usa
-- "if not exists" onde dá), mas CREATE TYPE/CREATE TABLE falham se já
-- existirem — normal, roda uma vez só. Segue o mesmo padrão de cron.sql:
-- script avulso, não reexecuta schema.sql (ver nota no topo daquele arquivo).
--
-- Pré-requisito: supabase/cron.sql já deve ter sido executado ao menos uma
-- vez (usa a mesma app.cron_secret configurada lá para autenticar as
-- chamadas HTTP disparadas pelas funções trigger_transcription_*).

-- ============================================================
-- 1. ENUM + TABELA
-- ============================================================
create type public.transcription_status as enum (
  'pending',
  'transcribing',
  'transcribed',
  'generating',
  'draft_ready',
  'signed',
  'error'
);

create table public.transcriptions (
  id                    uuid default uuid_generate_v4() primary key,
  workspace_id          uuid references public.workspaces(id) on delete cascade not null,
  account_id            uuid references public.accounts(id)   on delete cascade not null,
  appointment_id        uuid references public.appointments(id) on delete set null,
  patient_id            uuid references public.patients(id)   on delete restrict not null,
  recorded_by           uuid references auth.users(id)        on delete restrict not null,
  audio_path            text not null,
  duration_seconds      int,
  transcript_text       text,
  medical_record_draft  jsonb,
  medical_record_final  jsonb,
  status                public.transcription_status not null default 'pending',
  consent_confirmed     boolean not null default false,
  source                text not null default 'system' check (source in ('system', 'whatsapp')),
  error_message         text,
  retry_count           int not null default 0,
  signed_at             timestamptz,
  signed_by             uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_transcriptions_workspace   on public.transcriptions(workspace_id, created_at desc);
create index idx_transcriptions_appointment on public.transcriptions(appointment_id);
create index idx_transcriptions_patient     on public.transcriptions(patient_id);
create index idx_transcriptions_status      on public.transcriptions(status);

create trigger trg_transcriptions_updated_at
  before update on public.transcriptions
  for each row execute procedure public.handle_updated_at();

-- ============================================================
-- 2. ROW LEVEL SECURITY
-- ============================================================
alter table public.transcriptions enable row level security;

create policy "transcriptions: workspace members" on public.transcriptions
  for all using (workspace_id = any(public.my_workspace_ids()));

-- Grants explícitos — tabela criada fora do schema.sql original não herda os
-- grants de "alter default privileges" aplicados na primeira execução (ver
-- seção 14 de schema.sql). Sem isto: "permission denied for table
-- transcriptions" mesmo com a policy de RLS correta.
grant all on public.transcriptions to authenticated;
grant all on public.transcriptions to service_role;

-- Sem isto, a subscription Realtime da página de detalhe
-- (components/transcriptions/TranscriptionDetailClient.tsx) nunca recebe
-- eventos — a tabela precisa estar na publicação replicada explicitamente,
-- não basta ter RLS habilitado.
alter publication supabase_realtime add table public.transcriptions;

-- ============================================================
-- 3. STORAGE — bucket "recordings"
-- ============================================================
-- Criar manualmente via Supabase Dashboard → Storage → New bucket, ANTES de
-- rodar as policies abaixo:
--   Name: recordings
--   Public: false
--   File size limit: 150 MB
--   Allowed MIME types: audio/webm, audio/ogg, audio/mp4, audio/wav
--
-- Caminho dos objetos: `${workspace_id}/${appointment_id ?? 'no-appointment'}/${timestamp}.${ext}`
-- — o primeiro segmento do path precisa ser o workspace_id para as policies
-- abaixo funcionarem (storage.foldername(name))[1].

create policy "recordings: workspace members upload"
  on storage.objects for insert
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1]::uuid = any(public.my_workspace_ids())
  );

create policy "recordings: workspace members read"
  on storage.objects for select
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1]::uuid = any(public.my_workspace_ids())
  );

create policy "recordings: workspace members delete"
  on storage.objects for delete
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1]::uuid = any(public.my_workspace_ids())
  );

-- service_role (usado por /api/cron/cleanup-recordings) já ignora RLS de
-- storage.objects normalmente, mas o bucket precisa existir com esse nome.

-- ============================================================
-- 4. FUNÇÕES — disparo assíncrono do pipeline via pg_net
-- ============================================================
-- Mesmo padrão de supabase/cron.sql: net.http_post com o CRON_SECRET salvo
-- em app.cron_secret, header Authorization: Bearer (não x-cron-secret) —
-- consistente com o "Bearer <CRON_SECRET>" que toda rota em app/api/cron/*
-- (e agora as de app/api/transcriptions/process e generate-record) já checa.
-- p_app_url vem do Node (NEXT_PUBLIC_APP_URL) para não precisar configurar
-- mais uma setting de banco (app.settings.app_url).

create or replace function public.trigger_transcription_process(
  p_transcription_id uuid,
  p_app_url text
) returns void language plpgsql security definer as $$
begin
  perform net.http_post(
    url     := p_app_url || '/api/transcriptions/process',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.cron_secret')
    ),
    body    := jsonb_build_object('transcription_id', p_transcription_id)
  );
end;
$$;

create or replace function public.trigger_transcription_generate(
  p_transcription_id uuid,
  p_app_url text
) returns void language plpgsql security definer as $$
begin
  perform net.http_post(
    url     := p_app_url || '/api/transcriptions/generate-record',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.cron_secret')
    ),
    body    := jsonb_build_object('transcription_id', p_transcription_id)
  );
end;
$$;

grant execute on function public.trigger_transcription_process(uuid, text) to authenticated, service_role;
grant execute on function public.trigger_transcription_generate(uuid, text) to authenticated, service_role;

-- ============================================================
-- 5. CRON — limpeza de áudios antigos
-- ============================================================
-- Job registrado em supabase/cron.sql ('cleanup-old-recordings', 3h da
-- manhã) — rode aquele arquivo também (ou só a seção do cron novo) se ainda
-- não tiver feito.
