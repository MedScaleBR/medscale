import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'

// migration_convenios_por_unidade.sql num PostgreSQL real (PGlite), em cima do
// mesmo fixture do teste de faturamento.
const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ids = {
  account: id(1), other: id(2), owner: id(3), member: id(4),
  centro: id(10), barra: id(11), inativa: id(12), outraUnidade: id(13),
  unimed: id(20), amil: id(21), outroConvenio: id(22),
}
let db: PGlite
let migration: string

async function asUser(userId: string) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false)", [userId])
  await db.exec('set role authenticated')
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(await readFile('tests/billing/fixtures/database.sql', 'utf8'))
  await db.exec(await readFile('supabase/billing.sql', 'utf8'))
  // Partes do schema real que o fixture não tem.
  await db.exec(`
    alter table public.workspaces add column is_active boolean not null default true;
    create table public.bot_config (account_id uuid primary key references public.accounts, accepts_private boolean not null default true);
    insert into auth.users (id) values ('${ids.owner}'), ('${ids.member}');
    insert into public.accounts (id, modules) values ('${ids.account}', '{}'), ('${ids.other}', '{}');
    insert into public.memberships (user_id, account_id, role) values
      ('${ids.owner}', '${ids.account}', 'owner'), ('${ids.member}', '${ids.account}', 'member');
    insert into public.bot_config (account_id, accepts_private) values ('${ids.account}', false), ('${ids.other}', true);
    insert into public.workspaces (id, account_id, is_active) values
      ('${ids.centro}', '${ids.account}', true), ('${ids.barra}', '${ids.account}', true),
      ('${ids.inativa}', '${ids.account}', false), ('${ids.outraUnidade}', '${ids.other}', true);
    insert into public.health_insurers (id, account_id, name) values
      ('${ids.unimed}', '${ids.account}', 'Unimed'), ('${ids.amil}', '${ids.account}', 'Amil'),
      ('${ids.outroConvenio}', '${ids.other}', 'Bradesco');
  `)
  migration = await readFile('supabase/migration_convenios_por_unidade.sql', 'utf8')
  await db.exec(migration)
}, 30000)

afterAll(async () => { await db?.close() })

describe('migration_convenios_por_unidade.sql', () => {
  it('cada unidade herda o "aceita particular" da account', async () => {
    const { rows } = await db.query<{ id: string; accepts_private: boolean }>('select id, accepts_private from public.workspaces')
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.accepts_private]))
    expect(byId[ids.centro]).toBe(false)
    expect(byId[ids.barra]).toBe(false)
    expect(byId[ids.outraUnidade]).toBe(true)
  })

  it('liga todo convênio existente a todas as unidades ativas da mesma account', async () => {
    const { rows } = await db.query<{ insurer_id: string; workspace_id: string }>(
      'select insurer_id, workspace_id from public.health_insurer_workspaces order by insurer_id, workspace_id'
    )
    expect(rows).toHaveLength(5)
    expect(rows).toContainEqual({ insurer_id: ids.unimed, workspace_id: ids.centro })
    expect(rows).toContainEqual({ insurer_id: ids.amil, workspace_id: ids.barra })
    expect(rows).toContainEqual({ insurer_id: ids.outroConvenio, workspace_id: ids.outraUnidade })
    expect(rows.some((r) => r.workspace_id === ids.inativa)).toBe(false)
  })

  it('reexecutar não refaz o backfill nem apaga o que a clínica mudou', async () => {
    await db.exec(`
      update public.workspaces set accepts_private = true where id = '${ids.centro}';
      delete from public.health_insurer_workspaces where insurer_id = '${ids.unimed}' and workspace_id = '${ids.barra}';
    `)
    await db.exec(migration)
    const ws = await db.query<{ accepts_private: boolean }>(`select accepts_private from public.workspaces where id = '${ids.centro}'`)
    expect(ws.rows[0].accepts_private).toBe(true)
    const link = await db.query(`select 1 from public.health_insurer_workspaces where insurer_id = '${ids.unimed}' and workspace_id = '${ids.barra}'`)
    expect(link.rows).toHaveLength(0)
  })

  it('não liga convênio a unidade de outra account', async () => {
    await expect(
      db.exec(`insert into public.health_insurer_workspaces (insurer_id, workspace_id, account_id)
               values ('${ids.unimed}', '${ids.outraUnidade}', '${ids.other}')`)
    ).rejects.toThrow(/accounts diferentes/)
  })

  it('membro só lê; owner altera os vínculos', async () => {
    await asUser(ids.member)
    const read = await db.query('select 1 from public.health_insurer_workspaces')
    expect(read.rows.length).toBeGreaterThan(0)
    await expect(
      db.exec(`insert into public.health_insurer_workspaces (insurer_id, workspace_id, account_id)
               values ('${ids.unimed}', '${ids.barra}', '${ids.account}')`)
    ).rejects.toThrow()

    await asUser(ids.owner)
    await db.exec(`insert into public.health_insurer_workspaces (insurer_id, workspace_id, account_id)
                   values ('${ids.unimed}', '${ids.barra}', '${ids.account}')`)
    const other = await db.query(`select 1 from public.health_insurer_workspaces where account_id = '${ids.other}'`)
    expect(other.rows).toHaveLength(0)
    await db.exec('reset role')
  })
})
