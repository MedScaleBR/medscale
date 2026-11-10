import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const acc1 = '00000000-0000-0000-0000-000000000001'
const acc2 = '00000000-0000-0000-0000-000000000002'

describe('migração das conversões para a Meta', () => {
  let db: PGlite

  beforeAll(async () => {
    const migration = readFileSync(resolve('supabase/migration_meta_conversions.sql'), 'utf8')
    db = new PGlite()
    await db.exec(`
      create table public.accounts (id uuid primary key);
      create table public.appointments (id uuid primary key);
      create table public.bot_config (account_id uuid primary key);
      create function public.my_account_ids() returns uuid[] language sql stable as $$ select '{}'::uuid[] $$;
      insert into public.accounts values ('${acc1}'), ('${acc2}');
    `)
    await db.exec(migration)
    await db.exec(migration)
  })

  afterAll(async () => {
    await db?.close()
  })

  it('aplica duas vezes sem erro e adiciona meta_dataset_id em bot_config', async () => {
    await db.exec(`insert into public.bot_config (account_id, meta_dataset_id) values ('${acc1}', 'D1')`)
  })

  it('recusa dedup_key repetido na mesma account', async () => {
    const insert = (acc: string) =>
      db.exec(
        `insert into public.meta_conversion_events (account_id, dedup_key, ctwa_clid, event_time) values ('${acc}', 'appt:1', 'C', now())`
      )
    await insert(acc1)
    await expect(insert(acc1)).rejects.toThrow(/unique|duplicate/)
    await insert(acc2)
  })

  it('recusa status fora da lista', async () => {
    await expect(
      db.exec(
        `insert into public.meta_conversion_events (account_id, dedup_key, ctwa_clid, event_time, status) values ('${acc1}', 'appt:2', 'C', now(), 'x')`
      )
    ).rejects.toThrow(/check/)
  })

  it('nasce pending, LeadSubmitted e com zero tentativas', async () => {
    const { rows } = await db.query<{ status: string; event_name: string; attempts: number }>(
      `select status, event_name, attempts from public.meta_conversion_events where account_id = '${acc2}'`
    )
    expect(rows[0]).toEqual({ status: 'pending', event_name: 'LeadSubmitted', attempts: 0 })
  })
})
