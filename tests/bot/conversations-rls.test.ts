import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'

// RLS real de conversations/messages/conversation_attachments depois de
// supabase/migration_bot_todas_unidades.sql: o /bot lista conversas de todas
// as unidades do usuário e as que ainda não têm unidade.

const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ids = {
  account: id(1), unitA: id(2), unitB: id(3), owner: id(4), restricted: id(5),
  otherAccount: id(6), otherUnit: id(7), outsider: id(8),
  convA: id(10), convB: id(11), convNoUnit: id(12), convOther: id(13), convOtherNoUnit: id(14),
}
let db: PGlite
let migration: string

async function asUser(userId: string) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
  await db.exec('set role authenticated')
}

async function visibleConversations(): Promise<string[]> {
  const r = await db.query<{ id: string }>('select id from public.conversations order by id')
  return r.rows.map((row) => row.id)
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(await readFile('tests/billing/fixtures/database.sql', 'utf8'))
  await db.exec(`
    create table public.conversations (
      id uuid primary key, account_id uuid not null references public.accounts,
      workspace_id uuid references public.workspaces, patient_phone text not null
    );
    create table public.messages (
      id uuid primary key default gen_random_uuid(),
      conversation_id uuid not null references public.conversations on delete cascade, content text not null
    );
    create table public.conversation_attachments (
      id uuid primary key default gen_random_uuid(),
      conversation_id uuid not null references public.conversations on delete cascade
    );
    alter table public.conversations enable row level security;
    alter table public.messages enable row level security;
    alter table public.conversation_attachments enable row level security;
    grant select, insert, update, delete on public.conversations, public.messages to authenticated;
    grant select on public.conversation_attachments to authenticated;
  `)
  migration = await readFile('supabase/migration_bot_todas_unidades.sql', 'utf8')
  await db.exec(migration)
}, 30000)

afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await db.exec('reset role; truncate public.accounts, auth.users cascade;')
  await db.exec(`
    insert into auth.users (id) values ('${ids.owner}'), ('${ids.restricted}'), ('${ids.outsider}');
    insert into public.accounts (id) values ('${ids.account}'), ('${ids.otherAccount}');
    insert into public.workspaces (id, account_id) values
      ('${ids.unitA}', '${ids.account}'), ('${ids.unitB}', '${ids.account}'), ('${ids.otherUnit}', '${ids.otherAccount}');
    insert into public.memberships (user_id, account_id, role, workspace_ids) values
      ('${ids.owner}', '${ids.account}', 'owner', null),
      ('${ids.restricted}', '${ids.account}', 'member', array['${ids.unitA}']::uuid[]),
      ('${ids.outsider}', '${ids.otherAccount}', 'owner', null);
    insert into public.conversations (id, account_id, workspace_id, patient_phone) values
      ('${ids.convA}', '${ids.account}', '${ids.unitA}', '1'),
      ('${ids.convB}', '${ids.account}', '${ids.unitB}', '2'),
      ('${ids.convNoUnit}', '${ids.account}', null, '3'),
      ('${ids.convOther}', '${ids.otherAccount}', '${ids.otherUnit}', '4'),
      ('${ids.convOtherNoUnit}', '${ids.otherAccount}', null, '5');
    insert into public.messages (conversation_id, content) values ('${ids.convNoUnit}', 'oi');
    insert into public.conversation_attachments (conversation_id) values ('${ids.convNoUnit}');
  `)
})

describe('RLS das conversas do /bot', () => {
  it('é idempotente', async () => {
    await db.exec(migration)
  })

  it('owner vê as conversas de todas as unidades e as sem unidade, só da própria account', async () => {
    await asUser(ids.owner)
    expect(await visibleConversations()).toEqual([ids.convA, ids.convB, ids.convNoUnit].sort())
  })

  it('membro restrito vê a própria unidade e as sem unidade, mas não as de outra unidade', async () => {
    await asUser(ids.restricted)
    expect(await visibleConversations()).toEqual([ids.convA, ids.convNoUnit].sort())
  })

  it('mensagens e carteirinhas de conversa sem unidade ficam visíveis para a account', async () => {
    await asUser(ids.owner)
    expect((await db.query('select content from public.messages')).rows).toEqual([{ content: 'oi' }])
    expect((await db.query('select id from public.conversation_attachments')).rows).toHaveLength(1)
    await asUser(ids.outsider)
    expect((await db.query('select content from public.messages')).rows).toEqual([])
    expect((await db.query('select id from public.conversation_attachments')).rows).toEqual([])
  })

  it('não deixa mover uma conversa sem unidade para outra account', async () => {
    await asUser(ids.owner)
    await expect(
      db.query('update public.conversations set account_id = $1 where id = $2', [ids.otherAccount, ids.convNoUnit])
    ).rejects.toThrow(/row-level security/)
  })

  it('pausar/arquivar uma conversa sem unidade funciona', async () => {
    await asUser(ids.owner)
    const r = await db.query("update public.conversations set patient_phone = '9' where id = $1 returning id", [ids.convNoUnit])
    expect(r.rows).toHaveLength(1)
  })
})
