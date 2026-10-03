-- Allow transcription without creating a patient record.
begin;

alter table public.transcriptions
  alter column patient_id drop not null,
  add column if not exists patient_name text,
  add column if not exists unit_name text;

alter table public.transcriptions
  add constraint transcriptions_patient_identity_check check (
    patient_id is not null or (
      nullif(btrim(patient_name), '') is not null
      and nullif(btrim(unit_name), '') is not null
      and appointment_id is null
    )
  );

commit;
