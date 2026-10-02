import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

describe('migração do horário humano Global', () => {
  it('preserva horários locais, é reaplicável e isola leitura/escrita por conta e papel', async () => {
    const db = new PGlite()
    const account1 = '00000000-0000-0000-0000-000000000001'
    const account2 = '00000000-0000-0000-0000-000000000002'
    const owner = '00000000-0000-0000-0000-000000000011'
    const member = '00000000-0000-0000-0000-000000000012'
    try {
      await db.exec(`
        create schema auth;
        create function auth.uid() returns uuid language sql stable as $$
          select current_setting('test.user_id', true)::uuid
        $$;
        create table public.accounts (id uuid primary key);
        create table public.memberships (account_id uuid, user_id uuid, status text, role text);
        create table public.handoff_hours (id text primary key);
        insert into public.accounts values ('${account1}'), ('${account2}');
        insert into public.memberships values ('${account1}', '${owner}', 'active', 'owner'), ('${account1}', '${member}', 'active', 'member');
        insert into public.handoff_hours values ('preserved');
        create function public.my_account_ids() returns uuid[] language sql stable as $$
          select coalesce(array_agg(account_id), '{}'::uuid[]) from public.memberships where user_id = auth.uid() and status = 'active'
        $$;
        create role tenant;
        grant usage on schema public, auth to tenant;
        grant select on public.memberships to tenant;
      `)
      const migration = readFileSync(resolve('supabase/migration_global_handoff_hours.sql'), 'utf8')
      await db.exec(migration)
      await db.exec(migration)
      expect((await db.query('select id from public.handoff_hours')).rows).toEqual([{ id: 'preserved' }])
      await db.exec(`
        grant select, insert, update, delete on public.account_handoff_hours to tenant;
        insert into public.account_handoff_hours (account_id, day_of_week, start_time, end_time) values ('${account2}', 1, '08:00', '17:00');
        set role tenant;
        set test.user_id = '${owner}';
        insert into public.account_handoff_hours (account_id, day_of_week, start_time, end_time) values ('${account1}', 1, '08:00', '17:00');
      `)
      expect((await db.query('select account_id from public.account_handoff_hours')).rows).toEqual([{ account_id: account1 }])
      await expect(db.exec(`insert into public.account_handoff_hours (account_id, day_of_week, start_time, end_time) values ('${account2}', 1, '08:00', '17:00')`)).rejects.toThrow(/row-level security/)
      await db.exec(`set test.user_id = '${member}'`)
      expect((await db.query('select account_id from public.account_handoff_hours')).rows).toEqual([{ account_id: account1 }])
      await expect(db.exec(`insert into public.account_handoff_hours (account_id, day_of_week, start_time, end_time) values ('${account1}', 1, '08:00', '17:00')`)).rejects.toThrow(/row-level security/)
      await db.exec('delete from public.account_handoff_hours')
      expect((await db.query('select account_id from public.account_handoff_hours')).rows).toEqual([{ account_id: account1 }])
    } finally {
      await db.close()
    }
  })
})
