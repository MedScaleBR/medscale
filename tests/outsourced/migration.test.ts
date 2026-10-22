import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const acc = '00000000-0000-0000-0000-000000000001'
const ws1 = '00000000-0000-0000-0000-0000000000a1'
const ws2 = '00000000-0000-0000-0000-0000000000a2'
const appt = '00000000-0000-0000-0000-0000000000b1'
const member = '00000000-0000-0000-0000-000000000011'

describe('migração do agendamento terceirizado', () => {
  let db: PGlite
  let migration: string

  beforeAll(async () => {
    migration = readFileSync(resolve('supabase/migration_agendamento_terceirizado.sql'), 'utf8')
    db = new PGlite()
    await db.exec(`
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select current_setting('test.user_id', true)::uuid
      $$;
      create table public.accounts (id uuid primary key);
      create table public.workspaces (id uuid primary key, account_id uuid references public.accounts(id), is_active boolean not null default true);
      create table public.patients (id uuid primary key, account_id uuid, full_name text);
      create table public.appointments (
        id uuid primary key,
        workspace_id uuid references public.workspaces(id),
        account_id uuid references public.accounts(id),
        status text not null default 'agendado'
          check (status in ('agendado','confirmado','realizado','cancelado','no_show'))
      );
      create table public.handoff_logs (
        id uuid primary key default gen_random_uuid(),
        workspace_id uuid references public.workspaces(id),
        patient_phone text not null,
        trigger_reason text
      );
      create table public.memberships (account_id uuid, user_id uuid, status text, workspace_ids uuid[]);
      create function public.my_workspace_ids() returns uuid[] language sql security definer stable as $$
        select coalesce(array_agg(w.id), '{}')
        from public.workspaces w
        join public.memberships m on m.account_id = w.account_id
        where m.user_id = auth.uid()
          and m.status  = 'active'
          and w.is_active = true
          and (m.workspace_ids is null or w.id = any(m.workspace_ids))
      $$;
      create role tenant;
      grant usage on schema public, auth to tenant;
      insert into public.accounts values ('${acc}');
      insert into public.workspaces (id, account_id) values ('${ws1}', '${acc}'), ('${ws2}', '${acc}');
      insert into public.memberships values ('${acc}', '${member}', 'active', array['${ws1}']::uuid[]);
      insert into public.appointments (id, workspace_id, account_id) values ('${appt}', '${ws1}', '${acc}');
    `)
    await db.exec(migration)
    await db.exec(migration)
  })

  afterAll(async () => {
    await db?.close()
  })

  it('é reaplicável e aceita o status novo', async () => {
    await db.exec(`update public.appointments set status = 'pendente_confirmacao_externa' where id = '${appt}'`)
    await expect(db.exec(`update public.appointments set status = 'qualquer' where id = '${appt}'`)).rejects.toThrow(/check/)
  })

  it('aceita handoff_logs sem telefone de paciente', async () => {
    await db.exec(`insert into public.handoff_logs (workspace_id, trigger_reason) values ('${ws1}', 'clinica_externa_ambiguo')`)
  })

  it('rejeita external_clinic_phone fora do formato só dígitos com DDI', async () => {
    await expect(db.exec(`update public.workspaces set external_clinic_phone = '+55 71 99999-0000' where id = '${ws1}'`)).rejects.toThrow(/check/)
    await db.exec(`update public.workspaces set is_outsourced = true, external_clinic_phone = '5571999990000' where id = '${ws1}'`)
  })

  it('whatsapp_id é único', async () => {
    await db.exec(`insert into public.clinic_confirmations (account_id, workspace_id, direction, raw_text, whatsapp_id) values ('${acc}', '${ws1}', 'inbound', 'a', 'wamid.1')`)
    await expect(
      db.exec(`insert into public.clinic_confirmations (account_id, workspace_id, direction, raw_text, whatsapp_id) values ('${acc}', '${ws1}', 'inbound', 'b', 'wamid.1')`),
    ).rejects.toThrow(/unique/)
  })

  it('clinic_confirmations: membro lê só as da unidade dele e não escreve', async () => {
    await db.exec(`
      delete from public.clinic_confirmations;
      insert into public.clinic_confirmations (account_id, workspace_id, direction, raw_text) values ('${acc}', '${ws1}', 'inbound', 'minha unidade');
      insert into public.clinic_confirmations (account_id, workspace_id, direction, raw_text) values ('${acc}', '${ws2}', 'inbound', 'outra unidade');
      grant select, insert on public.clinic_confirmations to tenant;
      grant select on public.workspaces, public.memberships to tenant;
      set role tenant;
      set test.user_id = '${member}';
    `)
    try {
      expect((await db.query('select workspace_id from public.clinic_confirmations')).rows).toEqual([{ workspace_id: ws1 }])
      await expect(
        db.exec(`insert into public.clinic_confirmations (account_id, workspace_id, direction, raw_text) values ('${acc}', '${ws1}', 'inbound', 'x')`),
      ).rejects.toThrow(/row-level security/)
    } finally {
      await db.exec('reset role')
    }
  })
})
