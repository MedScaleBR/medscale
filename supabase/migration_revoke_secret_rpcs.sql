-- Migração incremental: fecha o vazamento do CRON_SECRET pela API REST e
-- corrige o domínio dos cron jobs.
--
-- Rode isto no SQL Editor do Supabase — NÃO rode supabase/schema.sql inteiro
-- (é "drop and recreate" e apagaria os dados). Este conteúdo já foi
-- incorporado em schema.sql, transcriptions.sql e cron.sql.
--
-- Problema 1: funções no schema public ganham EXECUTE para PUBLIC por padrão,
-- e o PostgREST expõe todas em /rest/v1/rpc/*. Como são SECURITY DEFINER:
--   - cron_secret() devolvia o CRON_SECRET para qualquer um com a anon key
--     (que é pública, vai no bundle do browser);
--   - trigger_transcription_* aceitam p_app_url livre e fazem POST com
--     "Authorization: Bearer <CRON_SECRET>" — dava para mandar o secret para
--     um host qualquer.
-- Só o service role (rotas do app) e o próprio Postgres (pg_cron, funções
-- SECURITY DEFINER) precisam chamá-las.
--
-- Problema 2: os jobs apontavam para https://app.medscalebr.com, que não
-- existe no DNS ("Couldn't resolve host name" em net._http_response). O app
-- responde em https://medscalebr.com. Lembretes, no-show, lista de espera,
-- reconciliação da agenda, resumo diário e limpeza de gravações não rodavam.

revoke execute on function public.cron_secret() from public, anon, authenticated;
revoke execute on function public.trigger_transcription_process(uuid, text) from public, anon, authenticated;
revoke execute on function public.trigger_transcription_generate(uuid, text) from public, anon, authenticated;
grant execute on function public.cron_secret() to service_role;
grant execute on function public.trigger_transcription_process(uuid, text) to service_role;
grant execute on function public.trigger_transcription_generate(uuid, text) to service_role;

-- Troca só o host, preservando o resto do comando de cada job.
select cron.alter_job(
  jobid,
  command := replace(command, 'https://app.medscalebr.com/', 'https://medscalebr.com/')
)
from cron.job
where command like '%https://app.medscalebr.com/%';

-- meta-ads-sync (cron.sql) nunca foi agendado em produção.
select cron.schedule(
  'meta-ads-sync',
  '30 6 * * *',
  $$
    select net.http_post(
      url     := 'https://medscalebr.com/api/cron/meta-ads-sync',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || public.cron_secret()
      ),
      body    := '{}'::jsonb
    );
  $$
);
