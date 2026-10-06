# Autorizações TISS — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (ou superpowers:executing-plans para execução inline). Cada tarefa é independente e verificável; marque os checkboxes (`- [ ]`) ao concluir cada passo.

**Goal:** permitir que a clínica monte, gere o XML, acompanhe e registre a resposta de **Solicitações de SP/SADT**, **Solicitações de Internação** e **Anexos de Solicitação de OPME** (TISS 4.03.00), sem alterar nada do faturamento existente (guias, lotes, cron, XML `ENVIO_LOTE_GUIAS`).

**Architecture:** três tabelas novas (`tiss_authorizations`, `tiss_authorization_items`, `tiss_authorization_events`) em `supabase/tiss-authorizations.sql`, com RLS de leitura por workspace e escrita exclusivamente via RPCs `security definer` que validam membership, módulo, máquina de estados (D3) e gravam evento na mesma transação. O snapshot (`payload`) é montado em TypeScript (`lib/billing/authorizations/*`) a partir de dados lidos com o client do usuário + RPC de profissionais; o XML é gerado sob demanda (`lib/tiss/v4_03_00/*`), validado com `validateAgainstSchemas` e nunca persistido. O `cabecalho` é extraído de `buildBatch` para `envelope.ts`, travado por um golden byte a byte.

**Tech Stack:** Next.js 16.3.1 (App Router, route handlers), TypeScript estrito, Supabase (Postgres + RLS, PostgREST RPC), Vitest 4, PGlite (Postgres em WASM) para SQL real, xmllint-wasm contra os XSDs oficiais, xmlbuilder2, Tailwind + componentes `components/ui/*`.

**Spec:**
- Design (decisões finais): `docs/superpowers/specs/2026-10-05-tiss-autorizacoes-design.md`
- XSD (fonte de verdade para elementos, ordem, cardinalidade, enums): `docs/superpowers/specs/2026-10-05-tiss-autorizacoes-xsd.md`
- Diagnósticos usados: faturamento atual e RBAC (scratchpad da sessão de design).

**Branch:** `feat/tiss-autorizacoes` a partir de `dev`. Se usar worktree: rodar `npm ci` dentro dele antes de `next build`; `npm test` dentro de worktree pode contar falhas falsas; `npm run lint` estoura memória varrendo o worktree — usar lint por caminho (Tarefa 19).

---

## Restrições globais

1. **Não destrutivo.** Há usuários reais em produção. SQL só aditivo: `create table if not exists`, `create index if not exists`, `create or replace function` de funções **novas**, `drop policy/trigger if exists` + `create` **apenas em tabelas novas**. Nenhum `drop`/`alter` em `tiss_guides`, `tiss_batches`, `appointments`, `profiles`, `health_insurers` nem nas funções de faturamento (`next_tiss_number`, `ensure_tiss_guide_for_appointment`, `finalize_tiss_batch`, `mark_tiss_batch_sent`, `tiss_professional_for_appointment`). A única escrita em tabela existente é o `update health_insurers set next_guide_number = next_guide_number + 1` dentro do RPC de criação (mesmo contador, D4).
2. **Nenhuma migration é aplicada** em Supabase algum pelo agente (nem dev, nem prod, nem via MCP). O usuário roda `supabase/tiss-authorizations.sql` no SQL Editor **depois** de `supabase/billing.sql`.
3. **Faturamento intocado.** `buildBatch` produz o mesmo XML byte a byte (golden da Tarefa 1 deve continuar verde em todas as tarefas seguintes). `createBatchesForInsurer`, `chunkGuides`, cron, rotas `/api/billing/guides|batches` e `GuidesTable/GuideEditSheet/BatchesTable` não mudam de comportamento. Guias/Lotes e suas APIs continuam admin-only.
4. **Bloco "BILLING AUTHENTICATED OPERATIONS" não é tocado** em `billing.sql`, `billing-authenticated.sql` nem `schema.sql`. O teste `schema.sql.endsWith(billing-authenticated.sql)` (tests/billing/database.test.ts) obriga a inserir o bloco novo em `schema.sql` **antes** do comentário "Ajuste incremental para instalações que já executaram billing.sql." — nunca no fim do arquivo.
5. **Espelhamento:** o conteúdo entre `-- BEGIN TISS AUTHORIZATIONS` e `-- END TISS AUTHORIZATIONS` de `supabase/tiss-authorizations.sql` aparece idêntico em `supabase/schema.sql` (teste na Tarefa 4). Tipos manuais em `types/database.ts`. Fixture PGlite `tests/billing/fixtures/database.sql` ganha só as colunas `profiles.phone`/`profiles.email` (aditivo).
6. **RLS em toda tabela nova** (`enable row level security` + policy de `select` por `my_workspace_ids()`/`my_account_ids()`); `insert/update/delete/truncate` revogados de `authenticated` e `anon` (o `alter default privileges` do schema.sql dá ALL a `authenticated` em tabelas novas — o `revoke` explícito é obrigatório). Funções internas revogadas de `public, anon, authenticated`.
7. **TypeScript sem `any`** (nem `as any`). Casts só `as unknown as T` em fronteiras do Supabase, como o código atual faz com `GUIDE_COLUMNS`.
8. **Sem PHI em logs/analytics/Sentry.** Erros de RPC viram mensagens fixas; `console.error`/Sentry só com IDs. XML nunca contém nome do paciente (não existe elemento para isso na 4.03.00).
9. **Next.js 16:** antes de mexer em route handlers, `page.tsx` com `searchParams` ou `next.config.ts`, ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`, `page.md` e a doc de `outputFileTracingIncludes` em `node_modules/next/dist/docs/01-app/03-api-reference/05-config/`.
10. Commits pequenos, mensagem em português no estilo do repo (`feat(tiss): …`, `test(tiss): …`), sempre terminando com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Não abrir PR (o usuário abre).

## Foco de revisão

| # | Modo de falha provável | Onde é testado |
|---|---|---|
| 1 | **OPME apontando para pai indevido**: pai de outra account/paciente/operadora, pai que é outro OPME, pai cancelado, pai de workspace que o usuário não enxerga, SP/SADT com `parent_id`, OPME sem `parent_id`. | Tarefa 2 (trigger + CHECK, insert direto como superuser) e Tarefa 3 (RPC `create_tiss_authorization` como member). |
| 2 | **Autorização vazando para o faturamento**: linha entrando em `createBatchesForInsurer`, contador `next_guide_number` gerando número repetido (`UNIQUE(insurer_id, provider_guide_number)` em `tiss_guides`), `ensure_tiss_guide_for_appointment` quebrando para agendamento que já tem autorização, XML de lote mudando. | Tarefa 1 (golden), Tarefa 3 (PGlite: autorização + guia na mesma operadora, consulta do lote só vê guias), Tarefa 8 (golden após extrair `cabecalho`), Tarefa 12 (rota não toca `tiss_guides`). |
| 3 | **Texto acima do `maxLength` do XSD / opcional vazio emitido como `<x></x>` / identificador truncado**: observação de 1001 caracteres, indicação clínica só com espaços, carteirinha de 21 dígitos cortada para 20 (vira outro beneficiário), CID com ponto. | Tarefa 7 (validação rejeita acima do limite), Tarefas 9 e 10 (gerador corta texto livre, omite opcional vazio, nunca corta identificador — XSD reprova). |
| 4 | **Caracteres especiais e hash ISO-8859-1**: `&`, `<`, acentos, emoji, "Erdős", quebra de linha em justificativa; hash do epílogo divergente do arquivo. | Tarefas 9 e 10 (`hashFromFile` recalculado do arquivo, `&amp;`, descarte de fora do Latin-1). |
| 5 | **Corrida de status / edição depois de enviado**: dois usuários editando (`updated_at` defasado), editar/recarregar após `sent`, membro cancelando após envio, membro registrando resposta "6 - cancelada", `updated_at` perdendo microssegundos ao passar por `new Date()` no client. | Tarefa 3 (PGlite: `tiss_authorization_changed`, `not_editable`, `forbidden`), Tarefas 13–14 (rotas repassam `expected_updated_at` como string, 409/403 sem chamar RPC). |

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `.gitattributes` | modificar | `tests/tiss/golden/*.xml binary` (sem conversão de fim de linha). |
| `tests/tiss/golden.test.ts` + `tests/tiss/golden/*.xml` | criar | Golden byte a byte de `buildBatch` (consulta e SP/SADT). |
| `supabase/tiss-authorizations.sql` | criar | Migração idempotente: tabelas, CHECKs, triggers, RLS, grants, RPCs. |
| `supabase/schema.sql` | modificar | Reset (drops das tabelas/funções novas) + bloco espelhado antes do bloco authenticated. |
| `tests/billing/fixtures/database.sql` | modificar | `profiles.phone`, `profiles.email`. |
| `tests/billing/authorizations-database.test.ts` | criar | PGlite: RLS, triggers, RPCs, máquina de estados, faturamento intacto, espelho do schema. |
| `types/database.ts` | modificar | Tipos `TissAuthorization*`, 3 tabelas, 7 funções RPC. |
| `lib/billing/authorizations/domains.ts` | criar | Enumerações `dm_*` do XSD (código → rótulo) e guarda `isCode`. |
| `lib/billing/authorizations/types.ts` | criar | Payload por tipo, itens, linhas, campos faltantes. |
| `lib/billing/authorizations/constants.ts` | criar | Rótulos, colunas de select, limites. |
| `lib/billing/authorizations/status.ts` | criar | Máquina de estados (D3) no client/API, mapeamento `dm_statusSolicitacao`. |
| `lib/billing/authorizations/payload.ts` | criar | Snapshot, defaults por tipo, merge do "Recarregar dados", edições. |
| `lib/billing/authorizations/missing.ts` | criar | `computeAuthorizationMissing`. |
| `lib/billing/authorizations/validation.ts` | criar | Parse/validação dos corpos (criação, conteúdo, itens, resposta). |
| `lib/billing/authorizations/sources.ts` | criar | Carga (client do usuário + RPC) das fontes do snapshot e do contexto de criação. |
| `lib/billing/authorizations/edit.ts` | criar | Ponte tipada payload "qualquer tipo" ↔ funções genéricas (inicial, refresh, patch). |
| `lib/billing/authorizations/detail.ts` | criar | Detalhe (linha + itens + pai + filhos OPME) com o client do usuário. |
| `lib/billing/tabs.ts` | criar | Abas de `/faturamento` por papel. |
| `lib/billing/authorizations/rpc-errors.ts` | criar | Erro de RPC → `NextResponse` com mensagem fixa. |
| `lib/billing/authorizations/xml.ts` | criar | Monta as fontes do XML a partir das linhas, escolhe o OPME embutido, valida, registra evento. |
| `lib/tiss/v4_03_00/envelope.ts` | criar | `cabecalho()` parametrizado e `mensagemTISS()` (hash + serialização). |
| `lib/tiss/v4_03_00/batch.ts` | modificar | Usa `envelope.ts`; saída idêntica. |
| `lib/tiss/v4_03_00/authorization-common.ts` | criar | `clip`, `optText`, `optId`, beneficiário, profissional, procedimento, etapa/validação. |
| `lib/tiss/v4_03_00/annex-opme.ts` | criar | `ctm_anexoSolicitacaoOPME` (embutido e avulso). |
| `lib/tiss/v4_03_00/request-sp-sadt.ts` | criar | `ctm_sp-sadtSolicitacaoGuia`. |
| `lib/tiss/v4_03_00/request-hospitalization.ts` | criar | `ctm_internacaoSolicitacaoGuia`. |
| `lib/tiss/v4_03_00/authorization-messages.ts` | criar | Mensagens `SOLICITACAO_PROCEDIMENTOS` e `ENVIO_ANEXO`. |
| `tests/tiss/hash-from-file.ts` | criar | Recalcula o hash a partir do arquivo (helper de teste). |
| `tests/tiss/authorization-fixtures.ts` | criar | Payloads/itens fictícios das solicitações. |
| `tests/tiss/authorization-xml.test.ts` | criar | XSD real para os três tipos, encoding, limites, itens múltiplos, OPME embutido. |
| `tests/billing/authorizations-domain.test.ts` | criar | Status, payload, missing, validação. |
| `tests/billing/authorizations-server.test.ts` | criar | Montagem do XML (OPME embutido), erros de RPC, edição tipada, contexto de criação. |
| `tests/billing/authorizations-api.test.ts` | criar | Rotas com mock do Supabase, permissões, filtros, XML. |
| `tests/tiss/envelope.test.ts` | criar | `cabecalho`/`mensagemTISS` parametrizados. |
| `app/api/billing/authorizations/route.ts` | criar | GET lista com filtros, POST cria. |
| `app/api/billing/authorizations/professionals/route.ts` | criar | GET profissionais da account (RPC). |
| `app/api/billing/authorizations/[id]/route.ts` | criar | GET detalhe, PATCH conteúdo/refresh. |
| `app/api/billing/authorizations/[id]/items/route.ts` | criar | PUT substitui itens. |
| `app/api/billing/authorizations/[id]/transitions/route.ts` | criar | POST `sent`/`cancelled`. |
| `app/api/billing/authorizations/[id]/response/route.ts` | criar | POST resposta manual (D6). |
| `app/api/billing/authorizations/[id]/events/route.ts` | criar | GET histórico. |
| `app/api/billing/authorizations/[id]/xml/route.ts` | criar | GET download do XML gerado sob demanda. |
| `next.config.ts` | modificar | XSDs no trace da rota de XML. |
| `lib/nav/tabs.ts`, `tests/nav/tabs.test.ts` | modificar | Rótulo "Convênios / TISS"; `billing` sai de `ADMIN_MIN_MODULES`. |
| `app/(dashboard)/faturamento/page.tsx` | modificar | Member entra; abas Autorizações (todos) / Guias / Lotes (owner/admin). |
| `components/billing/authorizations/*.tsx` | criar | Tabela, diálogo de criação, sheet de edição, editor de itens, resposta, histórico, badges. |
| `components/agenda/AppointmentModal.tsx` | modificar | Atalho "Solicitar autorização" na seção de convênio. |
| `docs/billing-tiss.md` | modificar | Instalação (`tiss-authorizations.sql`) e uso. |

---

## Tarefa 1 — Linha de base: golden de `buildBatch` e suíte atual

**Modelo sugerido:** haiku

**Files:** criar `tests/tiss/golden.test.ts`, `tests/tiss/golden/lote-consulta-3.xml`, `tests/tiss/golden/lote-sp-sadt-2.xml`; modificar `.gitattributes`.

**Interfaces:**
- Consumes: `buildBatch(input: BatchInput): BuiltBatch` (`lib/tiss/v4_03_00/batch.ts`), `fakeGuides(count, guideType)`, `FAKE_INSURER`, `FIXED_NOW` (`tests/tiss/fixtures.ts`).
- Produces: arquivos golden que as Tarefas 8–10 não podem alterar.

- [ ] **1.1 Teste que falha (golden ainda não existe).** Criar `tests/tiss/golden.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { buildBatch } from '@/lib/tiss/v4_03_00/batch'
import type { GuideType } from '@/lib/billing/types'
import { fakeGuides, FAKE_INSURER, FIXED_NOW } from './fixtures'

// Trava a saída de buildBatch byte a byte antes da extração do cabecalho
// para as autorizações TISS. Regerar só de propósito: UPDATE_GOLDEN=1.
const CASES: Array<{ type: GuideType; count: number; file: string }> = [
  { type: 'consulta', count: 3, file: 'tests/tiss/golden/lote-consulta-3.xml' },
  { type: 'sp_sadt', count: 2, file: 'tests/tiss/golden/lote-sp-sadt-2.xml' },
]

function build(type: GuideType, count: number) {
  const guides = fakeGuides(count, type)
  if (type === 'sp_sadt') {
    // Cobre dadosAutorizacao e escape de & e < no mesmo arquivo.
    guides[0].payload.service.authorization_number = 'SENHA123'
    guides[0].payload.service.authorization_date = '2026-09-20'
    guides[1].payload.provider.legal_name = 'Silva & Souza <Clínica> Ltda'
  }
  return buildBatch({ batchNumber: 7, guideType: type, insurer: FAKE_INSURER, guides, now: FIXED_NOW })
}

describe('buildBatch — golden byte a byte', () => {
  it.each(CASES)('lote $type com $count guias é idêntico ao arquivo de referência', async ({ type, count, file }) => {
    const { xml } = build(type, count)
    if (process.env.UPDATE_GOLDEN === '1') {
      await mkdir('tests/tiss/golden', { recursive: true })
      await writeFile(file, xml)
    }
    const golden = await readFile(file)
    expect(xml.equals(golden)).toBe(true)
  })
})
```

- [ ] **1.2 Rodar e ver falhar (ENOENT):** `npx vitest run tests/tiss/golden.test.ts` → 2 falhas "no such file".
- [ ] **1.3 Gerar os golden UMA vez, no código atual (antes de qualquer refatoração):** `UPDATE_GOLDEN=1 npx vitest run tests/tiss/golden.test.ts`. Conferir que os dois arquivos começam com `<?xml version="1.0" encoding="ISO-8859-1"?>` e contêm `ENVIO_LOTE_GUIAS` (`head -c 200 tests/tiss/golden/lote-consulta-3.xml`).
- [ ] **1.4 Proteger contra conversão de fim de linha:** acrescentar ao fim de `.gitattributes` a linha `tests/tiss/golden/*.xml binary`.
- [ ] **1.5 Rodar sem a variável e ver passar:** `npx vitest run tests/tiss/golden.test.ts tests/tiss/batch.test.ts` → verde.
- [ ] **1.6 Linha de base registrada (não commitar o registro):** rodar e anotar contagens/falhas preexistentes no resumo da tarefa:
  - `npx tsc --noEmit`
  - `npx vitest run tests/billing tests/tiss tests/nav`
  - `npx vitest run --maxWorkers=2` (suíte completa; timeouts do agente financeiro já ocorreram antes — anotar, não corrigir).
- [ ] **1.7 Commit:**

```bash
git add .gitattributes tests/tiss/golden.test.ts tests/tiss/golden
git commit -m "test(tiss): golden byte a byte do lote ENVIO_LOTE_GUIAS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 2 — SQL parte 1: tabelas, constraints, triggers, RLS e grants

**Modelo sugerido:** opus

**Files:** criar `supabase/tiss-authorizations.sql`, `tests/billing/authorizations-database.test.ts`; modificar `tests/billing/fixtures/database.sql`.

**Interfaces:**
- Consumes (já existentes): `public.accounts(modules)`, `public.workspaces`, `public.patients`, `public.health_insurers`, `public.appointments`, `public.profiles`, `public.my_workspace_ids()`, `public.my_account_ids()`, `public.is_account_admin(uuid)`, `public.handle_updated_at()`.
- Produces (SQL):
  - tabelas `public.tiss_authorizations`, `public.tiss_authorization_items`, `public.tiss_authorization_events`;
  - triggers `enforce_tiss_authorization()`, `enforce_tiss_authorization_item()`, `enforce_tiss_authorization_event()`;
  - policies de leitura; grants.
  - Chaves de erro (mensagem exata do `raise`): `tiss_authorization_account_mismatch`, `tiss_authorization_appointment_mismatch`, `tiss_authorization_parent_invalid`, `tiss_authorization_immutable`, `tiss_authorization_item_kind`, `tiss_authorization_events_append_only`.

- [ ] **2.1 Fixture aditiva.** Em `tests/billing/fixtures/database.sql`, trocar a linha da tabela `profiles` por:

```sql
create table public.profiles (id uuid primary key references auth.users, full_name text not null, crm text, phone text, email text);
```

Rodar `npx vitest run tests/billing/database.test.ts` → continua verde (colunas extras não afetam os inserts existentes).

- [ ] **2.2 Teste que falha.** Criar `tests/billing/authorizations-database.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'

const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ids = {
  account: id(1), workspace: id(2), doctor: id(3), member: id(4), owner: id(5), patient: id(6), insurer: id(7),
  insurance: id(8), appointment: id(9), otherAccount: id(10), otherWorkspace: id(11), otherPatient: id(12),
  otherInsurer: id(13), outsider: id(14), patient2: id(15), procedure: id(16), workspace2: id(17),
}
let db: PGlite
let migration: string

async function asUser(userId: string, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [userId, role])
  await db.exec(`set role ${role}`)
}

async function asSuperuser() {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false)")
}

function payload(type: string) {
  return {
    type,
    insurer: { ans_registry: '999999', provider_code: 'PREST0001', tiss_version: '4.03.00' },
    provider: { cnes: '1234567', cnpj: '12345678000199', legal_name: 'Clínica Fictícia' },
    professional: { id: ids.doctor, name: 'Dra. Fictícia', crm: '123456', crm_uf: 'SP', cbo_code: '225125', phone: '11999990000', email: null },
    beneficiary: { patient_insurance_id: ids.insurance, card_number: 'FICT-CARD-001', newborn: false },
    request: {},
  }
}

// Insere direto como superuser — exercita CHECKs e triggers sem passar pelos RPCs.
async function insertRaw(row: {
  id: string; type: string; number: string; parent?: string | null; patient?: string; insurer?: string
  account?: string; workspace?: string; appointment?: string | null; status?: string; missing?: string[]
}) {
  await asSuperuser()
  await db.query(
    `insert into public.tiss_authorizations (id, account_id, workspace_id, patient_id, insurer_id, appointment_id,
       parent_id, type, status, provider_guide_number, payload, missing_fields)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, array(select jsonb_array_elements_text($12::jsonb)))`,
    [row.id, row.account ?? ids.account, row.workspace ?? ids.workspace, row.patient ?? ids.patient,
     row.insurer ?? ids.insurer, row.appointment ?? null, row.parent ?? null, row.type, row.status ?? 'draft',
     row.number, JSON.stringify(payload(row.type)), JSON.stringify(row.missing ?? ['items'])],
  )
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(await readFile('tests/billing/fixtures/database.sql', 'utf8'))
  await db.exec(await readFile('supabase/billing.sql', 'utf8'))
  migration = await readFile('supabase/tiss-authorizations.sql', 'utf8')
  await db.exec(migration)
}, 30000)

afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await asSuperuser()
  await db.exec('truncate public.accounts, auth.users cascade;')
  await db.exec(`
    insert into auth.users (id) values ('${ids.doctor}'), ('${ids.member}'), ('${ids.owner}'), ('${ids.outsider}');
    insert into public.accounts (id, modules) values ('${ids.account}', array['billing']), ('${ids.otherAccount}', array['billing']);
    insert into public.workspaces (id, account_id, cnes, cnpj, legal_name) values
      ('${ids.workspace}', '${ids.account}', '1234567', '12345678000199', 'Clínica Fictícia'),
      ('${ids.workspace2}', '${ids.account}', '7654321', null, 'Unidade Dois'),
      ('${ids.otherWorkspace}', '${ids.otherAccount}', '1111111', null, 'Outra Clínica');
    insert into public.profiles (id, full_name, crm, crm_uf, cbo_code, phone, email) values
      ('${ids.doctor}', 'Dra. Fictícia', '123456/SP', 'SP', '225125', '11999990000', 'dra@exemplo.test'),
      ('${ids.member}', 'Recepção Fictícia', null, null, null, '11888880000', null),
      ('${ids.owner}', 'Gestão Fictícia', null, null, null, null, null),
      ('${ids.outsider}', 'Dr. De Fora', '999999', 'RJ', '225125', null, null);
    insert into public.memberships (user_id, account_id, role) values
      ('${ids.doctor}', '${ids.account}', 'member'), ('${ids.member}', '${ids.account}', 'member'),
      ('${ids.owner}', '${ids.account}', 'owner'), ('${ids.outsider}', '${ids.otherAccount}', 'owner');
    insert into public.patients (id, account_id, full_name) values
      ('${ids.patient}', '${ids.account}', 'Paciente Fictício'), ('${ids.patient2}', '${ids.account}', 'Paciente Dois'),
      ('${ids.otherPatient}', '${ids.otherAccount}', 'Paciente De Fora');
    insert into public.health_insurers (id, account_id, name, ans_registry, provider_code) values
      ('${ids.insurer}', '${ids.account}', 'Operadora Fictícia', '999999', 'PREST0001'),
      ('${ids.otherInsurer}', '${ids.otherAccount}', 'Operadora De Fora', '888888', 'PREST0002');
    insert into public.insurer_procedures (id, insurer_id, account_id, tuss_code, description, price_cents, guide_type) values
      ('${ids.procedure}', '${ids.insurer}', '${ids.account}', '10101012', 'Consulta', 15000, 'consulta');
    insert into public.patient_insurances (id, account_id, patient_id, insurer_id, card_number) values
      ('${ids.insurance}', '${ids.account}', '${ids.patient}', '${ids.insurer}', 'FICT-CARD-001');
    insert into public.appointments (id, account_id, workspace_id, doctor_id, patient_id, patient_name, scheduled_at,
      status, billing_type, insurer_id, insurer_procedure_id, patient_insurance_id) values
      ('${ids.appointment}', '${ids.account}', '${ids.workspace}', '${ids.doctor}', '${ids.patient}', 'Paciente Fictício',
       '2026-10-05T13:00:00Z', 'agendado', 'convenio', '${ids.insurer}', '${ids.procedure}', '${ids.insurance}');
  `)
})

describe('tiss-authorizations.sql — estrutura, RLS e integridade', () => {
  it('é idempotente', async () => {
    await expect(db.exec(migration)).resolves.toBeDefined()
  })

  it('membro lê só autorizações dos próprios workspaces e da própria account', async () => {
    await insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1' })
    await insertRaw({ id: id(101), type: 'sp_sadt_request', number: '1', account: ids.otherAccount,
      workspace: ids.otherWorkspace, patient: ids.otherPatient, insurer: ids.otherInsurer })
    await asUser(ids.member)
    expect((await db.query<{ id: string }>('select id from public.tiss_authorizations')).rows.map((r) => r.id)).toEqual([id(100)])
    await asUser(ids.outsider)
    expect((await db.query<{ id: string }>('select id from public.tiss_authorizations')).rows.map((r) => r.id)).toEqual([id(101)])
    await asSuperuser()
    await db.exec(`update public.memberships set workspace_ids = '{}' where user_id = '${ids.member}'`)
    await asUser(ids.member)
    expect((await db.query('select id from public.tiss_authorizations')).rows).toEqual([])
  })

  it('ninguém escreve direto nas tabelas (só via RPC)', async () => {
    await insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1' })
    await asUser(ids.owner)
    await expect(db.query(`update public.tiss_authorizations set status = 'sent'`)).rejects.toThrow(/permission denied/)
    await expect(db.query(`delete from public.tiss_authorizations`)).rejects.toThrow(/permission denied/)
    await expect(db.query(`insert into public.tiss_authorization_events (authorization_id, account_id, event) values ($1, $2, 'sent')`,
      [id(100), ids.account])).rejects.toThrow(/permission denied/)
  })

  it('OPME exige pai SP/SADT ou Internação da mesma account, paciente e operadora', async () => {
    await insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1' })
    await insertRaw({ id: id(101), type: 'hospitalization_request', number: '2' })
    await insertRaw({ id: id(102), type: 'opme_request', number: '3', parent: id(100) })
    await insertRaw({ id: id(103), type: 'opme_request', number: '4', parent: id(101) })
    // pai é outro OPME
    await expect(insertRaw({ id: id(104), type: 'opme_request', number: '5', parent: id(102) })).rejects.toThrow('tiss_authorization_parent_invalid')
    // paciente diferente do pai
    await expect(insertRaw({ id: id(105), type: 'opme_request', number: '6', parent: id(100), patient: ids.patient2 })).rejects.toThrow('tiss_authorization_parent_invalid')
    // pai de outra account
    await insertRaw({ id: id(106), type: 'sp_sadt_request', number: '1', account: ids.otherAccount,
      workspace: ids.otherWorkspace, patient: ids.otherPatient, insurer: ids.otherInsurer })
    await expect(insertRaw({ id: id(107), type: 'opme_request', number: '7', parent: id(106) })).rejects.toThrow('tiss_authorization_parent_invalid')
    // OPME sem pai e SP/SADT com pai: CHECK
    await expect(insertRaw({ id: id(108), type: 'opme_request', number: '8' })).rejects.toThrow(/tiss_authorizations_parent_by_type/)
    await expect(insertRaw({ id: id(109), type: 'sp_sadt_request', number: '9', parent: id(100) })).rejects.toThrow(/tiss_authorizations_parent_by_type/)
  })

  it('paciente, operadora, unidade e agendamento precisam ser da mesma account', async () => {
    await expect(insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1', patient: ids.otherPatient })).rejects.toThrow('tiss_authorization_account_mismatch')
    await expect(insertRaw({ id: id(101), type: 'sp_sadt_request', number: '2', insurer: ids.otherInsurer })).rejects.toThrow('tiss_authorization_account_mismatch')
    await expect(insertRaw({ id: id(102), type: 'sp_sadt_request', number: '3', patient: ids.patient2, appointment: ids.appointment })).rejects.toThrow('tiss_authorization_appointment_mismatch')
  })

  it('número do prestador é único por operadora; vários por agendamento são permitidos', async () => {
    await insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1', appointment: ids.appointment })
    await insertRaw({ id: id(101), type: 'hospitalization_request', number: '2', appointment: ids.appointment })
    await expect(insertRaw({ id: id(102), type: 'sp_sadt_request', number: '1' })).rejects.toThrow(/tiss_authorizations_insurer_number_key/)
  })

  it('draft/ready coerentes com missing_fields', async () => {
    await expect(insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1', status: 'ready', missing: ['items'] })).rejects.toThrow(/tiss_authorizations_ready_complete/)
    await expect(insertRaw({ id: id(101), type: 'sp_sadt_request', number: '2', status: 'draft', missing: [] })).rejects.toThrow(/tiss_authorizations_draft_incomplete/)
  })

  it('colunas de identidade são imutáveis; agendamento apagado só zera a referência', async () => {
    await insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1', appointment: ids.appointment })
    await expect(db.query(`update public.tiss_authorizations set type = 'hospitalization_request' where id = $1`, [id(100)])).rejects.toThrow('tiss_authorization_immutable')
    await expect(db.query(`update public.tiss_authorizations set provider_guide_number = '99' where id = $1`, [id(100)])).rejects.toThrow('tiss_authorization_immutable')
    await db.query('delete from public.appointments where id = $1', [ids.appointment])
    expect((await db.query<{ appointment_id: string | null }>('select appointment_id from public.tiss_authorizations')).rows[0].appointment_id).toBeNull()
  })

  it('itens: account forçada, tipo compatível, posição única', async () => {
    await insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1' })
    await insertRaw({ id: id(101), type: 'opme_request', number: '2', parent: id(100) })
    await db.query(`insert into public.tiss_authorization_items (authorization_id, account_id, position, kind, table_code, code, description, quantity_requested)
      values ($1, $2, 1, 'procedure', '22', '40301010', 'Hemograma', 1), ($1, $2, 2, 'procedure', '22', '40302040', 'Glicose', 2)`, [id(100), ids.otherAccount])
    expect((await db.query<{ account_id: string }>('select distinct account_id from public.tiss_authorization_items')).rows).toEqual([{ account_id: ids.account }])
    await expect(db.query(`insert into public.tiss_authorization_items (authorization_id, account_id, position, kind, table_code, code, description, quantity_requested)
      values ($1, $2, 3, 'procedure', '22', 'X', 'Y', 1)`, [id(101), ids.account])).rejects.toThrow('tiss_authorization_item_kind')
    await expect(db.query(`insert into public.tiss_authorization_items (authorization_id, account_id, position, kind, table_code, code, description, quantity_requested)
      values ($1, $2, 1, 'opme', '19', 'X', 'Y', 1)`, [id(101), ids.account])).rejects.toThrow(/tiss_authorization_items_opme_fields/)
    await expect(db.query(`insert into public.tiss_authorization_items (authorization_id, account_id, position, kind, table_code, code, description, quantity_requested)
      values ($1, $2, 1, 'procedure', '22', 'X', 'Y', 1)`, [id(100), ids.account])).rejects.toThrow(/tiss_authorization_items_position_key/)
    await expect(db.query(`insert into public.tiss_authorization_items (authorization_id, account_id, position, kind, table_code, code, description, quantity_requested)
      values ($1, $2, 3, 'procedure', '21', 'X', 'Y', 1)`, [id(100), ids.account])).rejects.toThrow(/table_code/)
  })

  it('eventos são append-only, mas a exclusão do usuário só zera o autor', async () => {
    await insertRaw({ id: id(100), type: 'sp_sadt_request', number: '1' })
    await db.query(`insert into public.tiss_authorization_events (authorization_id, account_id, event, actor_id) values ($1, $2, 'created', $3)`,
      [id(100), ids.otherAccount, ids.member])
    expect((await db.query<{ account_id: string }>('select account_id from public.tiss_authorization_events')).rows[0].account_id).toBe(ids.account)
    await expect(db.query(`update public.tiss_authorization_events set event = 'sent'`)).rejects.toThrow('tiss_authorization_events_append_only')
    await db.query('delete from public.profiles where id = $1', [ids.member])
    expect((await db.query<{ actor_id: string | null }>('select actor_id from public.tiss_authorization_events')).rows[0].actor_id).toBeNull()
  })
})
```

> Observação: no fixture `profiles.id` referencia `auth.users` sem `on delete cascade`; por isso o teste apaga o profile diretamente. O que importa é o `on delete set null` de `actor_id` passar pelo trigger append-only.

- [ ] **2.3 Rodar e ver falhar:** `npx vitest run tests/billing/authorizations-database.test.ts` → falha no `beforeAll` (arquivo SQL inexistente).

- [ ] **2.4 Implementar `supabase/tiss-authorizations.sql` (parte 1).** Conteúdo completo do arquivo nesta tarefa (a Tarefa 3 acrescenta a seção 5 antes do `-- END`):

```sql
-- Migração incremental: Autorizações TISS 4.03.00 — Solicitação de SP/SADT,
-- Solicitação de Internação e Anexo de Solicitação de OPME (módulo "billing").
--
-- Rode no SQL Editor do Supabase DEPOIS de supabase/billing.sql. NÃO rode
-- supabase/schema.sql inteiro: aquele arquivo é "drop and recreate".
-- Idempotente e aditiva: cria só tabelas, funções, triggers e policies novas.
-- Não altera tiss_guides, tiss_batches, appointments, profiles nem as funções
-- do faturamento. A única escrita em tabela existente é o incremento de
-- health_insurers.next_guide_number dentro de create_tiss_authorization (o
-- mesmo contador das guias, com o mesmo lock de linha).
--
-- O bloco entre BEGIN/END abaixo está idêntico em supabase/schema.sql
-- (tests/billing/authorizations-database.test.ts confere).

-- BEGIN TISS AUTHORIZATIONS

-- ============================================================
-- 1. TABELAS
-- ============================================================
-- Cabeçalho da solicitação. A "categoria" é a própria tabela: autorizações
-- nunca entram em tiss_guides, então createBatchesForInsurer não as enxerga.
-- patient_id/insurer_id/parent_id usam NO ACTION (padrão) e não RESTRICT: ao
-- apagar uma account, a cascata remove paciente, operadora e autorizações no
-- mesmo comando, e NO ACTION só confere no fim do comando.
create table if not exists public.tiss_authorizations (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts(id) on delete cascade,
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  patient_id            uuid not null references public.patients(id),
  insurer_id            uuid not null references public.health_insurers(id),
  appointment_id        uuid references public.appointments(id) on delete set null,
  parent_id             uuid references public.tiss_authorizations(id),
  type                  text not null
                        check (type in ('sp_sadt_request','hospitalization_request','opme_request')),
  status                text not null default 'draft'
                        check (status in ('draft','ready','sent','under_review','pending_info',
                                          'authorized','partially_authorized','denied','cancelled')),
  -- next_guide_number da operadora; vira numeroGuiaPrestador (st_texto20),
  -- sequencialTransacao e numeroLote do anexo (st_texto12).
  provider_guide_number text not null check (provider_guide_number ~ '^[0-9]{1,12}$'),
  payload               jsonb not null check (jsonb_typeof(payload) = 'object'),
  missing_fields        text[] not null default '{}',
  -- Resposta da operadora (D6, registrada à mão). Tamanhos do XSD (st_texto20).
  operator_guide_number text check (operator_guide_number is null or char_length(operator_guide_number) between 1 and 20),
  password              text check (password is null or char_length(password) between 1 and 20),
  authorization_date    date,
  password_valid_until  date,
  response_status_code  text check (response_status_code is null or response_status_code in ('1','2','3','4','5','6','7')),
  requested_at          date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  sent_at               timestamptz,
  responded_at          timestamptz,
  created_by            uuid references public.profiles(id) on delete set null,
  updated_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint tiss_authorizations_insurer_number_key unique (insurer_id, provider_guide_number),
  constraint tiss_authorizations_parent_by_type check ((type = 'opme_request') = (parent_id is not null)),
  constraint tiss_authorizations_parent_not_self check (parent_id is distinct from id),
  constraint tiss_authorizations_ready_complete check (status <> 'ready' or cardinality(missing_fields) = 0),
  constraint tiss_authorizations_draft_incomplete check (status <> 'draft' or cardinality(missing_fields) > 0)
);

-- Procedimentos (SP/SADT, Internação) ou materiais (OPME) solicitados.
-- Limites = XSD: codigoTabela dm_tabela, codigoProcedimento st_texto10,
-- descricaoProcedimento st_texto150, quantidadeSolicitada st_numerico3,
-- valorSolicitado st_decimal10-2 (até 99.999.999,99), registroANVISA
-- st_texto15, codigoRefFabricante st_texto60, autorizacaoFuncionamento st_texto30.
create table if not exists public.tiss_authorization_items (
  id                      uuid primary key default gen_random_uuid(),
  authorization_id        uuid not null references public.tiss_authorizations(id) on delete cascade,
  account_id              uuid not null references public.accounts(id) on delete cascade,
  position                int  not null check (position between 1 and 999),
  kind                    text not null check (kind in ('procedure','opme')),
  table_code              text not null check (table_code in ('00','18','19','20','22','90','98')),
  code                    text not null check (char_length(code) between 1 and 10),
  description             text not null check (char_length(description) between 1 and 150),
  quantity_requested      int  not null check (quantity_requested between 1 and 999),
  quantity_authorized     int  check (quantity_authorized between 0 and 999),
  manufacturer_option     text check (manufacturer_option in ('1','2','3')),
  requested_value_cents   bigint check (requested_value_cents between 0 and 9999999999),
  authorized_value_cents  bigint check (authorized_value_cents between 0 and 9999999999),
  anvisa_registration     text check (char_length(anvisa_registration) between 1 and 15),
  manufacturer_reference  text check (char_length(manufacturer_reference) between 1 and 60),
  operating_authorization text check (char_length(operating_authorization) between 1 and 30),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint tiss_authorization_items_position_key unique (authorization_id, position),
  constraint tiss_authorization_items_opme_fields check (
    (kind = 'opme' and manufacturer_option is not null)
    or (kind = 'procedure' and manufacturer_option is null and requested_value_cents is null
        and authorized_value_cents is null and anvisa_registration is null
        and manufacturer_reference is null and operating_authorization is null)
  )
);

-- Histórico append-only. data: só números/senha devolvidos pela operadora e
-- metadados (tipo, contagem, hash) — nada de nome, carteirinha ou CID.
create table if not exists public.tiss_authorization_events (
  id               bigint generated always as identity primary key,
  authorization_id uuid not null references public.tiss_authorizations(id) on delete cascade,
  account_id       uuid not null references public.accounts(id) on delete cascade,
  event            text not null check (event in ('created','updated','items_changed','refreshed','ready',
                                                  'sent','response_recorded','cancelled','xml_generated')),
  from_status      text,
  to_status        text,
  actor_id         uuid references public.profiles(id) on delete set null,
  data             jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at       timestamptz not null default now()
);

create index if not exists idx_tiss_authorizations_account_status
  on public.tiss_authorizations(account_id, status, requested_at desc);
create index if not exists idx_tiss_authorizations_patient on public.tiss_authorizations(patient_id);
create index if not exists idx_tiss_authorizations_parent
  on public.tiss_authorizations(parent_id) where parent_id is not null;
create index if not exists idx_tiss_authorizations_appointment
  on public.tiss_authorizations(appointment_id) where appointment_id is not null;
create index if not exists idx_tiss_authorization_events_authorization
  on public.tiss_authorization_events(authorization_id, id);

-- ============================================================
-- 2. INTEGRIDADE (triggers)
-- ============================================================
-- Insert: paciente, operadora, unidade e agendamento da mesma account; OPME
-- só debaixo de SP/SADT ou Internação do mesmo paciente e operadora.
-- Update: identidade imutável. appointment_id e created_by só podem virar
-- null (on delete set null de appointments/profiles).
create or replace function public.enforce_tiss_authorization()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.tiss_authorizations%rowtype;
begin
  if tg_op = 'UPDATE' then
    if (new.account_id, new.workspace_id, new.patient_id, new.insurer_id, new.parent_id, new.type,
        new.provider_guide_number, new.created_at)
       is distinct from
       (old.account_id, old.workspace_id, old.patient_id, old.insurer_id, old.parent_id, old.type,
        old.provider_guide_number, old.created_at)
       or (new.appointment_id is distinct from old.appointment_id and new.appointment_id is not null)
       or (new.created_by is distinct from old.created_by and new.created_by is not null) then
      raise exception 'tiss_authorization_immutable' using errcode = '55000';
    end if;
    return new;
  end if;

  if not exists (select 1 from public.workspaces where id = new.workspace_id and account_id = new.account_id)
     or not exists (select 1 from public.patients where id = new.patient_id and account_id = new.account_id)
     or not exists (select 1 from public.health_insurers where id = new.insurer_id and account_id = new.account_id) then
    raise exception 'tiss_authorization_account_mismatch' using errcode = '23514';
  end if;
  if new.appointment_id is not null and not exists (
    select 1 from public.appointments
    where id = new.appointment_id and account_id = new.account_id
      and workspace_id = new.workspace_id and patient_id = new.patient_id
  ) then
    raise exception 'tiss_authorization_appointment_mismatch' using errcode = '23514';
  end if;
  if new.parent_id is not null then
    select * into p from public.tiss_authorizations where id = new.parent_id;
    if not found
       or p.type not in ('sp_sadt_request','hospitalization_request')
       or p.account_id <> new.account_id
       or p.patient_id <> new.patient_id
       or p.insurer_id <> new.insurer_id then
      raise exception 'tiss_authorization_parent_invalid' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;

-- Item: account sempre a da autorização; 'opme' só em opme_request e
-- 'procedure' só nas outras; o item não troca de autorização.
create or replace function public.enforce_tiss_authorization_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_type text; v_account uuid;
begin
  if tg_op = 'UPDATE' and new.authorization_id <> old.authorization_id then
    raise exception 'tiss_authorization_immutable' using errcode = '55000';
  end if;
  select type, account_id into v_type, v_account
    from public.tiss_authorizations where id = new.authorization_id;
  if not found then raise exception 'tiss_authorization_not_found' using errcode = '23503'; end if;
  new.account_id := v_account;
  if (v_type = 'opme_request') <> (new.kind = 'opme') then
    raise exception 'tiss_authorization_item_kind' using errcode = '23514';
  end if;
  return new;
end; $$;

-- Evento: account sempre a da autorização; nenhuma alteração depois de
-- gravado, exceto o "on delete set null" de actor_id quando o usuário some.
create or replace function public.enforce_tiss_authorization_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select account_id into new.account_id from public.tiss_authorizations where id = new.authorization_id;
    return new;
  end if;
  if old.actor_id is not null and new.actor_id is null
     and (new.id, new.authorization_id, new.account_id, new.event, new.from_status, new.to_status, new.data, new.created_at)
         is not distinct from
         (old.id, old.authorization_id, old.account_id, old.event, old.from_status, old.to_status, old.data, old.created_at) then
    return new;
  end if;
  raise exception 'tiss_authorization_events_append_only' using errcode = '55000';
end; $$;

drop trigger if exists trg_tiss_authorizations_enforce on public.tiss_authorizations;
create trigger trg_tiss_authorizations_enforce
  before insert or update on public.tiss_authorizations
  for each row execute procedure public.enforce_tiss_authorization();
drop trigger if exists trg_tiss_authorizations_updated_at on public.tiss_authorizations;
create trigger trg_tiss_authorizations_updated_at
  before update on public.tiss_authorizations
  for each row execute procedure public.handle_updated_at();

drop trigger if exists trg_tiss_authorization_items_enforce on public.tiss_authorization_items;
create trigger trg_tiss_authorization_items_enforce
  before insert or update on public.tiss_authorization_items
  for each row execute procedure public.enforce_tiss_authorization_item();
drop trigger if exists trg_tiss_authorization_items_updated_at on public.tiss_authorization_items;
create trigger trg_tiss_authorization_items_updated_at
  before update on public.tiss_authorization_items
  for each row execute procedure public.handle_updated_at();

drop trigger if exists trg_tiss_authorization_events_enforce on public.tiss_authorization_events;
create trigger trg_tiss_authorization_events_enforce
  before insert or update on public.tiss_authorization_events
  for each row execute procedure public.enforce_tiss_authorization_event();

-- ============================================================
-- 3. RLS — leitura por membro do workspace; escrita só pelos RPCs
-- ============================================================
alter table public.tiss_authorizations      enable row level security;
alter table public.tiss_authorization_items  enable row level security;
alter table public.tiss_authorization_events enable row level security;

drop policy if exists "tiss_authorizations: workspace members read" on public.tiss_authorizations;
create policy "tiss_authorizations: workspace members read" on public.tiss_authorizations
  for select using (
    workspace_id = any(public.my_workspace_ids()) and account_id = any(public.my_account_ids())
  );

drop policy if exists "tiss_authorization_items: workspace members read" on public.tiss_authorization_items;
create policy "tiss_authorization_items: workspace members read" on public.tiss_authorization_items
  for select using (
    account_id = any(public.my_account_ids()) and exists (
      select 1 from public.tiss_authorizations a
      where a.id = tiss_authorization_items.authorization_id and a.workspace_id = any(public.my_workspace_ids())
    )
  );

drop policy if exists "tiss_authorization_events: workspace members read" on public.tiss_authorization_events;
create policy "tiss_authorization_events: workspace members read" on public.tiss_authorization_events
  for select using (
    account_id = any(public.my_account_ids()) and exists (
      select 1 from public.tiss_authorizations a
      where a.id = tiss_authorization_events.authorization_id and a.workspace_id = any(public.my_workspace_ids())
    )
  );

-- ============================================================
-- 4. GRANTS — o schema.sql dá ALL em tabelas novas a authenticated por
-- default privileges; aqui fica só SELECT (a RLS filtra). Sem anon.
-- ============================================================
revoke all on public.tiss_authorizations, public.tiss_authorization_items, public.tiss_authorization_events from anon;
revoke insert, update, delete, truncate on
  public.tiss_authorizations, public.tiss_authorization_items, public.tiss_authorization_events from authenticated;
grant select on
  public.tiss_authorizations, public.tiss_authorization_items, public.tiss_authorization_events to authenticated;
grant all on
  public.tiss_authorizations, public.tiss_authorization_items, public.tiss_authorization_events to service_role;

-- END TISS AUTHORIZATIONS
```

- [ ] **2.5 Rodar e ver passar:** `npx vitest run tests/billing/authorizations-database.test.ts tests/billing/database.test.ts` → verde. Se o PGlite reclamar de `jsonb_array_elements_text` em `array(...)`, conferir o cast `$12::jsonb` (não trocar por array JS).
- [ ] **2.6 Commit:**

```bash
git add supabase/tiss-authorizations.sql tests/billing/authorizations-database.test.ts tests/billing/fixtures/database.sql
git commit -m "feat(tiss): tabelas de autorizações com RLS, integridade de OPME e eventos append-only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 3 — SQL parte 2: RPCs e máquina de estados (D3/D4/D6)

**Modelo sugerido:** opus

**Files:** modificar `supabase/tiss-authorizations.sql` (nova seção 5, antes de `-- END TISS AUTHORIZATIONS`), `tests/billing/authorizations-database.test.ts`.

**Interfaces (SQL, todas `security definer set search_path = ''`):**
- Internas (revogadas de `public, anon, authenticated`):
  - `tiss_authorization_require_billing(p_account_id uuid) returns void`
  - `tiss_authorization_lock(p_id uuid) returns public.tiss_authorizations` — `select … for update` restrito a `my_workspace_ids()` + módulo.
  - `tiss_authorization_write_items(p_authorization_id uuid, p_items jsonb) returns void`
  - `tiss_authorization_log(p_id uuid, p_event text, p_from text, p_to text, p_data jsonb) returns void`
- Públicas (`grant execute … to authenticated`):
  - `tiss_authorization_professionals(p_workspace_id uuid) returns jsonb` — `[{id, full_name, crm, crm_uf, cbo_code, phone, email}]` dos membros ativos com CRM.
  - `create_tiss_authorization(p_workspace_id uuid, p_patient_id uuid, p_insurer_id uuid, p_type text, p_appointment_id uuid, p_parent_id uuid, p_payload jsonb, p_missing_fields text[], p_items jsonb) returns jsonb` → `{id, status, provider_guide_number}`.
  - `update_tiss_authorization(p_id uuid, p_expected_updated_at timestamptz, p_payload jsonb, p_missing_fields text[], p_items jsonb default null, p_requested_at date default null, p_event text default 'updated') returns jsonb` → `{id, status, updated_at}`.
  - `transition_tiss_authorization(p_id uuid, p_to text, p_expected_updated_at timestamptz) returns jsonb` → `{id, status, updated_at}` (`p_to` ∈ `sent`, `cancelled`).
  - `record_tiss_authorization_response(p_id uuid, p_expected_updated_at timestamptz, p_status_code text, p_operator_guide_number text, p_password text, p_authorization_date date, p_password_valid_until date, p_items jsonb default '[]') returns jsonb` → `{id, status, updated_at}`.
  - `log_tiss_authorization_xml(p_id uuid, p_hash text) returns void`.
- Chaves de erro novas: `tiss_authorization_forbidden` (42501), `billing_module_disabled` (42501), `tiss_authorization_not_found` (P0002), `tiss_authorization_invalid` (22023), `tiss_authorization_not_editable`, `tiss_authorization_changed`, `tiss_authorization_invalid_transition`, `tiss_authorization_incomplete`, `tiss_authorization_payload_mismatch`, `tiss_authorization_item_not_found`, `tiss_insurer_incomplete`.

Regras fixadas (do design, com os pontos ambíguos resolvidos e listados no fim do plano):
- `draft`/`ready` = `cardinality(missing_fields) > 0` / `= 0`; o SQL acrescenta `'items'` quando não há item (o cliente não consegue marcar `ready` sem itens).
- Conteúdo (payload, itens, `requested_at`) só em `draft`/`ready`, com `p_expected_updated_at` igual ao `updated_at` atual.
- `sent` só de `ready`. `cancelled` de `draft|ready` (qualquer membro) ou de `sent|under_review|pending_info` (só `is_account_admin`).
- Resposta só de `sent|under_review|pending_info`; código → status: 1 authorized, 2 under_review, 3 denied, 4/5 pending_info, 6 cancelled (exige admin, como o cancelamento), 7 partially_authorized.
- Numeração: mesmo `next_guide_number` da operadora, com `select … for update` na linha (mesmo lock do `ensure_tiss_guide_for_appointment`). `next_tiss_number` não é chamado porque exige admin (ver "Pontos do design").
- OPME: pai visível (mesmo workspace do usuário), não cancelado, travado `for share` (cancelamento concorrente do pai espera); OPME herda o workspace do pai.

- [ ] **3.1 Testes que falham.** Acrescentar ao fim de `tests/billing/authorizations-database.test.ts`:

```ts
type Created = { id: string; status: string; provider_guide_number: string }

const ITEM = { table_code: '22', code: '40301010', description: 'Hemograma completo', quantity_requested: 1 }
const OPME_ITEM = { table_code: '19', code: '70000001', description: 'Placa de titânio', quantity_requested: 2,
  manufacturer_option: '1', requested_value_cents: 150000, anvisa_registration: '80000000001' }

async function create(o: Partial<{ type: string; parent: string | null; workspace: string; patient: string; insurer: string;
  appointment: string | null; missing: string[]; items: object[]; payload: object }> = {}): Promise<Created> {
  const type = o.type ?? 'sp_sadt_request'
  const r = await db.query<{ r: Created }>(
    `select public.create_tiss_authorization($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6::uuid, $7::jsonb,
       array(select jsonb_array_elements_text($8::jsonb)), $9::jsonb) as r`,
    [o.workspace ?? ids.workspace, o.patient ?? ids.patient, o.insurer ?? ids.insurer, type, o.appointment ?? null,
     o.parent ?? null, JSON.stringify(o.payload ?? payload(type)), JSON.stringify(o.missing ?? []),
     JSON.stringify(o.items ?? [type === 'opme_request' ? OPME_ITEM : ITEM])],
  )
  return r.rows[0].r
}

// Lido com o papel atual (a RLS deixa o membro ler). Sem acesso, um valor
// qualquer — o RPC é que precisa recusar.
async function updatedAt(authorizationId: string): Promise<string> {
  const r = await db.query<{ t: string }>('select updated_at::text as t from public.tiss_authorizations where id = $1', [authorizationId])
  return r.rows[0]?.t ?? '2000-01-01T00:00:00Z'
}

const transition = async (aid: string, to: string) =>
  db.query('select public.transition_tiss_authorization($1::uuid, $2, $3::timestamptz) as r', [aid, to, await updatedAt(aid)])

const respond = async (aid: string, code: string, items: object[] = []) =>
  db.query(`select public.record_tiss_authorization_response($1::uuid, $2::timestamptz, $3, 'OP-123', 'SENHA9', '2026-10-06'::date,
    '2026-11-05'::date, $4::jsonb) as r`, [aid, await updatedAt(aid), code, JSON.stringify(items)])

const events = async (aid: string) => {
  await asSuperuser()
  return (await db.query<{ event: string; from_status: string | null; to_status: string | null }>(
    'select event, from_status, to_status from public.tiss_authorization_events where authorization_id = $1 order by id', [aid])).rows
}

describe('RPCs de autorização — criação e numeração', () => {
  it('member cria com o contador de guias da operadora, sem receber payload', async () => {
    await asUser(ids.member)
    const a = await create()
    const b = await create({ type: 'hospitalization_request' })
    expect(a).toEqual({ id: expect.any(String), status: 'ready', provider_guide_number: '1' })
    expect(b.provider_guide_number).toBe('2')
    expect(JSON.stringify(a)).not.toMatch(/FICT-CARD|payload/)
    expect(await events(a.id)).toEqual([{ event: 'created', from_status: null, to_status: 'ready' }])
  })

  it('sem itens vira draft com "items" em missing_fields, mesmo que o cliente mande vazio', async () => {
    await asUser(ids.member)
    const a = await create({ items: [], missing: [] })
    expect(a.status).toBe('draft')
    await asSuperuser()
    expect((await db.query<{ m: string[] }>('select missing_fields as m from public.tiss_authorizations')).rows[0].m).toEqual(['items'])
  })

  it('recusa workspace alheio, módulo desligado, operadora sem ANS e payload de outra operadora', async () => {
    await asUser(ids.member)
    await expect(create({ workspace: ids.otherWorkspace })).rejects.toThrow('tiss_authorization_forbidden')
    await expect(create({ patient: ids.otherPatient })).rejects.toThrow('tiss_authorization_account_mismatch')
    await expect(create({ payload: { ...payload('sp_sadt_request'), insurer: { ans_registry: '888888', provider_code: 'X', tiss_version: '4.03.00' } } }))
      .rejects.toThrow('tiss_authorization_payload_mismatch')
    await asSuperuser()
    await db.exec(`update public.health_insurers set ans_registry = null where id = '${ids.insurer}'`)
    await asUser(ids.member)
    await expect(create()).rejects.toThrow('tiss_insurer_incomplete')
    await asSuperuser()
    await db.exec(`update public.health_insurers set ans_registry = '999999'; update public.accounts set modules = '{}'`)
    await asUser(ids.member)
    await expect(create()).rejects.toThrow('billing_module_disabled')
  })

  it('OPME: pai visível, não cancelado, mesmo workspace; herda paciente e operadora', async () => {
    await asUser(ids.member)
    const parent = await create()
    const opme = await create({ type: 'opme_request', parent: parent.id })
    expect(opme.status).toBe('ready')
    await expect(create({ type: 'opme_request', parent: parent.id, workspace: ids.workspace2 })).rejects.toThrow('tiss_authorization_parent_invalid')
    await expect(create({ type: 'opme_request', parent: opme.id })).rejects.toThrow('tiss_authorization_parent_invalid')
    await expect(create({ type: 'opme_request' })).rejects.toThrow('tiss_authorization_parent_invalid')
    await expect(create({ type: 'sp_sadt_request', parent: parent.id })).rejects.toThrow('tiss_authorization_parent_invalid')
    await transition(parent.id, 'cancelled')
    await expect(create({ type: 'opme_request', parent: parent.id })).rejects.toThrow('tiss_authorization_parent_invalid')
  })

  it('lista só profissionais com CRM da própria account', async () => {
    await asUser(ids.member)
    const r = await db.query<{ r: Array<{ id: string; crm: string; phone: string }> }>(
      'select public.tiss_authorization_professionals($1::uuid) as r', [ids.workspace])
    expect(r.rows[0].r.map((p) => p.id)).toEqual([ids.doctor])
    expect(r.rows[0].r[0]).toMatchObject({ crm: '123456/SP', crm_uf: 'SP', cbo_code: '225125', phone: '11999990000' })
    await expect(db.query('select public.tiss_authorization_professionals($1::uuid)', [ids.otherWorkspace])).rejects.toThrow('tiss_authorization_forbidden')
  })
})

describe('RPCs de autorização — edição e máquina de estados', () => {
  it('edição exige updated_at atual e só vale em draft/ready; draft→ready gera evento', async () => {
    await asUser(ids.member)
    const a = await create({ missing: ['beneficiary.card_number'] })
    const stale = await updatedAt(a.id)
    const ok = await db.query<{ r: { status: string } }>(
      `select public.update_tiss_authorization($1::uuid, $2::timestamptz, $3::jsonb, '{}'::text[], $4::jsonb) as r`,
      [a.id, stale, JSON.stringify(payload('sp_sadt_request')), JSON.stringify([ITEM, { ...ITEM, code: '40302040', description: 'Glicose' }])])
    expect(ok.rows[0].r.status).toBe('ready')
    await expect(db.query(`select public.update_tiss_authorization($1::uuid, $2::timestamptz, $3::jsonb, '{}'::text[])`,
      [a.id, stale, JSON.stringify(payload('sp_sadt_request'))])).rejects.toThrow('tiss_authorization_changed')
    expect((await events(a.id)).map((e) => e.event)).toEqual(['created', 'updated', 'items_changed', 'ready'])
    await asSuperuser()
    expect((await db.query<{ n: number }>('select count(*)::int as n from public.tiss_authorization_items')).rows[0].n).toBe(2)
    await asUser(ids.member)
    await transition(a.id, 'sent')
    await expect(db.query(`select public.update_tiss_authorization($1::uuid, $2::timestamptz, $3::jsonb, '{}'::text[])`,
      [a.id, await updatedAt(a.id), JSON.stringify(payload('sp_sadt_request'))])).rejects.toThrow('tiss_authorization_not_editable')
  })

  it('sent só a partir de ready; cancelamento após envio é só de owner/admin', async () => {
    await asUser(ids.member)
    const draft = await create({ items: [] })
    await expect(transition(draft.id, 'sent')).rejects.toThrow('tiss_authorization_invalid_transition')
    await transition(draft.id, 'cancelled')
    await expect(transition(draft.id, 'sent')).rejects.toThrow('tiss_authorization_invalid_transition')
    const a = await create()
    await transition(a.id, 'sent')
    await expect(transition(a.id, 'cancelled')).rejects.toThrow('tiss_authorization_forbidden')
    await asUser(ids.owner)
    await transition(a.id, 'cancelled')
    expect((await events(a.id)).map((e) => [e.event, e.from_status, e.to_status])).toEqual([
      ['created', null, 'ready'], ['sent', 'ready', 'sent'], ['cancelled', 'sent', 'cancelled'],
    ])
  })

  it.each([
    ['1', 'authorized'], ['2', 'under_review'], ['3', 'denied'], ['4', 'pending_info'],
    ['5', 'pending_info'], ['6', 'cancelled'], ['7', 'partially_authorized'],
  ])('resposta %s → %s', async (code, status) => {
    await asUser(ids.member)
    const a = await create()
    await transition(a.id, 'sent')
    if (code === '6') {
      await expect(respond(a.id, code)).rejects.toThrow('tiss_authorization_forbidden')
      await asUser(ids.owner)
    }
    const r = await respond(a.id, code)
    expect((r.rows[0] as { r: { status: string } }).r.status).toBe(status)
    await asSuperuser()
    const row = (await db.query<{ operator_guide_number: string; password: string; response_status_code: string }>(
      'select operator_guide_number, password, response_status_code from public.tiss_authorizations where id = $1', [a.id])).rows[0]
    expect(row).toEqual({ operator_guide_number: 'OP-123', password: 'SENHA9', response_status_code: code })
  })

  it('resposta grava quantidade/valor autorizado só de itens da própria autorização e respeita estados terminais', async () => {
    await asUser(ids.member)
    const parent = await create()
    const opme = await create({ type: 'opme_request', parent: parent.id })
    await transition(opme.id, 'sent')
    await asSuperuser()
    const item = (await db.query<{ id: string }>('select id from public.tiss_authorization_items where authorization_id = $1', [opme.id])).rows[0]
    const foreign = (await db.query<{ id: string }>('select id from public.tiss_authorization_items where authorization_id = $1', [parent.id])).rows[0]
    await asUser(ids.member)
    await expect(respond(opme.id, '7', [{ id: foreign.id, quantity_authorized: 1 }])).rejects.toThrow('tiss_authorization_item_not_found')
    await respond(opme.id, '2')
    await respond(opme.id, '7', [{ id: item.id, quantity_authorized: 1, authorized_value_cents: 120000 }])
    await expect(respond(opme.id, '1')).rejects.toThrow('tiss_authorization_invalid_transition')
    await asSuperuser()
    expect((await db.query('select quantity_authorized, authorized_value_cents from public.tiss_authorization_items where id = $1', [item.id])).rows)
      .toEqual([{ quantity_authorized: 1, authorized_value_cents: 120000 }])
  })

  it('registro de XML gerado: só fora de draft e com hash MD5', async () => {
    await asUser(ids.member)
    const draft = await create({ items: [] })
    await expect(db.query('select public.log_tiss_authorization_xml($1::uuid, $2)', [draft.id, 'a'.repeat(32)])).rejects.toThrow('tiss_authorization_incomplete')
    const a = await create()
    await expect(db.query('select public.log_tiss_authorization_xml($1::uuid, $2)', [a.id, 'xyz'])).rejects.toThrow('tiss_authorization_invalid')
    await db.query('select public.log_tiss_authorization_xml($1::uuid, $2)', [a.id, 'a'.repeat(32)])
    expect((await events(a.id)).map((e) => e.event)).toEqual(['created', 'xml_generated'])
  })

  it('usuário de outra account não opera a autorização nem pelo RPC', async () => {
    await asUser(ids.member)
    const a = await create()
    await asUser(ids.outsider)
    await expect(transition(a.id, 'cancelled')).rejects.toThrow('tiss_authorization_not_found')
  })
})

describe('faturamento intacto', () => {
  it('autorização e guia compartilham o contador sem colidir; o lote só enxerga guias', async () => {
    await asUser(ids.member)
    await create({ appointment: ids.appointment })
    await asSuperuser()
    await db.exec(`update public.appointments set status = 'realizado' where id = '${ids.appointment}'`)
    await asUser(ids.member)
    const guide = await db.query<{ r: { status: string } }>('select public.ensure_tiss_guide_for_appointment($1::uuid) as r', [ids.appointment])
    expect(guide.rows[0].r.status).toBe('created')
    await asSuperuser()
    const numbers = await db.query<{ n: string }>(
      `select provider_guide_number as n from public.tiss_guides
       union all select provider_guide_number from public.tiss_authorizations order by 1`)
    expect(numbers.rows.map((r) => r.n)).toEqual(['1', '2'])
    // Mesma consulta de lib/billing/batches.ts#createBatchesForInsurer.
    const batchable = await db.query(
      `select id from public.tiss_guides where insurer_id = $1 and account_id = $2 and status = 'ready' and batch_id is null`,
      [ids.insurer, ids.account])
    expect(batchable.rows).toHaveLength(1)
  })
})
```

- [ ] **3.2 Rodar e ver falhar:** `npx vitest run tests/billing/authorizations-database.test.ts` → falhas "function public.create_tiss_authorization(...) does not exist".

- [ ] **3.3 Implementar a seção 5** em `supabase/tiss-authorizations.sql`, imediatamente antes de `-- END TISS AUTHORIZATIONS`:

```sql
-- ============================================================
-- 5. RPCs — toda escrita passa por aqui, com o evento na mesma transação
-- ============================================================
create or replace function public.tiss_authorization_require_billing(p_account_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.accounts where id = p_account_id and 'billing' = any(modules)) then
    raise exception 'billing_module_disabled' using errcode = '42501';
  end if;
end; $$;

-- Trava a linha (FOR UPDATE) se o usuário enxerga o workspace dela.
create or replace function public.tiss_authorization_lock(p_id uuid)
returns public.tiss_authorizations language plpgsql security definer set search_path = '' as $$
declare a public.tiss_authorizations%rowtype;
begin
  if auth.uid() is null then raise exception 'tiss_authorization_forbidden' using errcode = '42501'; end if;
  select * into a from public.tiss_authorizations
    where id = p_id and workspace_id = any(public.my_workspace_ids())
    for update;
  if not found then raise exception 'tiss_authorization_not_found' using errcode = 'P0002'; end if;
  perform public.tiss_authorization_require_billing(a.account_id);
  return a;
end; $$;

-- Substitui todos os itens. O tipo do item vem do tipo da autorização; os
-- CHECKs da tabela validam limites do XSD e o trigger força a account.
create or replace function public.tiss_authorization_write_items(p_authorization_id uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_account uuid;
begin
  select case when type = 'opme_request' then 'opme' else 'procedure' end, account_id
    into v_kind, v_account
    from public.tiss_authorizations where id = p_authorization_id;
  delete from public.tiss_authorization_items where authorization_id = p_authorization_id;
  insert into public.tiss_authorization_items (
    authorization_id, account_id, position, kind, table_code, code, description, quantity_requested,
    manufacturer_option, requested_value_cents, anvisa_registration, manufacturer_reference, operating_authorization
  )
  select p_authorization_id, v_account, x.ord::int, v_kind,
         x.item ->> 'table_code',
         btrim(x.item ->> 'code'),
         btrim(x.item ->> 'description'),
         (x.item ->> 'quantity_requested')::int,
         nullif(x.item ->> 'manufacturer_option', ''),
         (x.item ->> 'requested_value_cents')::bigint,
         nullif(btrim(x.item ->> 'anvisa_registration'), ''),
         nullif(btrim(x.item ->> 'manufacturer_reference'), ''),
         nullif(btrim(x.item ->> 'operating_authorization'), '')
  from jsonb_array_elements(p_items) with ordinality as x(item, ord);
end; $$;

create or replace function public.tiss_authorization_log(p_id uuid, p_event text, p_from text, p_to text, p_data jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.tiss_authorization_events (authorization_id, account_id, event, from_status, to_status, actor_id, data)
  select a.id, a.account_id, p_event, p_from, p_to, auth.uid(), coalesce(p_data, '{}'::jsonb)
  from public.tiss_authorizations a where a.id = p_id;
$$;

-- Profissionais solicitantes: membros ativos com CRM da account do workspace.
-- profiles tem RLS "só o próprio"; aqui saem só os campos do TISS.
create or replace function public.tiss_authorization_professionals(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_account uuid;
begin
  select account_id into v_account from public.workspaces
    where id = p_workspace_id and id = any(public.my_workspace_ids());
  if not found then raise exception 'tiss_authorization_forbidden' using errcode = '42501'; end if;
  perform public.tiss_authorization_require_billing(v_account);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'full_name', p.full_name, 'crm', p.crm, 'crm_uf', p.crm_uf,
      'cbo_code', p.cbo_code, 'phone', p.phone, 'email', p.email
    ) order by p.full_name)
    from public.profiles p
    join public.memberships m on m.user_id = p.id
    where m.account_id = v_account and m.status = 'active' and nullif(btrim(p.crm), '') is not null
  ), '[]'::jsonb);
end; $$;

-- Cria a solicitação já numerada (mesmo contador e lock das guias — D4).
-- payload e missing_fields vêm do servidor Next (lib/billing/authorizations);
-- aqui só se garante o que não pode ser forjado: acesso, módulo, operadora
-- TISS completa, payload da mesma operadora, pai do OPME, draft sem itens.
create or replace function public.create_tiss_authorization(
  p_workspace_id   uuid,
  p_patient_id     uuid,
  p_insurer_id     uuid,
  p_type           text,
  p_appointment_id uuid,
  p_parent_id      uuid,
  p_payload        jsonb,
  p_missing_fields text[],
  p_items          jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w         public.workspaces%rowtype;
  i         public.health_insurers%rowtype;
  v_parent  public.tiss_authorizations%rowtype;
  v_number  bigint;
  v_id      uuid;
  v_missing text[] := coalesce(p_missing_fields, '{}');
  v_status  text;
begin
  if auth.uid() is null then raise exception 'tiss_authorization_forbidden' using errcode = '42501'; end if;
  select * into w from public.workspaces where id = p_workspace_id and id = any(public.my_workspace_ids());
  if not found then raise exception 'tiss_authorization_forbidden' using errcode = '42501'; end if;
  perform public.tiss_authorization_require_billing(w.account_id);

  if p_type is null or p_type not in ('sp_sadt_request','hospitalization_request','opme_request')
     or jsonb_typeof(p_payload) is distinct from 'object'
     or jsonb_typeof(p_items) is distinct from 'array'
     or p_payload ->> 'type' is distinct from p_type then
    raise exception 'tiss_authorization_invalid' using errcode = '22023';
  end if;

  if (p_type = 'opme_request') <> (p_parent_id is not null) then
    raise exception 'tiss_authorization_parent_invalid' using errcode = '22023';
  end if;
  if p_parent_id is not null then
    -- FOR SHARE: um cancelamento simultâneo do pai espera esta transação.
    select * into v_parent from public.tiss_authorizations
      where id = p_parent_id and workspace_id = any(public.my_workspace_ids())
      for share;
    if not found or v_parent.status = 'cancelled' or v_parent.workspace_id <> w.id then
      raise exception 'tiss_authorization_parent_invalid' using errcode = '22023';
    end if;
  end if;

  -- Mesmo lock de linha que numera as guias (ensure_tiss_guide_for_appointment).
  select * into i from public.health_insurers
    where id = p_insurer_id and account_id = w.account_id
    for update;
  if not found or i.ans_registry is null or i.provider_code is null then
    raise exception 'tiss_insurer_incomplete' using errcode = '22023';
  end if;
  if p_payload #>> '{insurer,ans_registry}' is distinct from i.ans_registry
     or p_payload #>> '{insurer,provider_code}' is distinct from i.provider_code then
    raise exception 'tiss_authorization_payload_mismatch' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) = 0 and not ('items' = any(v_missing)) then
    v_missing := array_append(v_missing, 'items');
  end if;
  v_status := case when cardinality(v_missing) = 0 then 'ready' else 'draft' end;

  update public.health_insurers set next_guide_number = next_guide_number + 1
    where id = i.id returning next_guide_number - 1 into v_number;

  insert into public.tiss_authorizations (
    account_id, workspace_id, patient_id, insurer_id, appointment_id, parent_id, type, status,
    provider_guide_number, payload, missing_fields, created_by, updated_by
  ) values (
    w.account_id, w.id, p_patient_id, i.id, p_appointment_id, p_parent_id, p_type, v_status,
    v_number::text, p_payload, v_missing, auth.uid(), auth.uid()
  ) returning id into v_id;

  perform public.tiss_authorization_write_items(v_id, p_items);
  perform public.tiss_authorization_log(v_id, 'created', null, v_status,
    jsonb_build_object('type', p_type, 'provider_guide_number', v_number::text));

  return jsonb_build_object('id', v_id, 'status', v_status, 'provider_guide_number', v_number::text);
end; $$;

-- Conteúdo (payload, itens, data da solicitação): só em draft/ready e com o
-- updated_at que o usuário viu (concorrência otimista). Status recalculado.
create or replace function public.update_tiss_authorization(
  p_id                  uuid,
  p_expected_updated_at timestamptz,
  p_payload             jsonb,
  p_missing_fields      text[],
  p_items               jsonb default null,
  p_requested_at        date default null,
  p_event               text default 'updated'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a         public.tiss_authorizations%rowtype;
  v_from    text;
  v_missing text[] := coalesce(p_missing_fields, '{}');
  v_status  text;
begin
  if p_event is null or p_event not in ('updated', 'refreshed')
     or jsonb_typeof(p_payload) is distinct from 'object'
     or (p_items is not null and jsonb_typeof(p_items) <> 'array') then
    raise exception 'tiss_authorization_invalid' using errcode = '22023';
  end if;
  a := public.tiss_authorization_lock(p_id);
  if a.status not in ('draft', 'ready') then
    raise exception 'tiss_authorization_not_editable' using errcode = 'P0001';
  end if;
  if a.updated_at is distinct from p_expected_updated_at then
    raise exception 'tiss_authorization_changed' using errcode = 'P0001';
  end if;
  if p_payload ->> 'type' is distinct from a.type then
    raise exception 'tiss_authorization_invalid' using errcode = '22023';
  end if;
  -- Operadora do payload: a que já estava no snapshot ou a atual ("Recarregar dados").
  if (p_payload #>> '{insurer,ans_registry}', p_payload #>> '{insurer,provider_code}')
       is distinct from (a.payload #>> '{insurer,ans_registry}', a.payload #>> '{insurer,provider_code}')
     and not exists (
       select 1 from public.health_insurers
       where id = a.insurer_id
         and ans_registry = p_payload #>> '{insurer,ans_registry}'
         and provider_code = p_payload #>> '{insurer,provider_code}'
     ) then
    raise exception 'tiss_authorization_payload_mismatch' using errcode = '22023';
  end if;

  if p_items is not null then
    perform public.tiss_authorization_write_items(a.id, p_items);
  end if;
  if not exists (select 1 from public.tiss_authorization_items where authorization_id = a.id)
     and not ('items' = any(v_missing)) then
    v_missing := array_append(v_missing, 'items');
  end if;

  v_from := a.status;
  v_status := case when cardinality(v_missing) = 0 then 'ready' else 'draft' end;
  update public.tiss_authorizations set
    payload = p_payload,
    missing_fields = v_missing,
    status = v_status,
    requested_at = coalesce(p_requested_at, requested_at),
    updated_by = auth.uid()
  where id = a.id
  returning * into a;

  perform public.tiss_authorization_log(a.id, p_event, v_from, v_status, '{}'::jsonb);
  if p_items is not null then
    perform public.tiss_authorization_log(a.id, 'items_changed', null, null,
      jsonb_build_object('count', jsonb_array_length(p_items)));
  end if;
  if v_from = 'draft' and v_status = 'ready' then
    perform public.tiss_authorization_log(a.id, 'ready', v_from, v_status, '{}'::jsonb);
  end if;
  return jsonb_build_object('id', a.id, 'status', a.status, 'updated_at', a.updated_at);
end; $$;

-- D3: ready → sent; draft|ready → cancelled (qualquer membro);
-- sent|under_review|pending_info → cancelled (só owner/admin).
create or replace function public.transition_tiss_authorization(
  p_id uuid, p_to text, p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.tiss_authorizations%rowtype; v_from text;
begin
  if p_to is null or p_to not in ('sent', 'cancelled') then
    raise exception 'tiss_authorization_invalid_transition' using errcode = '22023';
  end if;
  a := public.tiss_authorization_lock(p_id);
  if a.updated_at is distinct from p_expected_updated_at then
    raise exception 'tiss_authorization_changed' using errcode = 'P0001';
  end if;
  v_from := a.status;
  if p_to = 'sent' and v_from <> 'ready' then
    raise exception 'tiss_authorization_invalid_transition' using errcode = 'P0001';
  end if;
  if p_to = 'cancelled' then
    if v_from not in ('draft', 'ready', 'sent', 'under_review', 'pending_info') then
      raise exception 'tiss_authorization_invalid_transition' using errcode = 'P0001';
    end if;
    if v_from not in ('draft', 'ready') and not public.is_account_admin(a.account_id) then
      raise exception 'tiss_authorization_forbidden' using errcode = '42501';
    end if;
  end if;
  update public.tiss_authorizations set
    status = p_to,
    sent_at = case when p_to = 'sent' then now() else sent_at end,
    updated_by = auth.uid()
  where id = a.id
  returning * into a;
  perform public.tiss_authorization_log(a.id, p_to, v_from, p_to, '{}'::jsonb);
  return jsonb_build_object('id', a.id, 'status', a.status, 'updated_at', a.updated_at);
end; $$;

-- D6: resposta registrada à mão. dm_statusSolicitacao → status (D3).
create or replace function public.record_tiss_authorization_response(
  p_id                    uuid,
  p_expected_updated_at   timestamptz,
  p_status_code           text,
  p_operator_guide_number text,
  p_password              text,
  p_authorization_date    date,
  p_password_valid_until  date,
  p_items                 jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a      public.tiss_authorizations%rowtype;
  v_from text;
  v_to   text;
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
begin
  v_to := case p_status_code
    when '1' then 'authorized'
    when '2' then 'under_review'
    when '3' then 'denied'
    when '4' then 'pending_info'
    when '5' then 'pending_info'
    when '6' then 'cancelled'
    when '7' then 'partially_authorized'
  end;
  if v_to is null or jsonb_typeof(v_items) <> 'array' then
    raise exception 'tiss_authorization_invalid' using errcode = '22023';
  end if;
  a := public.tiss_authorization_lock(p_id);
  if a.updated_at is distinct from p_expected_updated_at then
    raise exception 'tiss_authorization_changed' using errcode = 'P0001';
  end if;
  v_from := a.status;
  if v_from not in ('sent', 'under_review', 'pending_info') then
    raise exception 'tiss_authorization_invalid_transition' using errcode = 'P0001';
  end if;
  -- Cancelamento informado pela operadora tem o mesmo peso do cancelamento manual.
  if v_to = 'cancelled' and not public.is_account_admin(a.account_id) then
    raise exception 'tiss_authorization_forbidden' using errcode = '42501';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_items) x
    where not exists (
      select 1 from public.tiss_authorization_items it
      where it.authorization_id = a.id and it.id::text = x ->> 'id'
    )
  ) then
    raise exception 'tiss_authorization_item_not_found' using errcode = '22023';
  end if;

  update public.tiss_authorization_items it set
    quantity_authorized    = (x.item ->> 'quantity_authorized')::int,
    authorized_value_cents = (x.item ->> 'authorized_value_cents')::bigint
  from jsonb_array_elements(v_items) as x(item)
  where it.authorization_id = a.id and it.id::text = x.item ->> 'id';

  update public.tiss_authorizations set
    status                = v_to,
    response_status_code  = p_status_code,
    operator_guide_number = nullif(btrim(p_operator_guide_number), ''),
    password              = nullif(btrim(p_password), ''),
    authorization_date    = p_authorization_date,
    password_valid_until  = p_password_valid_until,
    responded_at          = now(),
    updated_by            = auth.uid()
  where id = a.id
  returning * into a;

  perform public.tiss_authorization_log(a.id, 'response_recorded', v_from, v_to, jsonb_build_object(
    'status_code', p_status_code,
    'operator_guide_number', a.operator_guide_number,
    'password', a.password,
    'authorization_date', a.authorization_date,
    'password_valid_until', a.password_valid_until
  ));
  return jsonb_build_object('id', a.id, 'status', a.status, 'updated_at', a.updated_at);
end; $$;

-- O XML não é guardado (D5); o download só deixa rastro do hash gerado.
create or replace function public.log_tiss_authorization_xml(p_id uuid, p_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.tiss_authorizations%rowtype;
begin
  if coalesce(p_hash, '') !~ '^[a-f0-9]{32}$' then
    raise exception 'tiss_authorization_invalid' using errcode = '22023';
  end if;
  a := public.tiss_authorization_lock(p_id);
  if a.status = 'draft' then
    raise exception 'tiss_authorization_incomplete' using errcode = 'P0001';
  end if;
  perform public.tiss_authorization_log(a.id, 'xml_generated', null, null, jsonb_build_object('hash', p_hash));
end; $$;

revoke all on function public.tiss_authorization_require_billing(uuid) from public, anon, authenticated;
revoke all on function public.tiss_authorization_lock(uuid) from public, anon, authenticated;
revoke all on function public.tiss_authorization_write_items(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.tiss_authorization_log(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.enforce_tiss_authorization() from public, anon, authenticated;
revoke all on function public.enforce_tiss_authorization_item() from public, anon, authenticated;
revoke all on function public.enforce_tiss_authorization_event() from public, anon, authenticated;

revoke all on function public.tiss_authorization_professionals(uuid) from public, anon;
grant execute on function public.tiss_authorization_professionals(uuid) to authenticated;
revoke all on function public.create_tiss_authorization(uuid, uuid, uuid, text, uuid, uuid, jsonb, text[], jsonb) from public, anon;
grant execute on function public.create_tiss_authorization(uuid, uuid, uuid, text, uuid, uuid, jsonb, text[], jsonb) to authenticated;
revoke all on function public.update_tiss_authorization(uuid, timestamptz, jsonb, text[], jsonb, date, text) from public, anon;
grant execute on function public.update_tiss_authorization(uuid, timestamptz, jsonb, text[], jsonb, date, text) to authenticated;
revoke all on function public.transition_tiss_authorization(uuid, text, timestamptz) from public, anon;
grant execute on function public.transition_tiss_authorization(uuid, text, timestamptz) to authenticated;
revoke all on function public.record_tiss_authorization_response(uuid, timestamptz, text, text, text, date, date, jsonb) from public, anon;
grant execute on function public.record_tiss_authorization_response(uuid, timestamptz, text, text, text, date, date, jsonb) to authenticated;
revoke all on function public.log_tiss_authorization_xml(uuid, text) from public, anon;
grant execute on function public.log_tiss_authorization_xml(uuid, text) to authenticated;
```

- [ ] **3.4 Rodar e ver passar:** `npx vitest run tests/billing/authorizations-database.test.ts tests/billing/database.test.ts`. Pontos de atenção se algo falhar:
  - `tiss_authorization_lock` retorna o rowtype: em PGlite/PG 16+ `a := public.tiss_authorization_lock(p_id)` funciona; não trocar por `select * into` sem o filtro de workspace.
  - O `for update` em `health_insurers` + o `update … set next_guide_number` reproduzem a numeração do `ensure_tiss_guide_for_appointment`; o teste "faturamento intacto" precisa dar `['1','2']`.
  - O teste de idempotência da Tarefa 2 continua passando com as funções (`create or replace`).
- [ ] **3.5 Commit:**

```bash
git add supabase/tiss-authorizations.sql tests/billing/authorizations-database.test.ts
git commit -m "feat(tiss): RPCs de autorização com máquina de estados, numeração compartilhada e eventos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 4 — Espelho em `supabase/schema.sql`

**Modelo sugerido:** sonnet

**Files:** modificar `supabase/schema.sql`, `tests/billing/authorizations-database.test.ts`.

**Interfaces:**
- Consumes: bloco `-- BEGIN TISS AUTHORIZATIONS` … `-- END TISS AUTHORIZATIONS` de `supabase/tiss-authorizations.sql` (Tarefas 2–3).
- Produces: `schema.sql` reconstrói tudo do zero, inclusive autorizações, sem alterar o sufixo `billing-authenticated.sql`.

- [ ] **4.1 Teste que falha.** Acrescentar a `tests/billing/authorizations-database.test.ts`:

```ts
describe('espelho em schema.sql', () => {
  it('o bloco está idêntico em schema.sql, antes do bloco authenticated do faturamento', async () => {
    const begin = '-- BEGIN TISS AUTHORIZATIONS'
    const end = '-- END TISS AUTHORIZATIONS'
    const block = migration.slice(migration.indexOf(begin), migration.indexOf(end) + end.length)
    const reset = await readFile('supabase/schema.sql', 'utf8')
    const extra = await readFile('supabase/billing-authenticated.sql', 'utf8')
    expect(migration.indexOf(begin)).toBeGreaterThan(-1)
    expect(reset.includes(block)).toBe(true)
    expect(reset.indexOf(block)).toBeLessThan(reset.indexOf('-- BEGIN BILLING AUTHENTICATED OPERATIONS'))
    expect(reset.endsWith(extra)).toBe(true)
    // O reset do schema apaga as tabelas novas antes de tiss_guides.
    for (const table of ['tiss_authorization_events', 'tiss_authorization_items', 'tiss_authorizations']) {
      expect(reset).toMatch(new RegExp(`drop table if exists[\\s\\S]*public\\.${table},[\\s\\S]*public\\.tiss_guides,`))
    }
    expect(reset).toContain('drop function if exists public.create_tiss_authorization(uuid, uuid, uuid, text, uuid, uuid, jsonb, text[], jsonb) cascade;')
  })
})
```

- [ ] **4.2 Rodar e ver falhar:** `npx vitest run tests/billing/authorizations-database.test.ts -t "espelho"`.
- [ ] **4.3 Implementar em `supabase/schema.sql`** (três inserções, nenhuma linha removida):
  1. Na lista `drop table if exists` da seção 0, imediatamente **antes** de `  public.tiss_guides,`, inserir:
     ```sql
       public.tiss_authorization_events,
       public.tiss_authorization_items,
       public.tiss_authorizations,
     ```
  2. Depois de `drop function if exists public.mark_tiss_batch_sent(uuid) cascade;`, inserir:
     ```sql
     drop function if exists public.enforce_tiss_authorization() cascade;
     drop function if exists public.enforce_tiss_authorization_item() cascade;
     drop function if exists public.enforce_tiss_authorization_event() cascade;
     drop function if exists public.tiss_authorization_require_billing(uuid) cascade;
     drop function if exists public.tiss_authorization_lock(uuid) cascade;
     drop function if exists public.tiss_authorization_write_items(uuid, jsonb) cascade;
     drop function if exists public.tiss_authorization_log(uuid, text, text, text, jsonb) cascade;
     drop function if exists public.tiss_authorization_professionals(uuid) cascade;
     drop function if exists public.create_tiss_authorization(uuid, uuid, uuid, text, uuid, uuid, jsonb, text[], jsonb) cascade;
     drop function if exists public.update_tiss_authorization(uuid, timestamptz, jsonb, text[], jsonb, date, text) cascade;
     drop function if exists public.transition_tiss_authorization(uuid, text, timestamptz) cascade;
     drop function if exists public.record_tiss_authorization_response(uuid, timestamptz, text, text, text, date, date, jsonb) cascade;
     drop function if exists public.log_tiss_authorization_xml(uuid, text) cascade;
     ```
  3. Logo **antes** da linha `-- Ajuste incremental para instalações que já executaram billing.sql.` (portanto depois da seção 15/storage e dos `grant all on all tables` da seção 14 — os `revoke` do bloco prevalecem), inserir um cabeçalho de seção e o bloco copiado **byte a byte** de `-- BEGIN TISS AUTHORIZATIONS` até `-- END TISS AUTHORIZATIONS` (inclusive), seguido de uma linha em branco. Copiar por script para não errar espaços:
     ```bash
     node -e "const fs=require('fs');const m=fs.readFileSync('supabase/tiss-authorizations.sql','utf8');const B='-- BEGIN TISS AUTHORIZATIONS',E='-- END TISS AUTHORIZATIONS';const b=m.slice(m.indexOf(B),m.indexOf(E)+E.length);const s=fs.readFileSync('supabase/schema.sql','utf8');const a='-- Ajuste incremental para instalações que já executaram billing.sql.';const i=s.indexOf(a);if(i<0||s.includes(B))throw new Error('âncora ausente ou bloco já inserido');const h='-- ============================================================\n-- 16. AUTORIZAÇÕES TISS (SP/SADT, Internação, Anexo OPME)\n-- Mesmo conteúdo de supabase/tiss-authorizations.sql.\n-- ============================================================\n';fs.writeFileSync('supabase/schema.sql',s.slice(0,i)+h+b+'\n\n'+s.slice(i))"
     ```
- [ ] **4.4 Rodar e ver passar:** `npx vitest run tests/billing/authorizations-database.test.ts tests/billing/database.test.ts` (o `endsWith` do faturamento continua verde). Conferir que só houve inserções: `git diff supabase/schema.sql | grep '^-' | grep -v '^---'` deve sair vazio.
- [ ] **4.5 Commit:**

```bash
git add supabase/schema.sql tests/billing/authorizations-database.test.ts
git commit -m "chore(tiss): espelha autorizações no schema.sql de reconstrução

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 5 — Tipos manuais em `types/database.ts`

**Modelo sugerido:** haiku

**Files:** modificar `types/database.ts`.

**Interfaces (Produces):**

```ts
export type TissAuthorizationType = 'sp_sadt_request' | 'hospitalization_request' | 'opme_request'
export type TissAuthorizationStatus =
  | 'draft' | 'ready' | 'sent' | 'under_review' | 'pending_info'
  | 'authorized' | 'partially_authorized' | 'denied' | 'cancelled'
export type TissAuthorizationItemKind = 'procedure' | 'opme'
export type TissAuthorizationEventType =
  | 'created' | 'updated' | 'items_changed' | 'refreshed' | 'ready'
  | 'sent' | 'response_recorded' | 'cancelled' | 'xml_generated'
```

- [ ] **5.1** Adicionar os quatro tipos acima logo depois de `export type TissBatchStatus = …`.
- [ ] **5.2** Em `Tables`, depois de `tiss_guides`, adicionar (escrita só por RPC, então `Insert`/`Update` não aceitam campos):

```ts
      tiss_authorizations: {
        Row: {
          id: string
          account_id: string
          workspace_id: string
          patient_id: string
          insurer_id: string
          appointment_id: string | null
          parent_id: string | null
          type: TissAuthorizationType
          status: TissAuthorizationStatus
          provider_guide_number: string
          payload: unknown
          missing_fields: string[]
          operator_guide_number: string | null
          password: string | null
          authorization_date: string | null
          password_valid_until: string | null
          response_status_code: string | null
          requested_at: string
          sent_at: string | null
          responded_at: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        // insert/update revogados de authenticated: escrita só pelos RPCs.
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          { foreignKeyName: 'tiss_authorizations_insurer_id_fkey'; columns: ['insurer_id']; referencedRelation: 'health_insurers'; referencedColumns: ['id'] },
          { foreignKeyName: 'tiss_authorizations_patient_id_fkey'; columns: ['patient_id']; referencedRelation: 'patients'; referencedColumns: ['id'] },
          { foreignKeyName: 'tiss_authorizations_appointment_id_fkey'; columns: ['appointment_id']; referencedRelation: 'appointments'; referencedColumns: ['id'] },
          { foreignKeyName: 'tiss_authorizations_parent_id_fkey'; columns: ['parent_id']; referencedRelation: 'tiss_authorizations'; referencedColumns: ['id'] },
        ]
      }
      tiss_authorization_items: {
        Row: {
          id: string
          authorization_id: string
          account_id: string
          position: number
          kind: TissAuthorizationItemKind
          table_code: string
          code: string
          description: string
          quantity_requested: number
          quantity_authorized: number | null
          manufacturer_option: string | null
          requested_value_cents: number | null
          authorized_value_cents: number | null
          anvisa_registration: string | null
          manufacturer_reference: string | null
          operating_authorization: string | null
          created_at: string
          updated_at: string
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          { foreignKeyName: 'tiss_authorization_items_authorization_id_fkey'; columns: ['authorization_id']; referencedRelation: 'tiss_authorizations'; referencedColumns: ['id'] },
        ]
      }
      tiss_authorization_events: {
        Row: {
          id: number
          authorization_id: string
          account_id: string
          event: TissAuthorizationEventType
          from_status: TissAuthorizationStatus | null
          to_status: TissAuthorizationStatus | null
          actor_id: string | null
          data: Record<string, unknown>
          created_at: string
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          { foreignKeyName: 'tiss_authorization_events_authorization_id_fkey'; columns: ['authorization_id']; referencedRelation: 'tiss_authorizations'; referencedColumns: ['id'] },
        ]
      }
```

- [ ] **5.3** Em `Functions`, depois de `mark_tiss_batch_sent`, adicionar:

```ts
      tiss_authorization_professionals: {
        Args: { p_workspace_id: string }
        Returns: Array<{
          id: string; full_name: string; crm: string | null; crm_uf: string | null
          cbo_code: string | null; phone: string | null; email: string | null
        }>
      }
      create_tiss_authorization: {
        Args: {
          p_workspace_id: string
          p_patient_id: string
          p_insurer_id: string
          p_type: TissAuthorizationType
          p_appointment_id: string | null
          p_parent_id: string | null
          p_payload: unknown
          p_missing_fields: string[]
          p_items: unknown
        }
        Returns: { id: string; status: TissAuthorizationStatus; provider_guide_number: string }
      }
      update_tiss_authorization: {
        Args: {
          p_id: string
          p_expected_updated_at: string
          p_payload: unknown
          p_missing_fields: string[]
          p_items?: unknown
          p_requested_at?: string | null
          p_event?: 'updated' | 'refreshed'
        }
        Returns: { id: string; status: TissAuthorizationStatus; updated_at: string }
      }
      transition_tiss_authorization: {
        Args: { p_id: string; p_to: 'sent' | 'cancelled'; p_expected_updated_at: string }
        Returns: { id: string; status: TissAuthorizationStatus; updated_at: string }
      }
      record_tiss_authorization_response: {
        Args: {
          p_id: string
          p_expected_updated_at: string
          p_status_code: string
          p_operator_guide_number: string | null
          p_password: string | null
          p_authorization_date: string | null
          p_password_valid_until: string | null
          p_items?: unknown
        }
        Returns: { id: string; status: TissAuthorizationStatus; updated_at: string }
      }
      log_tiss_authorization_xml: { Args: { p_id: string; p_hash: string }; Returns: undefined }
```

> Se o tipo genérico do supabase-js (`GenericTable`) recusar `Record<string, never>` em `Insert`/`Update`, usar `Partial<Row>` e manter a regra só por convenção — o banco recusa de qualquer forma (permission denied).

- [ ] **5.4 Verificar:** `npx tsc --noEmit` → sem erros novos em relação à linha de base da Tarefa 1.
- [ ] **5.5 Commit:**

```bash
git add types/database.ts
git commit -m "feat(tiss): tipos das tabelas e RPCs de autorização

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 6 — Domínio: enumerações do XSD, tipos, rótulos e máquina de estados

**Modelo sugerido:** sonnet

**Files:** criar `lib/billing/authorizations/domains.ts`, `types.ts`, `constants.ts`, `status.ts`, `tests/billing/authorizations-domain.test.ts`.

**Interfaces (Produces):**

```ts
// domains.ts — objetos `as const` código → rótulo e tipos derivados
CARATER_ATENDIMENTO, TIPO_INTERNACAO, REGIME_INTERNACAO, INDICADOR_ACIDENTE, ETAPA_AUTORIZACAO,
AUSENCIA_COD_VALIDACAO, COBERTURA_ESPECIAL, OPCAO_FABRICANTE, TABELA, STATUS_SOLICITACAO
type CaraterAtendimento | TipoInternacao | RegimeInternacao | IndicadorAcidente | EtapaAutorizacao
   | AusenciaCodValidacao | CoberturaEspecial | OpcaoFabricante | Tabela | StatusSolicitacao
export function isCode<D extends Readonly<Record<string, string>>>(domain: D, value: unknown): value is keyof D & string
// status.ts
export const AUTHORIZATION_STATUSES: readonly AuthorizationStatus[]
export const AUTHORIZATION_TYPES: readonly AuthorizationType[]
export const isAuthorizationStatus: (v: unknown) => v is AuthorizationStatus
export const isAuthorizationType: (v: unknown) => v is AuthorizationType
export const STATUS_FROM_RESPONSE: Record<StatusSolicitacao, AuthorizationStatus>
export const statusForMissing: (missing: readonly string[]) => 'draft' | 'ready'
export const isEditable: (status: AuthorizationStatus) => boolean
export const canMarkSent: (status: AuthorizationStatus) => boolean
export const isAdminRole: (role: MembershipRole) => boolean
export function canCancel(status: AuthorizationStatus, role: MembershipRole): boolean
export function canRecordResponse(status: AuthorizationStatus, code: StatusSolicitacao, role: MembershipRole): boolean
```

`types.ts` e `constants.ts`: ver código abaixo (tipos usados por todas as tarefas seguintes).

- [ ] **6.1 Testes que falham.** Criar `tests/billing/authorizations-domain.test.ts` (as Tarefas 7 e 11 acrescentam `describe`s e imports):

```ts
import { describe, it, expect } from 'vitest'
import { STATUS_SOLICITACAO, TABELA, isCode } from '@/lib/billing/authorizations/domains'
import {
  STATUS_FROM_RESPONSE, canCancel, canMarkSent, canRecordResponse, isEditable, statusForMissing,
} from '@/lib/billing/authorizations/status'
import { AUTHORIZATION_STATUS_LABELS } from '@/lib/billing/authorizations/constants'

describe('máquina de estados (espelha os RPCs)', () => {
  it('mapeia dm_statusSolicitacao como no design (D3)', () => {
    expect(STATUS_FROM_RESPONSE).toEqual({
      '1': 'authorized', '2': 'under_review', '3': 'denied', '4': 'pending_info',
      '5': 'pending_info', '6': 'cancelled', '7': 'partially_authorized',
    })
    expect(Object.keys(STATUS_SOLICITACAO)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
  })

  it('edição só em draft/ready; envio só de ready', () => {
    expect(isEditable('draft')).toBe(true)
    expect(isEditable('ready')).toBe(true)
    for (const s of ['sent', 'under_review', 'pending_info', 'authorized', 'partially_authorized', 'denied', 'cancelled'] as const) {
      expect(isEditable(s)).toBe(false)
      expect(canMarkSent(s)).toBe(false)
    }
    expect(canMarkSent('ready')).toBe(true)
    expect(canMarkSent('draft')).toBe(false)
  })

  it('member cancela até ready; depois do envio só owner/admin; terminais nunca', () => {
    expect(canCancel('draft', 'member')).toBe(true)
    expect(canCancel('sent', 'member')).toBe(false)
    expect(canCancel('pending_info', 'admin')).toBe(true)
    expect(canCancel('authorized', 'owner')).toBe(false)
    expect(canCancel('cancelled', 'owner')).toBe(false)
  })

  it('resposta só depois do envio; código 6 exige owner/admin', () => {
    expect(canRecordResponse('ready', '1', 'owner')).toBe(false)
    expect(canRecordResponse('sent', '1', 'member')).toBe(true)
    expect(canRecordResponse('under_review', '6', 'member')).toBe(false)
    expect(canRecordResponse('under_review', '6', 'admin')).toBe(true)
    expect(canRecordResponse('denied', '1', 'owner')).toBe(false)
  })

  it('draft/ready por missing_fields', () => {
    expect(statusForMissing([])).toBe('ready')
    expect(statusForMissing(['items'])).toBe('draft')
  })

  it('domínios fechados: só códigos do XSD', () => {
    expect(isCode(TABELA, '19')).toBe(true)
    expect(isCode(TABELA, '21')).toBe(false)
    expect(isCode(TABELA, 'toString')).toBe(false)
    expect(Object.keys(AUTHORIZATION_STATUS_LABELS)).toHaveLength(9)
  })
})
```

- [ ] **6.2 Rodar e ver falhar:** `npx vitest run tests/billing/authorizations-domain.test.ts`.
- [ ] **6.3 Implementar `lib/billing/authorizations/domains.ts`:**

```ts
// Domínios do tissSimpleTypesV4_03_00.xsd usados nas solicitações de
// autorização: código exatamente como no XSD → rótulo (dos comentários do
// próprio XSD). Ver docs/superpowers/specs/2026-10-05-tiss-autorizacoes-xsd.md §6.

export const CARATER_ATENDIMENTO = { '1': 'Eletiva', '2': 'Urgência/Emergência' } as const // dm_caraterAtendimento
export const TIPO_INTERNACAO = {
  '1': 'Clínica', '2': 'Cirúrgica', '3': 'Obstétrica', '4': 'Pediátrica', '5': 'Psiquiátrica',
} as const // dm_tipoInternacao
export const REGIME_INTERNACAO = { '1': 'Hospitalar', '2': 'Hospital-dia', '3': 'Domiciliar' } as const // dm_regimeInternacao
export const INDICADOR_ACIDENTE = {
  '0': 'Trabalho', '1': 'Trânsito', '2': 'Outros acidentes', '9': 'Não acidente',
} as const // dm_indicadorAcidente
export const ETAPA_AUTORIZACAO = {
  '1': 'Autorização prévia', '2': 'Autorização pelo prestador executante',
} as const // dm_etapasAutorizacao
export const AUSENCIA_COD_VALIDACAO = {
  '01': 'Beneficiário internado',
  '02': 'Urgência/emergência',
  '03': 'Intermitência/instabilidade de sistemas',
  '04': 'Beneficiário se negou a transmitir o token',
  '05': 'Coleta domiciliar',
  '06': 'Material para exames enviado por terceiros',
  '07': 'Beneficiário não possui celular',
} as const // dm_ausenciaCodValidacao
export const COBERTURA_ESPECIAL = { '01': 'Gestante', '02': 'Pré-operatório', '03': 'Pós-operatório' } as const // dm_cobEsp
export const OPCAO_FABRICANTE = { '1': '1ª opção', '2': '2ª opção', '3': '3ª opção' } as const // dm_opcaoFabricante
// dm_tabela. 19 = Materiais é o usual para OPME [INFERIDO]: o XSD não tem
// código específico de OPME.
export const TABELA = {
  '22': 'TUSS — Procedimentos e eventos em saúde',
  '19': 'TUSS — Materiais',
  '20': 'TUSS — Medicamentos',
  '18': 'TUSS — Taxas, diárias e gases medicinais',
  '00': 'Tabela própria da operadora',
  '90': 'Tabela própria — pacote odontológico',
  '98': 'Tabela própria de pacotes',
} as const
export const STATUS_SOLICITACAO = {
  '1': 'Autorizado',
  '2': 'Em análise',
  '3': 'Negado',
  '4': 'Aguardando justificativa técnica do solicitante',
  '5': 'Aguardando documentação do prestador',
  '6': 'Solicitação cancelada',
  '7': 'Autorizado parcialmente',
} as const // dm_statusSolicitacao

export type CaraterAtendimento = keyof typeof CARATER_ATENDIMENTO
export type TipoInternacao = keyof typeof TIPO_INTERNACAO
export type RegimeInternacao = keyof typeof REGIME_INTERNACAO
export type IndicadorAcidente = keyof typeof INDICADOR_ACIDENTE
export type EtapaAutorizacao = keyof typeof ETAPA_AUTORIZACAO
export type AusenciaCodValidacao = keyof typeof AUSENCIA_COD_VALIDACAO
export type CoberturaEspecial = keyof typeof COBERTURA_ESPECIAL
export type OpcaoFabricante = keyof typeof OPCAO_FABRICANTE
export type Tabela = keyof typeof TABELA
export type StatusSolicitacao = keyof typeof STATUS_SOLICITACAO

export function isCode<D extends Readonly<Record<string, string>>>(domain: D, value: unknown): value is keyof D & string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(domain, value)
}
```

- [ ] **6.4 Implementar `lib/billing/authorizations/types.ts`:**

```ts
import type {
  TissAuthorizationEventType, TissAuthorizationItemKind, TissAuthorizationStatus, TissAuthorizationType,
} from '@/types/database'
import type {
  AusenciaCodValidacao, CaraterAtendimento, CoberturaEspecial, EtapaAutorizacao, IndicadorAcidente,
  OpcaoFabricante, RegimeInternacao, StatusSolicitacao, Tabela, TipoInternacao,
} from './domains'

export type AuthorizationType = TissAuthorizationType
export type AuthorizationStatus = TissAuthorizationStatus
export type AuthorizationItemKind = TissAuthorizationItemKind
export type AuthorizationEventType = TissAuthorizationEventType

// Snapshot (tiss_authorizations.payload). Congela operadora, contratado
// solicitante (unidade), profissional e beneficiário; "Recarregar dados"
// refaz o que vem das configurações. Tem carteirinha: nunca logar.
export interface AuthorizationProfessional {
  id: string | null // profiles.id escolhido
  name: string
  crm: string | null
  crm_uf: string | null
  cbo_code: string | null
  phone: string | null // só dígitos (telefoneProfissional st_texto11; obrigatório no OPME)
  email: string | null
}

export interface AuthorizationPayloadBase {
  insurer: { ans_registry: string; provider_code: string; tiss_version: string }
  provider: { cnes: string | null; cnpj: string | null; legal_name: string | null }
  professional: AuthorizationProfessional
  // ct_beneficiarioDados: só carteira e atendimentoRN (nome/CNS saíram na 4.00.00).
  beneficiary: { patient_insurance_id: string | null; card_number: string | null; newborn: boolean }
}

// ausenciaCodValidacao?, codValidacao?, tipoEtapaAutorizacao [1] (SP/SADT e Internação)
export interface ValidationData {
  stage: EtapaAutorizacao
  absence_code: AusenciaCodValidacao | null
  code: string | null // st_texto10
}

export interface SpSadtRequestData extends ValidationData {
  character: CaraterAtendimento
  clinical_indication: string | null // st_texto500, opcional na SP/SADT
  special_coverage: CoberturaEspecial | null
  main_guide_number: string | null // numeroGuiaPrincipal st_texto20
  executor: { operator_code: string; cnes: string } | null // dadosExecutante (codigonaOperadora + CNES)
  observation: string | null // st_texto500
}

export interface HospitalizationRequestData extends ValidationData {
  character: CaraterAtendimento
  hospital: { operator_code: string | null; name: string | null; suggested_date: string | null }
  hospitalization_type: TipoInternacao
  regime: RegimeInternacao
  daily_count: number | null // st_numerico2 (1..99)
  opme_expected: boolean
  chemo_expected: boolean
  clinical_indication: string | null // obrigatória aqui (st_texto500)
  cid10: string[] // 0..4, sem ponto (st_texto4)
  accident: IndicadorAcidente
  observation: string | null // st_texto1000
}

export interface OpmeRequestData {
  technical_justification: string | null // obrigatória (st_texto1000)
  material_specification: string | null // st_texto500
  observation: string | null // "Observacao" st_texto500
}

export interface RequestDataByType {
  sp_sadt_request: SpSadtRequestData
  hospitalization_request: HospitalizationRequestData
  opme_request: OpmeRequestData
}

// `type` repete a coluna para o TypeScript estreitar o payload pelo tipo
// (o RPC confere que são iguais).
export type AuthorizationPayload<T extends AuthorizationType> = AuthorizationPayloadBase & {
  type: T
  request: RequestDataByType[T]
}
export type AnyAuthorizationPayload = { [K in AuthorizationType]: AuthorizationPayload<K> }[AuthorizationType]

export interface AuthorizationItemInput {
  table_code: Tabela
  code: string
  description: string
  quantity_requested: number
  manufacturer_option: OpcaoFabricante | null
  requested_value_cents: number | null
  anvisa_registration: string | null
  manufacturer_reference: string | null
  operating_authorization: string | null
}

export interface AuthorizationItem extends AuthorizationItemInput {
  id: string
  position: number
  kind: AuthorizationItemKind
  quantity_authorized: number | null
  authorized_value_cents: number | null
}

export type AuthorizationMissingField =
  | 'beneficiary.card_number'
  | 'provider.legal_name'
  | 'professional.name'
  | 'professional.crm'
  | 'professional.crm_uf'
  | 'professional.cbo_code'
  | 'professional.phone'
  | 'request.clinical_indication'
  | 'request.hospital.operator_code'
  | 'request.hospital.name'
  | 'request.hospital.suggested_date'
  | 'request.daily_count'
  | 'request.technical_justification'
  | 'items'

// Entrada dos geradores XML — nada de banco.
export interface AuthorizationXmlSource<T extends AuthorizationType> {
  type: T
  providerGuideNumber: string
  requestedAt: string // YYYY-MM-DD (dataSolicitacao)
  payload: AuthorizationPayload<T>
  items: AuthorizationItem[]
}
export type AnyAuthorizationXmlSource = { [K in AuthorizationType]: AuthorizationXmlSource<K> }[AuthorizationType]

export interface AuthorizationListRow {
  id: string
  workspace_id: string
  patient_id: string
  insurer_id: string
  appointment_id: string | null
  parent_id: string | null
  type: AuthorizationType
  status: AuthorizationStatus
  provider_guide_number: string
  missing_fields: string[]
  operator_guide_number: string | null
  response_status_code: StatusSolicitacao | null
  requested_at: string
  sent_at: string | null
  responded_at: string | null
  created_at: string
  updated_at: string // repassar como string (microssegundos)
  professional_name: string | null
  health_insurers: { name: string } | null
  patients: { full_name: string } | null
}

export interface AuthorizationRow extends AuthorizationListRow {
  payload: AnyAuthorizationPayload
  password: string | null
  authorization_date: string | null
  password_valid_until: string | null
}

export interface AuthorizationSummary {
  id: string
  type: AuthorizationType
  status: AuthorizationStatus
  provider_guide_number: string
  missing_fields: string[]
}

export interface AuthorizationDetail {
  authorization: AuthorizationRow
  items: AuthorizationItem[]
  parent: AuthorizationSummary | null
  children: AuthorizationSummary[]
}

export interface AuthorizationEventRow {
  id: number
  event: AuthorizationEventType
  from_status: AuthorizationStatus | null
  to_status: AuthorizationStatus | null
  actor_id: string | null
  data: Record<string, unknown>
  created_at: string
}
```

- [ ] **6.5 Implementar `lib/billing/authorizations/constants.ts`:**

```ts
import type { AuthorizationMissingField, AuthorizationStatus, AuthorizationType } from './types'

export const AUTHORIZATION_TYPE_LABELS: Record<AuthorizationType, string> = {
  sp_sadt_request: 'SP/SADT',
  hospitalization_request: 'Internação',
  opme_request: 'Anexo OPME',
}

export const AUTHORIZATION_STATUS_LABELS: Record<AuthorizationStatus, string> = {
  draft: 'Rascunho',
  ready: 'Pronta',
  sent: 'Enviada',
  under_review: 'Em análise',
  pending_info: 'Pendente de informação',
  authorized: 'Autorizada',
  partially_authorized: 'Autorizada parcialmente',
  denied: 'Negada',
  cancelled: 'Cancelada',
}

export const AUTHORIZATION_MISSING_LABELS: Record<AuthorizationMissingField, string> = {
  'beneficiary.card_number': 'Carteirinha do paciente',
  'provider.legal_name': 'Razão social da unidade',
  'professional.name': 'Nome do profissional solicitante',
  'professional.crm': 'CRM do profissional',
  'professional.crm_uf': 'UF do CRM',
  'professional.cbo_code': 'CBO do profissional',
  'professional.phone': 'Telefone do profissional (DDD + número)',
  'request.clinical_indication': 'Indicação clínica',
  'request.hospital.operator_code': 'Código do hospital na operadora',
  'request.hospital.name': 'Nome do hospital',
  'request.hospital.suggested_date': 'Data sugerida da internação',
  'request.daily_count': 'Quantidade de diárias',
  'request.technical_justification': 'Justificativa técnica',
  items: 'Ao menos um item',
}

// Corrigidos só nas configurações (unidade/perfil); depois "Recarregar dados".
export const AUTHORIZATION_SETTINGS_FIELDS: AuthorizationMissingField[] = [
  'provider.legal_name',
  'professional.crm',
  'professional.crm_uf',
  'professional.cbo_code',
]

// O XSD não limita os itens; o limite é de usabilidade (papel: 12/6 linhas).
export const MAX_AUTHORIZATION_ITEMS = 50
// st_decimal10-2: até 99.999.999,99.
export const MAX_VALUE_CENTS = 9_999_999_999

// Colunas de tiss_authorizations para as telas. Concatenadas (como
// GUIDE_COLUMNS), então o resultado do select é convertido com cast.
export const AUTHORIZATION_LIST_COLUMNS =
  'id, workspace_id, patient_id, insurer_id, appointment_id, parent_id, type, status, provider_guide_number, ' +
  'missing_fields, operator_guide_number, response_status_code, requested_at, sent_at, responded_at, created_at, ' +
  'updated_at, professional_name:payload->professional->>name, health_insurers(name), patients(full_name)'

export const AUTHORIZATION_COLUMNS =
  AUTHORIZATION_LIST_COLUMNS + ', payload, password, authorization_date, password_valid_until'

export const AUTHORIZATION_ITEM_COLUMNS =
  'id, position, kind, table_code, code, description, quantity_requested, quantity_authorized, manufacturer_option, ' +
  'requested_value_cents, authorized_value_cents, anvisa_registration, manufacturer_reference, operating_authorization'

export const AUTHORIZATION_SUMMARY_COLUMNS = 'id, type, status, provider_guide_number, missing_fields'
```

- [ ] **6.6 Implementar `lib/billing/authorizations/status.ts`:**

```ts
import type { MembershipRole } from '@/types/database'
import type { StatusSolicitacao } from './domains'
import type { AuthorizationStatus, AuthorizationType } from './types'

// Espelho em TS das regras dos RPCs (supabase/tiss-authorizations.sql). O
// banco decide; isto serve para a UI esconder botões e a API responder
// 403/409 sem ir ao banco.
export const AUTHORIZATION_STATUSES: readonly AuthorizationStatus[] = [
  'draft', 'ready', 'sent', 'under_review', 'pending_info', 'authorized', 'partially_authorized', 'denied', 'cancelled',
]
export const AUTHORIZATION_TYPES: readonly AuthorizationType[] = ['sp_sadt_request', 'hospitalization_request', 'opme_request']

export const isAuthorizationStatus = (v: unknown): v is AuthorizationStatus =>
  typeof v === 'string' && (AUTHORIZATION_STATUSES as readonly string[]).includes(v)
export const isAuthorizationType = (v: unknown): v is AuthorizationType =>
  typeof v === 'string' && (AUTHORIZATION_TYPES as readonly string[]).includes(v)

export const STATUS_FROM_RESPONSE: Record<StatusSolicitacao, AuthorizationStatus> = {
  '1': 'authorized',
  '2': 'under_review',
  '3': 'denied',
  '4': 'pending_info',
  '5': 'pending_info',
  '6': 'cancelled',
  '7': 'partially_authorized',
}

const EDITABLE: readonly AuthorizationStatus[] = ['draft', 'ready']
const AWAITING_RESPONSE: readonly AuthorizationStatus[] = ['sent', 'under_review', 'pending_info']

export const statusForMissing = (missing: readonly string[]): 'draft' | 'ready' => (missing.length === 0 ? 'ready' : 'draft')
export const isEditable = (status: AuthorizationStatus) => EDITABLE.includes(status)
export const canMarkSent = (status: AuthorizationStatus) => status === 'ready'
export const isAdminRole = (role: MembershipRole) => role === 'owner' || role === 'admin'

export function canCancel(status: AuthorizationStatus, role: MembershipRole): boolean {
  if (EDITABLE.includes(status)) return true
  return AWAITING_RESPONSE.includes(status) && isAdminRole(role)
}

export function canRecordResponse(status: AuthorizationStatus, code: StatusSolicitacao, role: MembershipRole): boolean {
  if (!AWAITING_RESPONSE.includes(status)) return false
  return code !== '6' || isAdminRole(role)
}
```

- [ ] **6.7 Rodar e ver passar:** `npx vitest run tests/billing/authorizations-domain.test.ts` e `npx tsc --noEmit`.
- [ ] **6.8 Commit:**

```bash
git add lib/billing/authorizations tests/billing/authorizations-domain.test.ts
git commit -m "feat(tiss): domínios do XSD, tipos e máquina de estados das autorizações

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 7 — Domínio: snapshot, campos faltantes e validação dos corpos

**Modelo sugerido:** sonnet

**Files:** criar `lib/billing/authorizations/payload.ts`, `missing.ts`, `validation.ts`; modificar `tests/billing/authorizations-domain.test.ts`.

**Interfaces:**
- Consumes: tipos/domínios da Tarefa 6; `BRAZIL_UFS` (`lib/billing/constants.ts`); `isDate` (`lib/billing/validation.ts`).
- Produces:

```ts
// payload.ts
export interface ProfessionalOption { id: string; full_name: string; crm: string | null; crm_uf: string | null; cbo_code: string | null; phone: string | null; email: string | null }
export interface AuthorizationSources {
  insurer: { ans_registry: string; provider_code: string; tiss_version: string }
  workspace: { cnes: string | null; cnpj: string | null; legal_name: string | null }
  professional: ProfessionalOption | null
  patientInsurance: { id: string; card_number: string } | null
}
export function defaultRequestData<T extends AuthorizationType>(type: T): RequestDataByType[T]
export function professionalSnapshot(p: ProfessionalOption | null): AuthorizationProfessional
export function buildAuthorizationPayload<T extends AuthorizationType>(type: T, src: AuthorizationSources, request?: RequestDataByType[T]): AuthorizationPayload<T>
export function mergeRefreshedAuthorizationPayload<T extends AuthorizationType>(current: AuthorizationPayload<T>, fresh: AuthorizationPayload<T>): AuthorizationPayload<T>
export interface AuthorizationEdits<T extends AuthorizationType> { professional?: ProfessionalOption | null; patientInsurance?: { id: string; card_number: string } | null; card_number?: string | null; newborn?: boolean; professional_phone?: string | null; professional_email?: string | null; request?: RequestDataByType[T] }
export function applyAuthorizationEdits<T extends AuthorizationType>(payload: AuthorizationPayload<T>, edits: AuthorizationEdits<T>): AuthorizationPayload<T>
// missing.ts
export function computeAuthorizationMissing(payload: AnyAuthorizationPayload, itemCount: number): AuthorizationMissingField[]
// validation.ts
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
export function parseExpectedUpdatedAt(v: unknown): Result<string>
export function normalizeCid10(v: string): string | null
export function parseRequestPatch<T extends AuthorizationType>(type: T, current: RequestDataByType[T], patch: unknown): Result<RequestDataByType[T]>
export function parseItems(type: AuthorizationType, body: unknown): Result<AuthorizationItemInput[]>
export interface CreateInput { type: AuthorizationType; appointment_id: string | null; parent_id: string | null; patient_id: string | null; insurer_id: string | null; patient_insurance_id: string | null; professional_id: string | null }
export function parseCreateBody(body: unknown): Result<CreateInput>
export interface ContentPatch { expected_updated_at: string; refresh: boolean; card_number?: string | null; newborn?: boolean; patient_insurance_id?: string | null; professional_id?: string | null; professional_phone?: string | null; professional_email?: string | null; requested_at?: string; request?: unknown }
export function parseContentPatch(body: unknown): Result<ContentPatch>
export interface ResponseInput { expected_updated_at: string; status_code: StatusSolicitacao; operator_guide_number: string | null; password: string | null; authorization_date: string | null; password_valid_until: string | null; items: Array<{ id: string; quantity_authorized: number | null; authorized_value_cents: number | null }> }
export function parseResponseBody(body: unknown, items: Array<Pick<AuthorizationItem, 'id' | 'kind'>>): Result<ResponseInput>
```

- [ ] **7.1 Testes que falham.** Em `tests/billing/authorizations-domain.test.ts`, acrescentar os imports no topo e os `describe`s no fim:

```ts
import {
  applyAuthorizationEdits, buildAuthorizationPayload, defaultRequestData, mergeRefreshedAuthorizationPayload,
  type AuthorizationSources,
} from '@/lib/billing/authorizations/payload'
import { computeAuthorizationMissing } from '@/lib/billing/authorizations/missing'
import {
  normalizeCid10, parseContentPatch, parseCreateBody, parseExpectedUpdatedAt, parseItems, parseRequestPatch, parseResponseBody,
} from '@/lib/billing/authorizations/validation'

const PROFESSIONAL = { id: 'p1', full_name: 'Dra. Maria', crm: '123456/SP', crm_uf: 'SP', cbo_code: '225125', phone: '(11) 99999-0000', email: 'maria@exemplo.test' }
const SOURCES: AuthorizationSources = {
  insurer: { ans_registry: '999999', provider_code: 'PREST0001', tiss_version: '4.03.00' },
  workspace: { cnes: '1234567', cnpj: '11222333000181', legal_name: ' Clínica Fictícia ' },
  professional: PROFESSIONAL,
  patientInsurance: { id: 'pi1', card_number: '00001111' },
}

describe('snapshot da autorização', () => {
  it('congela operadora, unidade, profissional (telefone só dígitos) e carteirinha', () => {
    const p = buildAuthorizationPayload('opme_request', SOURCES)
    expect(p).toMatchObject({
      type: 'opme_request',
      provider: { legal_name: 'Clínica Fictícia' },
      professional: { id: 'p1', name: 'Dra. Maria', phone: '11999990000' },
      beneficiary: { patient_insurance_id: 'pi1', card_number: '00001111', newborn: false },
      request: { technical_justification: null },
    })
  })

  it('"Recarregar dados" troca configurações e preserva o digitado', () => {
    const current = applyAuthorizationEdits(buildAuthorizationPayload('hospitalization_request', SOURCES), {
      card_number: 'DIGITADA', professional_phone: '31988887777', newborn: true,
      request: { ...defaultRequestData('hospitalization_request'), clinical_indication: 'Dor abdominal' },
    })
    const fresh = buildAuthorizationPayload('hospitalization_request', {
      ...SOURCES,
      workspace: { ...SOURCES.workspace, legal_name: 'Razão Nova' },
      professional: { ...PROFESSIONAL, cbo_code: '225120', phone: null },
    })
    const merged = mergeRefreshedAuthorizationPayload(current, fresh)
    expect(merged.provider.legal_name).toBe('Razão Nova')
    expect(merged.professional.cbo_code).toBe('225120')
    expect(merged.professional.phone).toBe('31988887777')
    expect(merged.beneficiary).toEqual({ patient_insurance_id: 'pi1', card_number: 'DIGITADA', newborn: true })
    expect(merged.request.clinical_indication).toBe('Dor abdominal')
  })
})

describe('campos faltantes', () => {
  it('SP/SADT exige razão social, CRM/UF/CBO e itens', () => {
    const p = buildAuthorizationPayload('sp_sadt_request', { ...SOURCES, workspace: { cnes: null, cnpj: null, legal_name: null }, professional: null })
    expect(computeAuthorizationMissing(p, 0)).toEqual([
      'provider.legal_name', 'professional.crm', 'professional.crm_uf', 'professional.cbo_code', 'items',
    ])
  })

  it('Internação exige hospital, diárias e indicação clínica', () => {
    const p = buildAuthorizationPayload('hospitalization_request', SOURCES)
    expect(computeAuthorizationMissing(p, 1)).toEqual([
      'request.clinical_indication', 'request.hospital.operator_code', 'request.hospital.name',
      'request.hospital.suggested_date', 'request.daily_count',
    ])
  })

  it('OPME exige nome, telefone e justificativa — não CRM', () => {
    const p = buildAuthorizationPayload('opme_request', { ...SOURCES, professional: { ...PROFESSIONAL, crm: null, phone: '123' } })
    expect(computeAuthorizationMissing(p, 1)).toEqual(['professional.phone', 'request.technical_justification'])
  })
})

describe('validação dos corpos', () => {
  it('expected_updated_at passa como string, sem perder microssegundos', () => {
    expect(parseExpectedUpdatedAt('2026-10-05T13:00:00.123456+00:00')).toEqual({ ok: true, value: '2026-10-05T13:00:00.123456+00:00' })
    expect(parseExpectedUpdatedAt(undefined).ok).toBe(false)
  })

  it('recusa texto acima do maxLength do XSD em vez de cortar; espaços viram null', () => {
    const r = parseRequestPatch('hospitalization_request', defaultRequestData('hospitalization_request'), { observation: 'x'.repeat(1001) })
    expect(r).toEqual({ ok: false, error: 'Observação: máximo de 1000 caracteres.' })
    const ok = parseRequestPatch('sp_sadt_request', defaultRequestData('sp_sadt_request'), { observation: '   ', clinical_indication: 'Anemia' })
    expect(ok.ok && ok.value.observation).toBeNull()
    expect(ok.ok && ok.value.clinical_indication).toBe('Anemia')
  })

  it('valida domínios, diárias, CIDs e hospital', () => {
    const base = defaultRequestData('hospitalization_request')
    expect(parseRequestPatch('hospitalization_request', base, { regime: '4' }).ok).toBe(false)
    expect(parseRequestPatch('hospitalization_request', base, { daily_count: 100 }).ok).toBe(false)
    expect(parseRequestPatch('hospitalization_request', base, { cid10: ['a', 'b', 'c', 'd', 'e'] }).ok).toBe(false)
    const r = parseRequestPatch('hospitalization_request', base, {
      cid10: ['k35.9', 'R10'], hospital: { operator_code: 'H1', name: 'Hospital', suggested_date: '2026-10-20' }, daily_count: 3,
    })
    expect(r.ok && r.value.cid10).toEqual(['K359', 'R10'])
    expect(r.ok && r.value.hospital).toEqual({ operator_code: 'H1', name: 'Hospital', suggested_date: '2026-10-20' })
    expect(normalizeCid10('Z00.00')).toBeNull()
    expect(parseRequestPatch('opme_request', defaultRequestData('opme_request'), { unknown: 1 }).ok).toBe(false)
  })

  it('itens: procedimento sem campos de OPME; OPME com opção de fabricante', () => {
    const proc = parseItems('sp_sadt_request', [{ table_code: '22', code: '40301010', description: 'Hemograma', quantity_requested: 1, manufacturer_option: '1' }])
    expect(proc.ok && proc.value[0].manufacturer_option).toBeNull()
    expect(parseItems('opme_request', [{ table_code: '19', code: '7000', description: 'Placa', quantity_requested: 1 }]).ok).toBe(false)
    expect(parseItems('sp_sadt_request', [{ table_code: '21', code: '1', description: 'X', quantity_requested: 1 }]).ok).toBe(false)
    expect(parseItems('sp_sadt_request', [{ table_code: '22', code: '1', description: 'X', quantity_requested: 1000 }]).ok).toBe(false)
    expect(parseItems('sp_sadt_request', [{ table_code: '22', code: 'COD COM ESPACO', description: 'X', quantity_requested: 1 }]).ok).toBe(false)
    const opme = parseItems('opme_request', [{ table_code: '19', code: '7000', description: 'Placa', quantity_requested: 2,
      manufacturer_option: '2', requested_value_cents: 150000, anvisa_registration: '8000000001' }])
    expect(opme.ok && opme.value[0]).toMatchObject({ manufacturer_option: '2', requested_value_cents: 150000 })
  })

  it('criação: OPME exige pai; outros exigem agendamento ou paciente+operadora', () => {
    const uuid = '30000000-0000-0000-0000-000000000001'
    expect(parseCreateBody({ type: 'opme_request' }).ok).toBe(false)
    expect(parseCreateBody({ type: 'sp_sadt_request', parent_id: uuid }).ok).toBe(false)
    expect(parseCreateBody({ type: 'sp_sadt_request' }).ok).toBe(false)
    expect(parseCreateBody({ type: 'sp_sadt_request', appointment_id: uuid }).ok).toBe(true)
    expect(parseCreateBody({ type: 'hospitalization_request', patient_id: uuid, insurer_id: uuid }).ok).toBe(true)
    expect(parseCreateBody({ type: 'consulta', appointment_id: uuid }).ok).toBe(false)
  })

  it('conteúdo: carteirinha até 20, telefone 10–11 dígitos, e-mail até 60', () => {
    const at = '2026-10-05T13:00:00.123456+00:00'
    expect(parseContentPatch({ expected_updated_at: at, card_number: '1'.repeat(21) }).ok).toBe(false)
    expect(parseContentPatch({ expected_updated_at: at, professional_phone: '(31) 98888-7777' })).toEqual({
      ok: true, value: { expected_updated_at: at, refresh: false, professional_phone: '31988887777' },
    })
    expect(parseContentPatch({ expected_updated_at: at, professional_email: `${'a'.repeat(55)}@x.com` }).ok).toBe(false)
    expect(parseContentPatch({ action: 'refresh', expected_updated_at: at })).toEqual({ ok: true, value: { expected_updated_at: at, refresh: true } })
  })

  it('resposta: código do XSD, itens da própria autorização, valor só em OPME', () => {
    const at = '2026-10-05T13:00:00Z'
    const items = [{ id: 'a', kind: 'procedure' as const }, { id: 'b', kind: 'opme' as const }]
    expect(parseResponseBody({ expected_updated_at: at, status_code: '8' }, items).ok).toBe(false)
    expect(parseResponseBody({ expected_updated_at: at, status_code: '1', items: [{ id: 'z', quantity_authorized: 1 }] }, items).ok).toBe(false)
    expect(parseResponseBody({ expected_updated_at: at, status_code: '1', items: [{ id: 'a', authorized_value_cents: 10 }] }, items).ok).toBe(false)
    const r = parseResponseBody({ expected_updated_at: at, status_code: '7', operator_guide_number: ' OP1 ', password: 'S1',
      authorization_date: '2026-10-06', items: [{ id: 'b', quantity_authorized: 1, authorized_value_cents: 100 }] }, items)
    expect(r).toEqual({ ok: true, value: { expected_updated_at: at, status_code: '7', operator_guide_number: 'OP1', password: 'S1',
      authorization_date: '2026-10-06', password_valid_until: null, items: [{ id: 'b', quantity_authorized: 1, authorized_value_cents: 100 }] } })
  })
})
```

- [ ] **7.2 Rodar e ver falhar:** `npx vitest run tests/billing/authorizations-domain.test.ts`.

- [ ] **7.3 Implementar `lib/billing/authorizations/payload.ts`:**

```ts
import type {
  AuthorizationPayload, AuthorizationProfessional, AuthorizationType, RequestDataByType,
} from './types'

export interface ProfessionalOption {
  id: string
  full_name: string
  crm: string | null
  crm_uf: string | null
  cbo_code: string | null
  phone: string | null
  email: string | null
}

export interface AuthorizationSources {
  insurer: { ans_registry: string; provider_code: string; tiss_version: string }
  workspace: { cnes: string | null; cnpj: string | null; legal_name: string | null }
  professional: ProfessionalOption | null
  patientInsurance: { id: string; card_number: string } | null
}

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)
const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '') || null

// Valores iniciais. tipoEtapaAutorizacao é obrigatório no XSD e não existe no
// formulário em papel: começa em "1 - autorização prévia". Caráter eletivo e
// "não acidente" como nas guias. O resto começa vazio e vira missing_fields.
const DEFAULT_REQUEST: RequestDataByType = {
  sp_sadt_request: {
    stage: '1', absence_code: null, code: null, character: '1', clinical_indication: null,
    special_coverage: null, main_guide_number: null, executor: null, observation: null,
  },
  hospitalization_request: {
    stage: '1', absence_code: null, code: null, character: '1',
    hospital: { operator_code: null, name: null, suggested_date: null },
    hospitalization_type: '1', regime: '1', daily_count: null, opme_expected: false, chemo_expected: false,
    clinical_indication: null, cid10: [], accident: '9', observation: null,
  },
  opme_request: { technical_justification: null, material_specification: null, observation: null },
}

export function defaultRequestData<T extends AuthorizationType>(type: T): RequestDataByType[T] {
  return structuredClone(DEFAULT_REQUEST[type])
}

export function professionalSnapshot(p: ProfessionalOption | null): AuthorizationProfessional {
  return {
    id: p?.id ?? null,
    name: p?.full_name.trim() ?? '',
    crm: blank(p?.crm),
    crm_uf: blank(p?.crm_uf),
    cbo_code: blank(p?.cbo_code),
    phone: digits(p?.phone),
    email: blank(p?.email),
  }
}

export function buildAuthorizationPayload<T extends AuthorizationType>(
  type: T,
  src: AuthorizationSources,
  request: RequestDataByType[T] = defaultRequestData(type),
): AuthorizationPayload<T> {
  return {
    type,
    insurer: { ...src.insurer },
    provider: {
      cnes: blank(src.workspace.cnes),
      cnpj: blank(src.workspace.cnpj),
      legal_name: blank(src.workspace.legal_name),
    },
    professional: professionalSnapshot(src.professional),
    beneficiary: {
      patient_insurance_id: src.patientInsurance?.id ?? null,
      card_number: blank(src.patientInsurance?.card_number),
      newborn: false,
    },
    request,
  }
}

// "Recarregar dados": operadora, unidade e cadastro do profissional vêm do
// fresh; telefone/e-mail, carteirinha digitada, RN e todo o pedido clínico
// ficam como estavam (mesmo padrão de mergeRefreshedPayload das guias).
export function mergeRefreshedAuthorizationPayload<T extends AuthorizationType>(
  current: AuthorizationPayload<T>,
  fresh: AuthorizationPayload<T>,
): AuthorizationPayload<T> {
  return {
    ...fresh,
    professional: {
      ...fresh.professional,
      phone: current.professional.phone ?? fresh.professional.phone,
      email: current.professional.email ?? fresh.professional.email,
    },
    beneficiary: {
      patient_insurance_id: current.beneficiary.patient_insurance_id ?? fresh.beneficiary.patient_insurance_id,
      card_number: current.beneficiary.card_number ?? fresh.beneficiary.card_number,
      newborn: current.beneficiary.newborn,
    },
    request: current.request,
  }
}

export interface AuthorizationEdits<T extends AuthorizationType> {
  professional?: ProfessionalOption | null
  patientInsurance?: { id: string; card_number: string } | null
  card_number?: string | null
  newborn?: boolean
  professional_phone?: string | null
  professional_email?: string | null
  request?: RequestDataByType[T]
}

// Ordem: troca de profissional/carteira primeiro; depois os campos digitados.
export function applyAuthorizationEdits<T extends AuthorizationType>(
  payload: AuthorizationPayload<T>,
  edits: AuthorizationEdits<T>,
): AuthorizationPayload<T> {
  const next: AuthorizationPayload<T> = {
    ...payload,
    professional: { ...payload.professional },
    beneficiary: { ...payload.beneficiary },
  }
  if (edits.professional !== undefined) next.professional = professionalSnapshot(edits.professional)
  if (edits.patientInsurance !== undefined) {
    next.beneficiary.patient_insurance_id = edits.patientInsurance?.id ?? null
    next.beneficiary.card_number = blank(edits.patientInsurance?.card_number)
  }
  if (edits.card_number !== undefined) next.beneficiary.card_number = blank(edits.card_number)
  if (edits.newborn !== undefined) next.beneficiary.newborn = edits.newborn
  if (edits.professional_phone !== undefined) next.professional.phone = digits(edits.professional_phone)
  if (edits.professional_email !== undefined) next.professional.email = blank(edits.professional_email)
  if (edits.request !== undefined) next.request = edits.request
  return next
}
```

- [ ] **7.4 Implementar `lib/billing/authorizations/missing.ts`:**

```ts
import { BRAZIL_UFS } from '../constants'
import type { AnyAuthorizationPayload, AuthorizationMissingField } from './types'

// Campos que o XSD exige e que o MedScale pode não ter. O XSD confere de novo
// na geração do XML (tamanho exato, enum de CBOS etc.). O SQL acrescenta
// 'items' por conta própria se não houver item.
export function computeAuthorizationMissing(payload: AnyAuthorizationPayload, itemCount: number): AuthorizationMissingField[] {
  const missing: AuthorizationMissingField[] = []
  const { beneficiary, professional, provider } = payload

  if (!beneficiary.card_number) missing.push('beneficiary.card_number')

  if (payload.type === 'opme_request') {
    // ctm_anexoSolicitante: nome [1], telefone [1] (st_texto11), e-mail [0..1].
    if (!professional.name.trim()) missing.push('professional.name')
    if (!professional.phone || !/^\d{10,11}$/.test(professional.phone)) missing.push('professional.phone')
    if (!payload.request.technical_justification) missing.push('request.technical_justification')
  } else {
    // nomeContratadoSolicitante só existe na SP/SADT.
    if (payload.type === 'sp_sadt_request' && !provider.legal_name) missing.push('provider.legal_name')
    // ct_contratadoProfissionalDados: conselho, número, UF e CBOS [1].
    if (!professional.crm || !/\d/.test(professional.crm)) missing.push('professional.crm')
    if (!professional.crm_uf || !(BRAZIL_UFS as readonly string[]).includes(professional.crm_uf)) {
      missing.push('professional.crm_uf')
    }
    if (!professional.cbo_code || !/^\d{6}$/.test(professional.cbo_code)) missing.push('professional.cbo_code')
    if (payload.type === 'hospitalization_request') {
      const r = payload.request
      if (!r.clinical_indication) missing.push('request.clinical_indication')
      if (!r.hospital.operator_code) missing.push('request.hospital.operator_code')
      if (!r.hospital.name) missing.push('request.hospital.name')
      if (!r.hospital.suggested_date) missing.push('request.hospital.suggested_date')
      if (r.daily_count == null) missing.push('request.daily_count')
    }
  }

  if (itemCount === 0) missing.push('items')
  return missing
}
```

- [ ] **7.5 Implementar `lib/billing/authorizations/validation.ts`:**

```ts
import { isDate } from '../validation'
import { MAX_AUTHORIZATION_ITEMS, MAX_VALUE_CENTS } from './constants'
import {
  AUSENCIA_COD_VALIDACAO, CARATER_ATENDIMENTO, COBERTURA_ESPECIAL, ETAPA_AUTORIZACAO, INDICADOR_ACIDENTE,
  OPCAO_FABRICANTE, REGIME_INTERNACAO, STATUS_SOLICITACAO, TABELA, TIPO_INTERNACAO, isCode,
  type StatusSolicitacao,
} from './domains'
import { isAuthorizationType } from './status'
import type { AuthorizationItem, AuthorizationItemInput, AuthorizationType, RequestDataByType } from './types'

// Corpos das rotas /api/billing/authorizations/*. Texto acima do maxLength do
// XSD é recusado (400) — nunca cortado em silêncio. O gerador XML ainda corta
// texto livre por defesa, mas identificadores nunca.

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function optionalText(v: unknown, max: number, label: string): Result<string | null> {
  if (v === null || v === undefined) return ok(null)
  if (typeof v !== 'string') return fail(`${label}: valor inválido.`)
  const t = v.trim()
  if (!t) return ok(null)
  if (t.length > max) return fail(`${label}: máximo de ${max} caracteres.`)
  return ok(t)
}

function optionalDate(v: unknown, label: string): Result<string | null> {
  if (v === null || v === undefined || v === '') return ok(null)
  return isDate(v) ? ok(v as string) : fail(`${label}: data inválida.`)
}

function optionalUuid(v: unknown, label: string): Result<string | null> {
  if (v === null || v === undefined || v === '') return ok(null)
  return typeof v === 'string' && UUID.test(v) ? ok(v) : fail(`${label}: identificador inválido.`)
}

function optionalCents(v: unknown, label: string): Result<number | null> {
  if (v === null || v === undefined) return ok(null)
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_VALUE_CENTS
    ? ok(v as number)
    : fail(`${label}: valor inválido.`)
}

// Repassado ao RPC exatamente como veio do banco: new Date() perderia os
// microssegundos e o RPC acusaria "alterada por outra pessoa".
export function parseExpectedUpdatedAt(v: unknown): Result<string> {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? ok(v) : fail('expected_updated_at é obrigatório.')
}

// CID-10 sem ponto e em maiúsculas: "k35.9" → "K359" (st_texto4).
export function normalizeCid10(v: string): string | null {
  const c = v.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  return /^[A-Z][0-9]{2,3}$/.test(c) ? c : null
}

type FieldSpec =
  | { kind: 'text'; max: number; label: string }
  | { kind: 'code'; domain: Readonly<Record<string, string>>; label: string; nullable: boolean }
  | { kind: 'bool'; label: string }
  | { kind: 'int'; min: number; max: number; label: string }

const VALIDATION_FIELDS: Record<string, FieldSpec> = {
  stage: { kind: 'code', domain: ETAPA_AUTORIZACAO, label: 'Etapa da autorização', nullable: false },
  absence_code: { kind: 'code', domain: AUSENCIA_COD_VALIDACAO, label: 'Ausência do código de validação', nullable: true },
  code: { kind: 'text', max: 10, label: 'Código de validação' },
}
const CHARACTER: FieldSpec = { kind: 'code', domain: CARATER_ATENDIMENTO, label: 'Caráter do atendimento', nullable: false }

const REQUEST_FIELDS: { [K in AuthorizationType]: Record<string, FieldSpec> } = {
  sp_sadt_request: {
    ...VALIDATION_FIELDS,
    character: CHARACTER,
    clinical_indication: { kind: 'text', max: 500, label: 'Indicação clínica' },
    special_coverage: { kind: 'code', domain: COBERTURA_ESPECIAL, label: 'Cobertura especial', nullable: true },
    main_guide_number: { kind: 'text', max: 20, label: 'Número da guia principal' },
    observation: { kind: 'text', max: 500, label: 'Observação' },
  },
  hospitalization_request: {
    ...VALIDATION_FIELDS,
    character: CHARACTER,
    hospitalization_type: { kind: 'code', domain: TIPO_INTERNACAO, label: 'Tipo de internação', nullable: false },
    regime: { kind: 'code', domain: REGIME_INTERNACAO, label: 'Regime de internação', nullable: false },
    daily_count: { kind: 'int', min: 1, max: 99, label: 'Diárias solicitadas' },
    opme_expected: { kind: 'bool', label: 'Previsão de OPME' },
    chemo_expected: { kind: 'bool', label: 'Previsão de quimioterápico' },
    clinical_indication: { kind: 'text', max: 500, label: 'Indicação clínica' },
    accident: { kind: 'code', domain: INDICADOR_ACIDENTE, label: 'Indicação de acidente', nullable: false },
    observation: { kind: 'text', max: 1000, label: 'Observação' },
  },
  opme_request: {
    technical_justification: { kind: 'text', max: 1000, label: 'Justificativa técnica' },
    material_specification: { kind: 'text', max: 500, label: 'Especificação do material' },
    observation: { kind: 'text', max: 500, label: 'Observação' },
  },
}

function parseField(spec: FieldSpec, v: unknown): Result<unknown> {
  switch (spec.kind) {
    case 'text':
      return optionalText(v, spec.max, spec.label)
    case 'bool':
      return typeof v === 'boolean' ? ok(v) : fail(`${spec.label}: valor inválido.`)
    case 'int':
      if (v === null || v === '') return ok(null)
      return Number.isInteger(v) && (v as number) >= spec.min && (v as number) <= spec.max
        ? ok(v)
        : fail(`${spec.label}: entre ${spec.min} e ${spec.max}.`)
    case 'code':
      if (spec.nullable && (v === null || v === '')) return ok(null)
      return isCode(spec.domain, v) ? ok(v) : fail(`${spec.label}: opção inválida.`)
  }
}

// Aplica um patch parcial sobre o pedido atual. Chaves desconhecidas → 400.
export function parseRequestPatch<T extends AuthorizationType>(
  type: T,
  current: RequestDataByType[T],
  patch: unknown,
): Result<RequestDataByType[T]> {
  if (!isRecord(patch)) return fail('Dados da solicitação inválidos.')
  const next = structuredClone(current) as unknown as Record<string, unknown>
  const specs: Record<string, FieldSpec> = REQUEST_FIELDS[type]

  for (const [key, value] of Object.entries(patch)) {
    const spec = specs[key]
    if (spec) {
      const r = parseField(spec, value)
      if (!r.ok) return fail(r.error)
      next[key] = r.value
    } else if (type === 'sp_sadt_request' && key === 'executor') {
      if (value === null) {
        next.executor = null
        continue
      }
      if (!isRecord(value)) return fail('Executante inválido.')
      const code = optionalText(value.operator_code, 14, 'Código do executante na operadora')
      if (!code.ok) return fail(code.error)
      const cnes = typeof value.cnes === 'string' ? value.cnes.replace(/\D/g, '') : ''
      if (!code.value || !/^\d{7}$/.test(cnes)) return fail('Executante: código na operadora e CNES (7 dígitos) são obrigatórios.')
      next.executor = { operator_code: code.value, cnes }
    } else if (type === 'hospitalization_request' && key === 'hospital') {
      if (!isRecord(value)) return fail('Hospital inválido.')
      const hospital = { ...(next.hospital as Record<string, unknown>) }
      if ('operator_code' in value) {
        const r = optionalText(value.operator_code, 14, 'Código do hospital na operadora')
        if (!r.ok) return fail(r.error)
        hospital.operator_code = r.value
      }
      if ('name' in value) {
        const r = optionalText(value.name, 70, 'Nome do hospital')
        if (!r.ok) return fail(r.error)
        hospital.name = r.value
      }
      if ('suggested_date' in value) {
        const r = optionalDate(value.suggested_date, 'Data sugerida da internação')
        if (!r.ok) return fail(r.error)
        hospital.suggested_date = r.value
      }
      next.hospital = hospital
    } else if (type === 'hospitalization_request' && key === 'cid10') {
      if (!Array.isArray(value) || value.length > 4) return fail('Informe até 4 CIDs.')
      const cids: string[] = []
      for (const raw of value) {
        const cid = typeof raw === 'string' ? normalizeCid10(raw) : null
        if (!cid) return fail('CID-10 inválido (ex.: K35.9).')
        cids.push(cid)
      }
      next.cid10 = cids
    } else {
      return fail(`Campo desconhecido: ${key}.`)
    }
  }
  return ok(next as unknown as RequestDataByType[T])
}

export function parseItems(type: AuthorizationType, body: unknown): Result<AuthorizationItemInput[]> {
  if (!Array.isArray(body)) return fail('Itens inválidos.')
  if (body.length > MAX_AUTHORIZATION_ITEMS) return fail(`No máximo ${MAX_AUTHORIZATION_ITEMS} itens.`)
  const opme = type === 'opme_request'
  const out: AuthorizationItemInput[] = []

  for (let i = 0; i < body.length; i++) {
    const raw: unknown = body[i]
    const n = i + 1
    if (!isRecord(raw)) return fail(`Item ${n} inválido.`)
    if (!isCode(TABELA, raw.table_code)) return fail(`Item ${n}: tabela inválida.`)
    const code = typeof raw.code === 'string' ? raw.code.trim() : ''
    // codigoProcedimento st_texto10 — identificador, nunca cortado.
    if (!/^[0-9A-Za-z.-]{1,10}$/.test(code)) return fail(`Item ${n}: código inválido (até 10 caracteres, sem espaços).`)
    const description = optionalText(raw.description, 150, `Item ${n} — descrição`)
    if (!description.ok) return fail(description.error)
    if (!description.value) return fail(`Item ${n}: descrição é obrigatória.`)
    const quantity = raw.quantity_requested
    if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 999) {
      return fail(`Item ${n}: quantidade entre 1 e 999.`)
    }
    const item: AuthorizationItemInput = {
      table_code: raw.table_code,
      code,
      description: description.value,
      quantity_requested: quantity as number,
      manufacturer_option: null,
      requested_value_cents: null,
      anvisa_registration: null,
      manufacturer_reference: null,
      operating_authorization: null,
    }
    if (opme) {
      if (!isCode(OPCAO_FABRICANTE, raw.manufacturer_option)) return fail(`Item ${n}: opção de fabricante é obrigatória.`)
      item.manufacturer_option = raw.manufacturer_option
      const value = optionalCents(raw.requested_value_cents, `Item ${n} — valor`)
      if (!value.ok) return fail(value.error)
      item.requested_value_cents = value.value
      for (const [field, max, label] of [
        ['anvisa_registration', 15, 'registro ANVISA'],
        ['manufacturer_reference', 60, 'referência do fabricante'],
        ['operating_authorization', 30, 'autorização de funcionamento'],
      ] as const) {
        const r = optionalText(raw[field], max, `Item ${n} — ${label}`)
        if (!r.ok) return fail(r.error)
        item[field] = r.value
      }
    }
    out.push(item)
  }
  return ok(out)
}

export interface CreateInput {
  type: AuthorizationType
  appointment_id: string | null
  parent_id: string | null
  patient_id: string | null
  insurer_id: string | null
  patient_insurance_id: string | null
  professional_id: string | null
}

export function parseCreateBody(body: unknown): Result<CreateInput> {
  if (!isRecord(body) || !isAuthorizationType(body.type)) return fail('Tipo de autorização inválido.')
  const out: CreateInput = {
    type: body.type, appointment_id: null, parent_id: null, patient_id: null,
    insurer_id: null, patient_insurance_id: null, professional_id: null,
  }
  for (const key of ['appointment_id', 'parent_id', 'patient_id', 'insurer_id', 'patient_insurance_id', 'professional_id'] as const) {
    const r = optionalUuid(body[key], key)
    if (!r.ok) return fail(r.error)
    out[key] = r.value
  }
  if ((out.type === 'opme_request') !== (out.parent_id !== null)) {
    return fail('O anexo OPME é criado a partir de uma SP/SADT ou Internação.')
  }
  if (out.type !== 'opme_request' && !out.appointment_id && !(out.patient_id && out.insurer_id)) {
    return fail('Informe o agendamento ou o paciente e a operadora.')
  }
  return ok(out)
}

export interface ContentPatch {
  expected_updated_at: string
  refresh: boolean
  card_number?: string | null
  newborn?: boolean
  patient_insurance_id?: string | null
  professional_id?: string | null
  professional_phone?: string | null
  professional_email?: string | null
  requested_at?: string
  request?: unknown
}

export function parseContentPatch(body: unknown): Result<ContentPatch> {
  if (!isRecord(body)) return fail('Corpo inválido.')
  const at = parseExpectedUpdatedAt(body.expected_updated_at)
  if (!at.ok) return fail(at.error)
  const out: ContentPatch = { expected_updated_at: at.value, refresh: body.action === 'refresh' }
  if (out.refresh) return ok(out)

  if ('card_number' in body) {
    // numeroCarteira st_texto20 — identificador.
    const r = optionalText(body.card_number, 20, 'Carteirinha')
    if (!r.ok) return fail(r.error)
    out.card_number = r.value
  }
  if ('newborn' in body) {
    if (typeof body.newborn !== 'boolean') return fail('Atendimento a RN inválido.')
    out.newborn = body.newborn
  }
  for (const key of ['patient_insurance_id', 'professional_id'] as const) {
    if (key in body) {
      const r = optionalUuid(body[key], key)
      if (!r.ok) return fail(r.error)
      out[key] = r.value
    }
  }
  if ('professional_phone' in body) {
    const raw = typeof body.professional_phone === 'string' ? body.professional_phone.replace(/\D/g, '') : ''
    if (raw && !/^\d{10,11}$/.test(raw)) return fail('Telefone: DDD + número (10 ou 11 dígitos).')
    out.professional_phone = raw || null
  }
  if ('professional_email' in body) {
    const r = optionalText(body.professional_email, 60, 'E-mail do profissional')
    if (!r.ok) return fail(r.error)
    if (r.value && !/^[^\s@]+@[^\s@]+$/.test(r.value)) return fail('E-mail do profissional inválido.')
    out.professional_email = r.value
  }
  if ('requested_at' in body) {
    if (!isDate(body.requested_at)) return fail('Data da solicitação inválida.')
    out.requested_at = body.requested_at as string
  }
  if ('request' in body) out.request = body.request
  return ok(out)
}

export interface ResponseInput {
  expected_updated_at: string
  status_code: StatusSolicitacao
  operator_guide_number: string | null
  password: string | null
  authorization_date: string | null
  password_valid_until: string | null
  items: Array<{ id: string; quantity_authorized: number | null; authorized_value_cents: number | null }>
}

export function parseResponseBody(
  body: unknown,
  items: Array<Pick<AuthorizationItem, 'id' | 'kind'>>,
): Result<ResponseInput> {
  if (!isRecord(body)) return fail('Corpo inválido.')
  const at = parseExpectedUpdatedAt(body.expected_updated_at)
  if (!at.ok) return fail(at.error)
  if (!isCode(STATUS_SOLICITACAO, body.status_code)) return fail('Status da resposta inválido.')
  const number = optionalText(body.operator_guide_number, 20, 'Número da guia na operadora')
  if (!number.ok) return fail(number.error)
  const password = optionalText(body.password, 20, 'Senha')
  if (!password.ok) return fail(password.error)
  const authorizationDate = optionalDate(body.authorization_date, 'Data da autorização')
  if (!authorizationDate.ok) return fail(authorizationDate.error)
  const validUntil = optionalDate(body.password_valid_until, 'Validade da senha')
  if (!validUntil.ok) return fail(validUntil.error)

  const byId = new Map(items.map((i) => [i.id, i]))
  const rawItems = body.items ?? []
  if (!Array.isArray(rawItems)) return fail('Itens da resposta inválidos.')
  const outItems: ResponseInput['items'] = []
  for (const raw of rawItems) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !byId.has(raw.id)) {
      return fail('Item da resposta não pertence a esta autorização.')
    }
    const q = raw.quantity_authorized ?? null
    if (q !== null && (!Number.isInteger(q) || (q as number) < 0 || (q as number) > 999)) {
      return fail('Quantidade autorizada entre 0 e 999.')
    }
    const value = optionalCents(raw.authorized_value_cents, 'Valor autorizado')
    if (!value.ok) return fail(value.error)
    if (value.value !== null && byId.get(raw.id)?.kind !== 'opme') return fail('Valor autorizado só existe para itens de OPME.')
    outItems.push({ id: raw.id, quantity_authorized: q as number | null, authorized_value_cents: value.value })
  }

  return ok({
    expected_updated_at: at.value,
    status_code: body.status_code,
    operator_guide_number: number.value,
    password: password.value,
    authorization_date: authorizationDate.value,
    password_valid_until: validUntil.value,
    items: outItems,
  })
}
```

- [ ] **7.6 Rodar e ver passar:** `npx vitest run tests/billing/authorizations-domain.test.ts` e `npx tsc --noEmit`.
- [ ] **7.7 Commit:**

```bash
git add lib/billing/authorizations tests/billing/authorizations-domain.test.ts
git commit -m "feat(tiss): snapshot, campos pendentes e validação das autorizações

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 8 — XML: extrair `cabecalho`/`mensagemTISS` para `envelope.ts` sem mudar o lote

**Modelo sugerido:** sonnet

**Files:** criar `lib/tiss/v4_03_00/envelope.ts`, `tests/tiss/envelope.test.ts`; modificar `lib/tiss/v4_03_00/batch.ts`.

**Interfaces:**
- Consumes: `el`, `serialize`, `XmlNode` (`lib/tiss/xml.ts`); `epilogueHash` (`hash.ts`); `BuiltBatch` (`lib/billing/types.ts`).
- Produces:

```ts
export const VERSION = '4.03.00'
export type TipoTransacao = 'ENVIO_LOTE_GUIAS' | 'SOLICITACAO_PROCEDIMENTOS' | 'ENVIO_ANEXO'
export function cabecalho(input: {
  tipoTransacao: TipoTransacao
  sequencialTransacao: string
  now: Date
  insurer: { ans_registry: string; provider_code: string }
}): XmlNode
export function mensagemTISS(head: XmlNode, body: XmlNode): BuiltBatch
```
`batch.ts` continua exportando `VERSION`, `MAX_GUIDES_PER_BATCH`, `buildBatch`, `validate`, `v4_03_00` com as mesmas assinaturas.

- [ ] **8.1 Teste que falha.** Criar `tests/tiss/envelope.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { cabecalho, mensagemTISS } from '@/lib/tiss/v4_03_00/envelope'
import { el, serialize } from '@/lib/tiss/xml'
import { epilogueHash } from '@/lib/tiss/v4_03_00/hash'
import { FAKE_INSURER, FIXED_NOW } from './fixtures'

describe('envelope mensagemTISS', () => {
  it('monta o cabecalho com o tipo de transação pedido, no fuso de São Paulo', () => {
    const head = cabecalho({ tipoTransacao: 'SOLICITACAO_PROCEDIMENTOS', sequencialTransacao: '41', now: FIXED_NOW, insurer: FAKE_INSURER })
    expect(serialize(head).toString('latin1')).toContain(
      '<ans:identificacaoTransacao><ans:tipoTransacao>SOLICITACAO_PROCEDIMENTOS</ans:tipoTransacao>' +
      '<ans:sequencialTransacao>41</ans:sequencialTransacao><ans:dataRegistroTransacao>2026-09-29</ans:dataRegistroTransacao>' +
      '<ans:horaRegistroTransacao>18:30:00</ans:horaRegistroTransacao></ans:identificacaoTransacao>' +
      '<ans:origem><ans:identificacaoPrestador><ans:codigoPrestadorNaOperadora>PREST0001</ans:codigoPrestadorNaOperadora>' +
      '</ans:identificacaoPrestador></ans:origem><ans:destino><ans:registroANS>999999</ans:registroANS></ans:destino>' +
      '<ans:Padrao>4.03.00</ans:Padrao>',
    )
  })

  it('o epílogo leva o hash de cabecalho + corpo', () => {
    const head = cabecalho({ tipoTransacao: 'ENVIO_ANEXO', sequencialTransacao: '1', now: FIXED_NOW, insurer: FAKE_INSURER })
    const body = el('prestadorParaOperadora', [el('x', 'y')])
    const { xml, hash } = mensagemTISS(head, body)
    expect(hash).toBe(epilogueHash([head, body]))
    expect(xml.toString('latin1')).toContain(`<ans:epilogo><ans:hash>${hash}</ans:hash></ans:epilogo></ans:mensagemTISS>`)
  })
})
```

- [ ] **8.2 Rodar e ver falhar:** `npx vitest run tests/tiss/envelope.test.ts`.
- [ ] **8.3 Implementar `lib/tiss/v4_03_00/envelope.ts`** (código movido de `buildBatch`, sem mudança de conteúdo):

```ts
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import { el, serialize, type XmlNode } from '../xml'
import { epilogueHash } from './hash'
import type { BuiltBatch } from '@/lib/billing/types'

export const VERSION = '4.03.00'
const TZ = 'America/Sao_Paulo'

// dm_tipoTransacao usados pelo MedScale. O XSD não amarra o valor ao ramo de
// prestadorParaOperadora; SOLICITACAO_PROCEDIMENTOS (solicitacaoProcedimento)
// e ENVIO_ANEXO (loteAnexos) seguem a correspondência de nomes [INFERIDO].
export type TipoTransacao = 'ENVIO_LOTE_GUIAS' | 'SOLICITACAO_PROCEDIMENTOS' | 'ENVIO_ANEXO'

// cabecalhoTransacao — idêntico para lote de guias, solicitação e anexo.
export function cabecalho(input: {
  tipoTransacao: TipoTransacao
  sequencialTransacao: string
  now: Date
  insurer: { ans_registry: string; provider_code: string }
}): XmlNode {
  const now = new TZDate(input.now, TZ)
  return el('cabecalho', [
    el('identificacaoTransacao', [
      el('tipoTransacao', input.tipoTransacao),
      el('sequencialTransacao', input.sequencialTransacao),
      el('dataRegistroTransacao', format(now, 'yyyy-MM-dd')),
      el('horaRegistroTransacao', format(now, 'HH:mm:ss')),
    ]),
    el('origem', [el('identificacaoPrestador', [el('codigoPrestadorNaOperadora', input.insurer.provider_code)])]),
    el('destino', [el('registroANS', input.insurer.ans_registry)]),
    el('Padrao', VERSION),
  ])
}

// mensagemTISS = cabecalho + prestadorParaOperadora + epilogo(hash). O hash
// sai da mesma árvore serializada (hash.ts).
export function mensagemTISS(head: XmlNode, body: XmlNode): BuiltBatch {
  const hash = epilogueHash([head, body])
  const xml = serialize(el('mensagemTISS', [head, body, el('epilogo', [el('hash', hash)])]))
  return { xml, hash }
}
```

- [ ] **8.4 Refatorar `lib/tiss/v4_03_00/batch.ts`:** remover os imports de `TZDate`, `format`, `serialize`, `epilogueHash` e a constante `TZ`; importar `{ VERSION, cabecalho, mensagemTISS } from './envelope'` e reexportar `export { VERSION }` (remover a declaração local `export const VERSION`). O corpo de `buildBatch` fica:

```ts
export function buildBatch(input: BatchInput): BuiltBatch {
  if (input.guides.length === 0) throw new Error('lote sem guias')
  if (input.guides.length > MAX_GUIDES_PER_BATCH) throw new Error('lote acima de 100 guias')
  if (input.guides.some((g) => g.guide_type !== input.guideType)) throw new Error('lote com tipos de guia misturados')

  const buildGuide = input.guideType === 'consulta' ? buildConsultaGuide : buildSpSadtGuide
  const batchNumber = String(input.batchNumber)

  const head = cabecalho({
    tipoTransacao: 'ENVIO_LOTE_GUIAS',
    sequencialTransacao: batchNumber,
    now: input.now,
    insurer: input.insurer,
  })

  const body = el('prestadorParaOperadora', [
    el('loteGuias', [
      el('numeroLote', batchNumber),
      el(
        'guiasTISS',
        input.guides.map((g) => buildGuide(g.payload, g.provider_guide_number)),
      ),
    ]),
  ])

  return mensagemTISS(head, body)
}
```

`SCHEMAS`, `validate` e `v4_03_00` não mudam (continuam usando `VERSION`).

- [ ] **8.5 Rodar e ver passar — o golden é o critério:** `npx vitest run tests/tiss tests/billing/batches.test.ts` → `golden.test.ts`, `batch.test.ts`, `envelope.test.ts` e os testes de lote verdes. Se o golden falhar, a refatoração mudou bytes: desfazer e comparar; **nunca** regerar o golden nesta tarefa.
- [ ] **8.6 Commit:**

```bash
git add lib/tiss/v4_03_00/envelope.ts lib/tiss/v4_03_00/batch.ts tests/tiss/envelope.test.ts
git commit -m "refactor(tiss): cabecalho e envelope mensagemTISS parametrizados, lote byte a byte igual

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 9 — XML: Anexo de Solicitação de OPME (`ENVIO_ANEXO`) e utilitários comuns

**Modelo sugerido:** opus

**Files:** criar `lib/tiss/v4_03_00/authorization-common.ts`, `lib/tiss/v4_03_00/annex-opme.ts`, `lib/tiss/v4_03_00/authorization-messages.ts`, `tests/tiss/hash-from-file.ts`, `tests/tiss/authorization-fixtures.ts`, `tests/tiss/authorization-xml.test.ts`.

**Interfaces:**
- Consumes: `el`, `toLatin1Text`, `centsToDecimal`, `XmlNode` (`xml.ts`); `CONSELHO_CRM`, `UF_IBGE`, `crmNumber` (`common.ts`); `cabecalho`, `mensagemTISS` (`envelope.ts`); `validate` (`batch.ts`); tipos da Tarefa 6; `buildAuthorizationPayload` (Tarefa 7).
- Produces:

```ts
// authorization-common.ts
export function clip(value: string | null | undefined, max: number): string
export function optText(name: string, value: string | null | undefined, max: number): XmlNode | null
export function optId(name: string, value: string | null | undefined): XmlNode | null
export function beneficiarioSolicitacao(payload: AuthorizationPayloadBase): XmlNode
export function profissionalContratado(elementName: 'profissionalSolicitante' | 'dadosProfissionalContratado', p: AuthorizationProfessional): XmlNode
export function procedimentoDados(elementName: 'procedimento' | 'identificacaoOPME', item: Pick<AuthorizationItem, 'table_code' | 'code' | 'description'>): XmlNode
export function etapaEValidacao(r: ValidationData): XmlNode[]
export function procedimentosSolicitados(items: AuthorizationItem[]): XmlNode[]
// annex-opme.ts
export interface OpmeAnnexInput { annex: AuthorizationXmlSource<'opme_request'>; referencedGuideNumber: string }
export function buildOpmeAnnex(elementName: 'solicitacaoOPME' | 'anexoSolicitacaoOPME', input: OpmeAnnexInput): XmlNode
// authorization-messages.ts
export function buildOpmeAnnexMessage(input: { annex: AuthorizationXmlSource<'opme_request'>; referencedGuideNumber: string; now: Date }): BuiltBatch
```

Regras de texto (vale para as Tarefas 9 e 10):
- **Texto livre** (nomes, descrições, indicação, observação, justificativa, especificação): `clip` = `toLatin1Text` e corte no `maxLength` do XSD; opcional vazio → elemento omitido (`optText`); obrigatório vazio → `el(name, '')`, que o XSD reprova (como hoje nas guias).
- **Identificadores** (carteirinha, códigos, CNES, telefone, e-mail, ANVISA, referência, CIDs, números de guia): nunca cortados (`optId`/`el`); excesso fica para o XSD reprovar — um número truncado vira outro número.

- [ ] **9.1 Helpers de teste.** Criar `tests/tiss/hash-from-file.ts` (mesma lógica do helper local de `batch.test.ts`, que fica como está):

```ts
import { createHash } from 'crypto'

// Recalcula o hash do epílogo direto do arquivo: tira as tags entre
// <cabecalho> e <epilogo>, desfaz os escapes e aplica MD5 nos bytes ISO-8859-1.
export function hashFromFile(xml: Buffer): string {
  const text = xml.toString('latin1')
  const content = text
    .slice(text.indexOf('<ans:cabecalho>'), text.indexOf('<ans:epilogo>'))
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
  return createHash('md5').update(Buffer.from(content, 'latin1')).digest('hex')
}
```

Criar `tests/tiss/authorization-fixtures.ts`:

```ts
import { buildAuthorizationPayload, type AuthorizationSources } from '@/lib/billing/authorizations/payload'
import type { AuthorizationItem, AuthorizationXmlSource } from '@/lib/billing/authorizations/types'

// Dados 100% fictícios — ANS, CNES, CRM, carteirinha e ANVISA inventados.
export const AUTH_SOURCES: AuthorizationSources = {
  insurer: { ans_registry: '999999', provider_code: 'PREST0001', tiss_version: '4.03.00' },
  workspace: { cnes: '1234567', cnpj: '11222333000181', legal_name: 'Clínica Fictícia São João Ltda' },
  professional: {
    id: 'p1', full_name: 'Dra. Maria Exemplo', crm: '123456/SP', crm_uf: 'SP', cbo_code: '225125',
    phone: '(11) 99999-0000', email: 'maria@exemplo.test',
  },
  patientInsurance: { id: 'pi1', card_number: '00001111222233334' },
}

export function procedureItem(n: number): AuthorizationItem {
  return {
    id: `i${n}`, position: n, kind: 'procedure', table_code: '22', code: String(40300000 + n),
    description: `Procedimento fictício ${n}`, quantity_requested: 1, quantity_authorized: null,
    authorized_value_cents: null, manufacturer_option: null, requested_value_cents: null,
    anvisa_registration: null, manufacturer_reference: null, operating_authorization: null,
  }
}

export function opmeItem(n: number, over: Partial<AuthorizationItem> = {}): AuthorizationItem {
  return {
    ...procedureItem(n), id: `o${n}`, kind: 'opme', table_code: '19', code: String(70000000 + n),
    description: `Material OPME fictício ${n}`, quantity_requested: 2, manufacturer_option: '1',
    requested_value_cents: 150000, anvisa_registration: '80000000001', manufacturer_reference: 'REF-ABC-1',
    operating_authorization: 'AFE-123', ...over,
  }
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

export function fakeSpSadtRequest(itemCount = 2): AuthorizationXmlSource<'sp_sadt_request'> {
  const payload = buildAuthorizationPayload('sp_sadt_request', AUTH_SOURCES)
  payload.request.clinical_indication = 'Investigação de anemia'
  return { type: 'sp_sadt_request', providerGuideNumber: '41', requestedAt: '2026-10-05', payload, items: range(itemCount).map(procedureItem) }
}

export function fakeHospitalizationRequest(itemCount = 1): AuthorizationXmlSource<'hospitalization_request'> {
  const payload = buildAuthorizationPayload('hospitalization_request', AUTH_SOURCES)
  payload.request.hospital = { operator_code: 'HOSP0001', name: 'Hospital Fictício', suggested_date: '2026-10-20' }
  payload.request.hospitalization_type = '2'
  payload.request.daily_count = 3
  payload.request.clinical_indication = 'Apendicite aguda'
  payload.request.cid10 = ['K359']
  return { type: 'hospitalization_request', providerGuideNumber: '42', requestedAt: '2026-10-05', payload, items: range(itemCount).map(procedureItem) }
}

export function fakeOpmeAnnex(itemCount = 1): AuthorizationXmlSource<'opme_request'> {
  const payload = buildAuthorizationPayload('opme_request', AUTH_SOURCES)
  payload.request.technical_justification = 'Fratura de tíbia com indicação de fixação interna.'
  return { type: 'opme_request', providerGuideNumber: '43', requestedAt: '2026-10-05', payload, items: range(itemCount).map((n) => opmeItem(n)) }
}
```

- [ ] **9.2 Testes que falham.** Criar `tests/tiss/authorization-xml.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validate } from '@/lib/tiss/v4_03_00/batch'
import { buildOpmeAnnexMessage } from '@/lib/tiss/v4_03_00/authorization-messages'
import { clip, optText } from '@/lib/tiss/v4_03_00/authorization-common'
import { fakeOpmeAnnex, opmeItem } from './authorization-fixtures'
import { FIXED_NOW } from './fixtures'
import { hashFromFile } from './hash-from-file'

const text = (xml: Buffer) => xml.toString('latin1')
// Nenhum elemento vazio (<a></a> ou <a/>): minLength=1 em todo st_texto.
const EMPTY_ELEMENT = /<ans:\w+\/>|<ans:(\w+)><\/ans:\1>/
const opmeXml = (annex = fakeOpmeAnnex()) => buildOpmeAnnexMessage({ annex, referencedGuideNumber: '41', now: FIXED_NOW })

describe('helpers de texto das solicitações', () => {
  it('clip converte para Latin-1 antes de cortar e optText omite vazio', () => {
    expect(clip('  ação  ', 3)).toBe('açã')
    expect(clip(null, 5)).toBe('')
    expect(clip('😀😀abc', 2)).toBe('ab')
    expect(optText('observacao', '  \n ', 500)).toBeNull()
  })
})

describe('Anexo de Solicitação de OPME avulso (ENVIO_ANEXO)', () => {
  it('é válido contra o XSD 4.03.00 em loteAnexos/AnexosGuiasTISS/anexoSolicitacaoOPME', async () => {
    const { xml } = opmeXml()
    const result = await validate(xml)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    const t = text(xml)
    expect(t).toContain('<ans:tipoTransacao>ENVIO_ANEXO</ans:tipoTransacao><ans:sequencialTransacao>43</ans:sequencialTransacao>')
    expect(t).toContain('<ans:prestadorParaOperadora><ans:loteAnexos><ans:numeroLote>43</ans:numeroLote><ans:AnexosGuiasTISS><ans:anexoSolicitacaoOPME>')
    expect(t).toContain(
      '<ans:cabecalhoAnexo><ans:registroANS>999999</ans:registroANS><ans:numeroGuiaAnexo>43</ans:numeroGuiaAnexo>' +
      '<ans:numeroGuiaReferenciada>41</ans:numeroGuiaReferenciada><ans:dataSolicitacao>2026-10-05</ans:dataSolicitacao></ans:cabecalhoAnexo>',
    )
    expect(t).toContain('<ans:profissionalSolicitante><ans:nomeProfissional>Dra. Maria Exemplo</ans:nomeProfissional><ans:telefoneProfissional>11999990000</ans:telefoneProfissional><ans:emailProfissional>maria@exemplo.test</ans:emailProfissional></ans:profissionalSolicitante>')
    expect(t).toContain('<ans:dadosBeneficiario><ans:numeroCarteira>00001111222233334</ans:numeroCarteira><ans:atendimentoRN>N</ans:atendimentoRN></ans:dadosBeneficiario>')
    // Solicitação não leva campos de resposta (D5).
    expect(t).not.toMatch(/numeroGuiaOperadora|<ans:senha>|dataAutorizacao/)
    expect(t).not.toMatch(EMPTY_ELEMENT)
  })

  it('aceita vários materiais, valor em decimal e omite opcionais vazios', async () => {
    const annex = fakeOpmeAnnex(3)
    annex.items[1] = opmeItem(2, { requested_value_cents: null, anvisa_registration: null, manufacturer_reference: null, operating_authorization: null })
    annex.payload.request.observation = '   '
    annex.payload.request.material_specification = null
    annex.payload.professional.email = null
    const { xml } = opmeXml(annex)
    expect((await validate(xml)).errors).toEqual([])
    const t = text(xml)
    expect(t.match(/<ans:opmeSolicitada>/g)).toHaveLength(3)
    expect(t.match(/<ans:valorSolicitado>1500\.00<\/ans:valorSolicitado>/g)).toHaveLength(2)
    expect(t).not.toMatch(/<ans:Observacao>|<ans:especificacaoMaterial>|<ans:emailProfissional>/)
    expect(t).not.toMatch(EMPTY_ELEMENT)
  })

  it('usa Observacao com O maiúsculo e na última posição', async () => {
    const annex = fakeOpmeAnnex()
    annex.payload.request.material_specification = 'Placa bloqueada 4,5 mm'
    annex.payload.request.observation = 'Urgente'
    const t = text(opmeXml(annex).xml)
    expect(t).toContain('</ans:opmeSolicitadas><ans:Observacao>Urgente</ans:Observacao></ans:anexoSolicitacaoOPME>')
    expect(t).toContain('</ans:justificativaTecnica><ans:especificacaoMaterial>Placa bloqueada 4,5 mm</ans:especificacaoMaterial><ans:opmeSolicitadas>')
    expect((await validate(opmeXml(annex).xml)).valid).toBe(true)
  })

  it('corta texto livre no maxLength, mas nunca identificadores', async () => {
    const annex = fakeOpmeAnnex()
    annex.payload.request.technical_justification = 'J'.repeat(1200)
    annex.payload.request.observation = 'O'.repeat(600)
    const cut = opmeXml(annex)
    expect((await validate(cut.xml)).valid).toBe(true)
    expect(text(cut.xml)).toContain(`<ans:justificativaTecnica>${'J'.repeat(1000)}</ans:justificativaTecnica>`)
    expect(text(cut.xml)).toContain(`<ans:Observacao>${'O'.repeat(500)}</ans:Observacao>`)

    annex.payload.beneficiary.card_number = '1'.repeat(21)
    const bad = opmeXml(annex)
    expect(text(bad.xml)).toContain(`<ans:numeroCarteira>${'1'.repeat(21)}</ans:numeroCarteira>`)
    const result = await validate(bad.xml)
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toContain('numeroCarteira')
    expect(result.errors.join('\n')).not.toContain('1'.repeat(21))
  })

  it('reprova quando falta obrigatório (telefone do profissional)', async () => {
    const annex = fakeOpmeAnnex()
    annex.payload.professional.phone = null
    const result = await validate(opmeXml(annex).xml)
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toMatch(/telefoneProfissional/)
  })

  it('caracteres especiais: escapa & e <, mantém Latin-1, descarta o resto, hash bate com o arquivo', async () => {
    const annex = fakeOpmeAnnex()
    annex.payload.request.technical_justification = 'Dor & edema <grave> 😀 Erdős\nlinha ½ º'
    annex.items[0].description = 'Parafuso cortical ½ rosca — 3,5 mm'
    const { xml, hash } = opmeXml(annex)
    const t = text(xml)
    expect(t).toContain('Dor &amp; edema &lt;grave&gt;')
    expect(t).toContain('Erdoslinha ½ º')
    expect(t).not.toContain('😀')
    expect(t).toContain('Parafuso cortical ½ rosca  3,5 mm')
    expect(hash).toBe(hashFromFile(xml))
    expect((await validate(xml)).valid).toBe(true)
  })

  it('recusa anexo sem materiais', () => {
    expect(() => opmeXml(fakeOpmeAnnex(0))).toThrow('anexo OPME sem materiais')
  })
})
```

> Sobre `'Parafuso cortical ½ rosca  3,5 mm'`: o travessão (U+2014) não é Latin-1 e não tem letra base, então some e ficam dois espaços (comportamento atual de `toLatin1Text`, não alterar).

- [ ] **9.3 Rodar e ver falhar:** `npx vitest run tests/tiss/authorization-xml.test.ts`.

- [ ] **9.4 Implementar `lib/tiss/v4_03_00/authorization-common.ts`:**

```ts
import { el, toLatin1Text, type XmlNode } from '../xml'
import { CONSELHO_CRM, UF_IBGE, crmNumber } from './common'
import type {
  AuthorizationItem, AuthorizationPayloadBase, AuthorizationProfessional, ValidationData,
} from '@/lib/billing/authorizations/types'

// Peças comuns às solicitações (SP/SADT, Internação) e ao anexo OPME.
// Texto livre: Latin-1 e corte no maxLength do XSD. Identificadores: nunca
// cortados — o XSD reprova o excesso e a rota devolve 422.

export function clip(value: string | null | undefined, max: number): string {
  return toLatin1Text(value ?? '').slice(0, max).trim()
}

// Elemento opcional de texto livre: omitido quando vazio (minLength=1).
export function optText(name: string, value: string | null | undefined, max: number): XmlNode | null {
  const text = clip(value, max)
  return text ? el(name, text) : null
}

// Elemento opcional de identificador: omitido quando vazio, nunca cortado.
export function optId(name: string, value: string | null | undefined): XmlNode | null {
  const text = toLatin1Text(value ?? '')
  return text ? el(name, text) : null
}

const present = (n: XmlNode | null): n is XmlNode => n !== null

// ct_beneficiarioDados — sem nome/CNS desde a 4.00.00.
export function beneficiarioSolicitacao(payload: AuthorizationPayloadBase): XmlNode {
  return el('dadosBeneficiario', [
    el('numeroCarteira', payload.beneficiary.card_number ?? ''),
    el('atendimentoRN', payload.beneficiary.newborn ? 'S' : 'N'),
  ])
}

// ct_contratadoProfissionalDados (profissionalSolicitante da SP/SADT e
// dadosProfissionalContratado da Internação). Não serve para o OPME.
export function profissionalContratado(
  elementName: 'profissionalSolicitante' | 'dadosProfissionalContratado',
  p: AuthorizationProfessional,
): XmlNode {
  return el(elementName, [
    optText('nomeProfissional', p.name, 70),
    el('conselhoProfissional', CONSELHO_CRM),
    el('numeroConselhoProfissional', crmNumber(p.crm ?? '')),
    el('UF', UF_IBGE[p.crm_uf ?? ''] ?? ''),
    el('CBOS', p.cbo_code ?? ''),
  ])
}

// ct_procedimentoDados (procedimento das solicitações e identificacaoOPME).
export function procedimentoDados(
  elementName: 'procedimento' | 'identificacaoOPME',
  item: Pick<AuthorizationItem, 'table_code' | 'code' | 'description'>,
): XmlNode {
  return el(elementName, [
    el('codigoTabela', item.table_code),
    el('codigoProcedimento', item.code),
    el('descricaoProcedimento', clip(item.description, 150)),
  ])
}

// ausenciaCodValidacao?, codValidacao?, tipoEtapaAutorizacao — nesta ordem.
export function etapaEValidacao(r: ValidationData): XmlNode[] {
  return [
    r.absence_code ? el('ausenciaCodValidacao', r.absence_code) : null,
    optId('codValidacao', r.code),
    el('tipoEtapaAutorizacao', r.stage),
  ].filter(present)
}

// procedimentosSolicitados [1..n]: o próprio wrapper repete (sem sequencialItem).
export function procedimentosSolicitados(items: AuthorizationItem[]): XmlNode[] {
  return items.map((item) =>
    el('procedimentosSolicitados', [
      procedimentoDados('procedimento', item),
      el('quantidadeSolicitada', String(item.quantity_requested)),
    ]),
  )
}
```

- [ ] **9.5 Implementar `lib/tiss/v4_03_00/annex-opme.ts`:**

```ts
import { centsToDecimal, el, type XmlNode } from '../xml'
import { beneficiarioSolicitacao, clip, optId, optText, procedimentoDados } from './authorization-common'
import type { AuthorizationXmlSource } from '@/lib/billing/authorizations/types'

export interface OpmeAnnexInput {
  annex: AuthorizationXmlSource<'opme_request'>
  // cabecalhoAnexo/numeroGuiaReferenciada: provider_guide_number da SP/SADT
  // ou Internação de origem (D5). O XSD não diz se é o número do prestador
  // ou da operadora [AMBÍGUO]; usamos o do prestador.
  referencedGuideNumber: string
}

// ctm_anexoSolicitacaoOPME. elementName = 'solicitacaoOPME' quando vai
// embutido em anexoClinico; 'anexoSolicitacaoOPME' no loteAnexos avulso.
// numeroGuiaOperadora/senha/dataAutorizacao do cabecalhoAnexo ficam de fora:
// na solicitação ainda não existem (vêm na resposta).
export function buildOpmeAnnex(elementName: 'solicitacaoOPME' | 'anexoSolicitacaoOPME', input: OpmeAnnexInput): XmlNode {
  const { annex, referencedGuideNumber } = input
  const { payload, items } = annex
  return el(elementName, [
    el('cabecalhoAnexo', [
      el('registroANS', payload.insurer.ans_registry),
      el('numeroGuiaAnexo', annex.providerGuideNumber),
      el('numeroGuiaReferenciada', referencedGuideNumber),
      el('dataSolicitacao', annex.requestedAt),
    ]),
    beneficiarioSolicitacao(payload),
    // ctm_anexoSolicitante — tipo diferente do profissional das guias.
    el('profissionalSolicitante', [
      el('nomeProfissional', clip(payload.professional.name, 70)),
      el('telefoneProfissional', payload.professional.phone ?? ''),
      optId('emailProfissional', payload.professional.email),
    ]),
    el('justificativaTecnica', clip(payload.request.technical_justification, 1000)),
    optText('especificacaoMaterial', payload.request.material_specification, 500),
    el(
      'opmeSolicitadas',
      items.map((item) =>
        el('opmeSolicitada', [
          procedimentoDados('identificacaoOPME', item),
          el('opcaoFabricante', item.manufacturer_option ?? ''),
          el('quantidadeSolicitada', String(item.quantity_requested)),
          item.requested_value_cents !== null && el('valorSolicitado', centsToDecimal(item.requested_value_cents)),
          optId('registroANVISA', item.anvisa_registration),
          optId('codigoRefFabricante', item.manufacturer_reference),
          optId('autorizacaoFuncionamento', item.operating_authorization),
        ]),
      ),
    ),
    // "Observacao" com O maiúsculo — grafia do XSD, só neste tipo.
    optText('Observacao', payload.request.observation, 500),
  ])
}
```

- [ ] **9.6 Implementar `lib/tiss/v4_03_00/authorization-messages.ts`** (a Tarefa 10 acrescenta a mensagem de solicitação):

```ts
import { el } from '../xml'
import { buildOpmeAnnex } from './annex-opme'
import { cabecalho, mensagemTISS } from './envelope'
import type { BuiltBatch } from '@/lib/billing/types'
import type { AuthorizationXmlSource } from '@/lib/billing/authorizations/types'

// Anexo de OPME avulso: prestadorParaOperadora/loteAnexos (ct_anexoLote) com
// um único anexoSolicitacaoOPME. numeroLote = número do próprio anexo (D5).
export function buildOpmeAnnexMessage(input: {
  annex: AuthorizationXmlSource<'opme_request'>
  referencedGuideNumber: string
  now: Date
}): BuiltBatch {
  const { annex } = input
  if (annex.items.length === 0) throw new Error('anexo OPME sem materiais')
  return mensagemTISS(
    cabecalho({
      tipoTransacao: 'ENVIO_ANEXO',
      sequencialTransacao: annex.providerGuideNumber,
      now: input.now,
      insurer: annex.payload.insurer,
    }),
    el('prestadorParaOperadora', [
      el('loteAnexos', [
        el('numeroLote', annex.providerGuideNumber),
        el('AnexosGuiasTISS', [
          buildOpmeAnnex('anexoSolicitacaoOPME', { annex, referencedGuideNumber: input.referencedGuideNumber }),
        ]),
      ]),
    ]),
  )
}
```

- [ ] **9.7 Rodar e ver passar:** `npx vitest run tests/tiss` (golden e lote continuam verdes). Se o XSD reclamar de ordem, comparar com §2.3 da spec XSD — a ordem do `cabecalhoAnexo` é `registroANS, numeroGuiaAnexo, numeroGuiaReferenciada, [numeroGuiaOperadora], dataSolicitacao, [senha], [dataAutorizacao]`.
- [ ] **9.8 Commit:**

```bash
git add lib/tiss/v4_03_00/authorization-common.ts lib/tiss/v4_03_00/annex-opme.ts lib/tiss/v4_03_00/authorization-messages.ts tests/tiss
git commit -m "feat(tiss): XML do anexo de solicitação de OPME (ENVIO_ANEXO) validado no XSD

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 10 — XML: Solicitação de SP/SADT e de Internação (`SOLICITACAO_PROCEDIMENTOS`), OPME embutido

**Modelo sugerido:** opus

**Files:** criar `lib/tiss/v4_03_00/request-sp-sadt.ts`, `lib/tiss/v4_03_00/request-hospitalization.ts`; modificar `lib/tiss/v4_03_00/authorization-messages.ts`, `tests/tiss/authorization-xml.test.ts`.

**Interfaces:**
- Consumes: Tarefa 9 (`authorization-common.ts`, `buildOpmeAnnex`, `OpmeAnnexInput`), `cabecalho`/`mensagemTISS`.
- Produces:

```ts
export function buildSpSadtRequest(source: AuthorizationXmlSource<'sp_sadt_request'>, opme: OpmeAnnexInput | null): XmlNode
export function buildHospitalizationRequest(source: AuthorizationXmlSource<'hospitalization_request'>, opme: OpmeAnnexInput | null): XmlNode
export function buildAuthorizationRequestMessage(input: {
  request: AuthorizationXmlSource<'sp_sadt_request'> | AuthorizationXmlSource<'hospitalization_request'>
  embeddedOpme: AuthorizationXmlSource<'opme_request'> | null
  now: Date
}): BuiltBatch
```

- [ ] **10.1 Testes que falham.** Acrescentar a `tests/tiss/authorization-xml.test.ts` (imports no topo):

```ts
import { buildAuthorizationRequestMessage } from '@/lib/tiss/v4_03_00/authorization-messages'
import { fakeHospitalizationRequest, fakeSpSadtRequest } from './authorization-fixtures'
import type { AuthorizationXmlSource } from '@/lib/billing/authorizations/types'

type RequestSource = AuthorizationXmlSource<'sp_sadt_request'> | AuthorizationXmlSource<'hospitalization_request'>
const requestXml = (request: RequestSource, embeddedOpme: AuthorizationXmlSource<'opme_request'> | null = null) =>
  buildAuthorizationRequestMessage({ request, embeddedOpme, now: FIXED_NOW })

describe('Solicitação de SP/SADT (SOLICITACAO_PROCEDIMENTOS)', () => {
  it('é válida com 2 procedimentos e só os obrigatórios', async () => {
    const { xml } = requestXml(fakeSpSadtRequest(2))
    const result = await validate(xml)
    expect(result.errors).toEqual([])
    const t = text(xml)
    expect(t).toContain(
      '<ans:tipoTransacao>SOLICITACAO_PROCEDIMENTOS</ans:tipoTransacao><ans:sequencialTransacao>41</ans:sequencialTransacao>' +
      '<ans:dataRegistroTransacao>2026-09-29</ans:dataRegistroTransacao><ans:horaRegistroTransacao>18:30:00</ans:horaRegistroTransacao>',
    )
    expect(t).toContain(
      '<ans:prestadorParaOperadora><ans:solicitacaoProcedimento><ans:solicitacaoSP-SADT><ans:cabecalhoSolicitacao>' +
      '<ans:registroANS>999999</ans:registroANS><ans:numeroGuiaPrestador>41</ans:numeroGuiaPrestador></ans:cabecalhoSolicitacao>' +
      '<ans:tipoEtapaAutorizacao>1</ans:tipoEtapaAutorizacao><ans:dadosBeneficiario>',
    )
    expect(t).toContain(
      '<ans:dadosSolicitante><ans:contratadoSolicitante><ans:codigoPrestadorNaOperadora>PREST0001</ans:codigoPrestadorNaOperadora>' +
      '</ans:contratadoSolicitante><ans:nomeContratadoSolicitante>Clínica Fictícia São João Ltda</ans:nomeContratadoSolicitante>' +
      '<ans:profissionalSolicitante><ans:nomeProfissional>Dra. Maria Exemplo</ans:nomeProfissional>' +
      '<ans:conselhoProfissional>06</ans:conselhoProfissional><ans:numeroConselhoProfissional>123456</ans:numeroConselhoProfissional>' +
      '<ans:UF>35</ans:UF><ans:CBOS>225125</ans:CBOS></ans:profissionalSolicitante></ans:dadosSolicitante>' +
      '<ans:caraterAtendimento>1</ans:caraterAtendimento><ans:dataSolicitacao>2026-10-05</ans:dataSolicitacao>' +
      '<ans:indicacaoClinica>Investigação de anemia</ans:indicacaoClinica><ans:procedimentosSolicitados>',
    )
    expect(t.match(/<ans:procedimentosSolicitados>/g)).toHaveLength(2)
    expect(t).not.toMatch(/dadosExecutante|anexoClinico|coberturaEspecial|<ans:observacao>|numeroGuiaPrincipal|sequencialItem/)
    expect(t).not.toMatch(EMPTY_ELEMENT)
  })

  it('inclui os opcionais na ordem do XSD', async () => {
    const req = fakeSpSadtRequest(1)
    Object.assign(req.payload.request, {
      main_guide_number: 'G-1', absence_code: '02', code: 'ABC123', character: '2', special_coverage: '02',
      executor: { operator_code: 'EXEC01', cnes: '7654321' }, observation: 'Paciente em jejum',
    })
    const { xml } = requestXml(req)
    expect((await validate(xml)).errors).toEqual([])
    const t = text(xml)
    expect(t).toContain(
      '</ans:cabecalhoSolicitacao><ans:numeroGuiaPrincipal>G-1</ans:numeroGuiaPrincipal>' +
      '<ans:ausenciaCodValidacao>02</ans:ausenciaCodValidacao><ans:codValidacao>ABC123</ans:codValidacao>' +
      '<ans:tipoEtapaAutorizacao>1</ans:tipoEtapaAutorizacao>',
    )
    expect(t).toContain('</ans:indicacaoClinica><ans:coberturaEspecial>02</ans:coberturaEspecial><ans:procedimentosSolicitados>')
    expect(t).toContain(
      '</ans:procedimentosSolicitados><ans:dadosExecutante><ans:codigonaOperadora>EXEC01</ans:codigonaOperadora>' +
      '<ans:CNES>7654321</ans:CNES></ans:dadosExecutante><ans:observacao>Paciente em jejum</ans:observacao></ans:solicitacaoSP-SADT>',
    )
  })

  it('reprova sem razão social (nomeContratadoSolicitante é obrigatório)', async () => {
    const req = fakeSpSadtRequest(1)
    req.payload.provider.legal_name = null
    const result = await validate(requestXml(req).xml)
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toMatch(/nomeContratadoSolicitante/)
  })

  it('hash bate com & e < no nome do contratado; sem nome do paciente', () => {
    const req = fakeSpSadtRequest(1)
    req.payload.provider.legal_name = 'Silva & Souza <Clínica>'
    const { xml, hash } = requestXml(req)
    expect(text(xml)).toContain('Silva &amp; Souza &lt;Clínica&gt;')
    expect(hash).toBe(hashFromFile(xml))
    expect(text(xml)).not.toContain('Paciente')
  })

  it('recusa solicitação sem procedimentos', () => {
    expect(() => requestXml(fakeSpSadtRequest(0))).toThrow('solicitação sem procedimentos')
  })
})

describe('Solicitação de Internação (SOLICITACAO_PROCEDIMENTOS)', () => {
  it('é válida com 4 CIDs, 13 procedimentos e observação de 1000 caracteres', async () => {
    const req = fakeHospitalizationRequest(13)
    req.payload.request.cid10 = ['K359', 'R10', 'R509', 'E86']
    req.payload.request.observation = 'x'.repeat(1000)
    const { xml } = requestXml(req)
    expect((await validate(xml)).errors).toEqual([])
    const t = text(xml)
    expect(t).toContain(
      '<ans:solicitacaoProcedimento><ans:solicitacaoInternacao><ans:registroANS>999999</ans:registroANS>' +
      '<ans:numeroGuiaPrestador>42</ans:numeroGuiaPrestador><ans:tipoEtapaAutorizacao>1</ans:tipoEtapaAutorizacao>',
    )
    expect(t).not.toContain('cabecalhoSolicitacao')
    expect(t).toContain(
      '<ans:identificacaoSolicitante><ans:dadosDoContratado><ans:codigoPrestadorNaOperadora>PREST0001</ans:codigoPrestadorNaOperadora>' +
      '</ans:dadosDoContratado><ans:dadosProfissionalContratado>',
    )
    expect(t).not.toContain('nomeContratadoSolicitante')
    expect(t).toContain(
      '<ans:dadosHospitalSolicitado><ans:codigoIndicadonaOperadora>HOSP0001</ans:codigoIndicadonaOperadora>' +
      '<ans:nomeContratadoIndicado>Hospital Fictício</ans:nomeContratadoIndicado>' +
      '<ans:dataSugeridaInternacao>2026-10-20</ans:dataSugeridaInternacao></ans:dadosHospitalSolicitado>',
    )
    expect(t).toContain(
      '<ans:dadosInternacao><ans:caraterAtendimento>1</ans:caraterAtendimento><ans:tipoInternacao>2</ans:tipoInternacao>' +
      '<ans:regimeInternacao>1</ans:regimeInternacao><ans:qtDiariasSolicitadas>3</ans:qtDiariasSolicitadas>' +
      '<ans:indicadorOPME>N</ans:indicadorOPME><ans:indicadorQuimio>N</ans:indicadorQuimio>' +
      '<ans:indicacaoClinica>Apendicite aguda</ans:indicacaoClinica></ans:dadosInternacao>',
    )
    expect(t.match(/<ans:diagnosticoCID>/g)).toHaveLength(4)
    expect(t.match(/<ans:procedimentosSolicitados>/g)).toHaveLength(13)
    expect(t).toContain(`</ans:procedimentosSolicitados><ans:dataSolicitacao>2026-10-05</ans:dataSolicitacao><ans:observacao>${'x'.repeat(1000)}</ans:observacao></ans:solicitacaoInternacao>`)
  })

  it('sem CID emite só o indicador de acidente', async () => {
    const req = fakeHospitalizationRequest(1)
    req.payload.request.cid10 = []
    const { xml } = requestXml(req)
    expect(text(xml)).toContain('<ans:hipotesesDiagnosticas><ans:indicadorAcidente>9</ans:indicadorAcidente></ans:hipotesesDiagnosticas>')
    expect((await validate(xml)).valid).toBe(true)
  })

  it('reprova sem diárias ou sem hospital', async () => {
    const noDays = fakeHospitalizationRequest(1)
    noDays.payload.request.daily_count = null
    expect((await validate(requestXml(noDays).xml)).errors.join('\n')).toMatch(/qtDiariasSolicitadas/)
    const noHospital = fakeHospitalizationRequest(1)
    noHospital.payload.request.hospital.operator_code = null
    expect((await validate(requestXml(noHospital).xml)).errors.join('\n')).toMatch(/codigoIndicadonaOperadora/)
  })
})

describe('OPME embutido em anexoClinico/solicitacaoOPME', () => {
  it('SP/SADT: anexo entre dadosExecutante e observacao, referenciando a própria guia', async () => {
    const req = fakeSpSadtRequest(1)
    req.payload.request.observation = 'Com OPME'
    const { xml } = requestXml(req, fakeOpmeAnnex(2))
    expect((await validate(xml)).errors).toEqual([])
    const t = text(xml)
    expect(t).toContain(
      '<ans:anexoClinico><ans:solicitacaoOPME><ans:cabecalhoAnexo><ans:registroANS>999999</ans:registroANS>' +
      '<ans:numeroGuiaAnexo>43</ans:numeroGuiaAnexo><ans:numeroGuiaReferenciada>41</ans:numeroGuiaReferenciada>',
    )
    expect(t).toContain('</ans:solicitacaoOPME></ans:anexoClinico><ans:observacao>Com OPME</ans:observacao>')
    expect(t).not.toContain('anexoSolicitacaoOPME')
  })

  it('Internação: anexo por último e indicadorOPME = S mesmo se não marcado', async () => {
    const req = fakeHospitalizationRequest(1)
    req.payload.request.opme_expected = false
    req.payload.request.observation = 'Obs'
    const { xml } = requestXml(req, fakeOpmeAnnex(1))
    expect((await validate(xml)).errors).toEqual([])
    const t = text(xml)
    expect(t).toContain('<ans:indicadorOPME>S</ans:indicadorOPME>')
    expect(t).toContain('<ans:observacao>Obs</ans:observacao><ans:anexoClinico><ans:solicitacaoOPME>')
    expect(t).toContain('</ans:anexoClinico></ans:solicitacaoInternacao>')
  })

  it('recusa OPME embutido sem materiais', () => {
    expect(() => requestXml(fakeSpSadtRequest(1), fakeOpmeAnnex(0))).toThrow('anexo OPME sem materiais')
  })
})
```

- [ ] **10.2 Rodar e ver falhar:** `npx vitest run tests/tiss/authorization-xml.test.ts`.

- [ ] **10.3 Implementar `lib/tiss/v4_03_00/request-sp-sadt.ts`:**

```ts
import { el, type XmlNode } from '../xml'
import { buildOpmeAnnex, type OpmeAnnexInput } from './annex-opme'
import {
  beneficiarioSolicitacao, clip, etapaEValidacao, optId, optText, procedimentosSolicitados, profissionalContratado,
} from './authorization-common'
import type { AuthorizationXmlSource } from '@/lib/billing/authorizations/types'

// ctm_sp-sadtSolicitacaoGuia (elemento solicitacaoSP-SADT). Ordem do XSD:
// cabecalhoSolicitacao, numeroGuiaPrincipal?, ausenciaCodValidacao?,
// codValidacao?, tipoEtapaAutorizacao, dadosBeneficiario, dadosSolicitante,
// caraterAtendimento, dataSolicitacao, indicacaoClinica?, coberturaEspecial?,
// procedimentosSolicitados+, dadosExecutante?, anexoClinico?, observacao?.
// Sem valores, sem sequencialItem, sem campos de autorização (vêm na resposta).
export function buildSpSadtRequest(source: AuthorizationXmlSource<'sp_sadt_request'>, opme: OpmeAnnexInput | null): XmlNode {
  const { payload } = source
  const r = payload.request
  return el('solicitacaoSP-SADT', [
    el('cabecalhoSolicitacao', [
      el('registroANS', payload.insurer.ans_registry),
      el('numeroGuiaPrestador', source.providerGuideNumber),
    ]),
    optId('numeroGuiaPrincipal', r.main_guide_number),
    ...etapaEValidacao(r),
    beneficiarioSolicitacao(payload),
    // Idêntico ao dadosSolicitante da guia de cobrança.
    el('dadosSolicitante', [
      el('contratadoSolicitante', [el('codigoPrestadorNaOperadora', payload.insurer.provider_code)]),
      el('nomeContratadoSolicitante', clip(payload.provider.legal_name, 70)),
      profissionalContratado('profissionalSolicitante', payload.professional),
    ]),
    el('caraterAtendimento', r.character),
    el('dataSolicitacao', source.requestedAt),
    optText('indicacaoClinica', r.clinical_indication, 500),
    r.special_coverage && el('coberturaEspecial', r.special_coverage),
    ...procedimentosSolicitados(source.items),
    r.executor &&
      el('dadosExecutante', [
        el('codigonaOperadora', r.executor.operator_code),
        el('CNES', r.executor.cnes),
      ]),
    opme && el('anexoClinico', [buildOpmeAnnex('solicitacaoOPME', opme)]),
    optText('observacao', r.observation, 500),
  ])
}
```

- [ ] **10.4 Implementar `lib/tiss/v4_03_00/request-hospitalization.ts`:**

```ts
import { el, type XmlNode } from '../xml'
import { buildOpmeAnnex, type OpmeAnnexInput } from './annex-opme'
import {
  beneficiarioSolicitacao, clip, etapaEValidacao, optText, procedimentosSolicitados, profissionalContratado,
} from './authorization-common'
import type { AuthorizationXmlSource } from '@/lib/billing/authorizations/types'

// ctm_internacaoSolicitacaoGuia (elemento solicitacaoInternacao). Sem
// cabecalhoSolicitacao: registroANS e numeroGuiaPrestador soltos no topo.
// Ordem: registroANS, numeroGuiaPrestador, ausenciaCodValidacao?,
// codValidacao?, tipoEtapaAutorizacao, dadosBeneficiario,
// identificacaoSolicitante, dadosHospitalSolicitado, dadosInternacao,
// hipotesesDiagnosticas, procedimentosSolicitados+, dataSolicitacao,
// observacao? (st_texto1000), anexoClinico?.
export function buildHospitalizationRequest(
  source: AuthorizationXmlSource<'hospitalization_request'>,
  opme: OpmeAnnexInput | null,
): XmlNode {
  const { payload } = source
  const r = payload.request
  return el('solicitacaoInternacao', [
    el('registroANS', payload.insurer.ans_registry),
    el('numeroGuiaPrestador', source.providerGuideNumber),
    ...etapaEValidacao(r),
    beneficiarioSolicitacao(payload),
    // Sem nome do contratado (diferente da SP/SADT).
    el('identificacaoSolicitante', [
      el('dadosDoContratado', [el('codigoPrestadorNaOperadora', payload.insurer.provider_code)]),
      profissionalContratado('dadosProfissionalContratado', payload.professional),
    ]),
    el('dadosHospitalSolicitado', [
      el('codigoIndicadonaOperadora', r.hospital.operator_code ?? ''),
      el('nomeContratadoIndicado', clip(r.hospital.name, 70)),
      el('dataSugeridaInternacao', r.hospital.suggested_date ?? ''),
    ]),
    el('dadosInternacao', [
      el('caraterAtendimento', r.character),
      el('tipoInternacao', r.hospitalization_type),
      el('regimeInternacao', r.regime),
      el('qtDiariasSolicitadas', r.daily_count === null ? '' : String(r.daily_count)),
      // Com anexo OPME embutido, a previsão de OPME é necessariamente "S".
      el('indicadorOPME', r.opme_expected || opme ? 'S' : 'N'),
      el('indicadorQuimio', r.chemo_expected ? 'S' : 'N'),
      el('indicacaoClinica', clip(r.clinical_indication, 500)),
    ]),
    el('hipotesesDiagnosticas', [
      // st_texto4, 0..4 — normalizados (sem ponto) na validação da API.
      ...r.cid10.slice(0, 4).map((cid) => el('diagnosticoCID', cid)),
      el('indicadorAcidente', r.accident),
    ]),
    ...procedimentosSolicitados(source.items),
    el('dataSolicitacao', source.requestedAt),
    optText('observacao', r.observation, 1000),
    opme && el('anexoClinico', [buildOpmeAnnex('solicitacaoOPME', opme)]),
  ])
}
```

- [ ] **10.5 Acrescentar a `lib/tiss/v4_03_00/authorization-messages.ts`:**

```ts
import { buildSpSadtRequest } from './request-sp-sadt'
import { buildHospitalizationRequest } from './request-hospitalization'

// Solicitação de SP/SADT ou de Internação: prestadorParaOperadora/
// solicitacaoProcedimento — uma solicitação por mensagem (o choice de
// ctm_solicitacaoLote não repete). Com exatamente um OPME vinculado, ele vai
// embutido em anexoClinico/solicitacaoOPME referenciando esta guia (D5).
export function buildAuthorizationRequestMessage(input: {
  request: AuthorizationXmlSource<'sp_sadt_request'> | AuthorizationXmlSource<'hospitalization_request'>
  embeddedOpme: AuthorizationXmlSource<'opme_request'> | null
  now: Date
}): BuiltBatch {
  const { request } = input
  if (request.items.length === 0) throw new Error('solicitação sem procedimentos')
  if (input.embeddedOpme && input.embeddedOpme.items.length === 0) throw new Error('anexo OPME sem materiais')
  const opme = input.embeddedOpme
    ? { annex: input.embeddedOpme, referencedGuideNumber: request.providerGuideNumber }
    : null
  const body = request.type === 'sp_sadt_request'
    ? buildSpSadtRequest(request, opme)
    : buildHospitalizationRequest(request, opme)
  return mensagemTISS(
    cabecalho({
      tipoTransacao: 'SOLICITACAO_PROCEDIMENTOS',
      sequencialTransacao: request.providerGuideNumber,
      now: input.now,
      insurer: request.payload.insurer,
    }),
    el('prestadorParaOperadora', [el('solicitacaoProcedimento', [body])]),
  )
}
```

- [ ] **10.6 Rodar e ver passar:** `npx vitest run tests/tiss`. Erros de XSD esperados só nos testes que pedem reprovação. Se o validador acusar `CBOS` no fixture, conferir que `225125` está no `dm_CBOS` (está — é o mesmo usado nas guias).
- [ ] **10.7 Commit:**

```bash
git add lib/tiss/v4_03_00 tests/tiss/authorization-xml.test.ts
git commit -m "feat(tiss): XML de solicitação SP/SADT e internação com OPME embutido

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 11 — Servidor: fontes do snapshot, edição tipada, erros de RPC e montagem do XML

**Modelo sugerido:** sonnet

**Files:** criar `lib/billing/authorizations/sources.ts`, `lib/billing/authorizations/edit.ts`, `lib/billing/authorizations/rpc-errors.ts`, `lib/billing/authorizations/xml.ts`, `tests/billing/authorizations-server.test.ts`.

**Interfaces:**
- Consumes: `hasTissIdentity`, `INCOMPLETE_INSURER_ERROR` (`lib/billing/insurer.ts`); `ApiSession` (`lib/session/api.ts`); Tarefas 6, 7, 9, 10; `validate` (`batch.ts`).
- Produces:

```ts
// sources.ts
type BillingClient = SupabaseClient<Database>
export async function loadProfessionals(supabase: BillingClient, workspaceId: string): Promise<ProfessionalOption[]>
export type Failure = { ok: false; status: 400 | 404; error: string }
export async function loadAuthorizationSources(supabase: BillingClient, args: {
  accountId: string; workspaceId: string; insurerId: string; patientId: string
  patientInsuranceId: string | null; professionalId: string | null
}): Promise<{ ok: true; sources: AuthorizationSources; professionals: ProfessionalOption[] } | Failure>
export interface CreateContext { workspaceId: string; patientId: string; insurerId: string; appointmentId: string | null; parentId: string | null; payload: AnyAuthorizationPayload; items: AuthorizationItemInput[] }
export async function resolveCreateContext(supabase: BillingClient, session: ApiSession, input: CreateInput): Promise<{ ok: true; context: CreateContext } | Failure>
// edit.ts
export function buildInitialPayload(type: AuthorizationType, src: AuthorizationSources): AnyAuthorizationPayload
export function refreshPayload(current: AnyAuthorizationPayload, src: AuthorizationSources): AnyAuthorizationPayload
export interface PatchDeps { professional?: ProfessionalOption | null; patientInsurance?: { id: string; card_number: string } | null }
export function applyContentPatch(payload: AnyAuthorizationPayload, patch: ContentPatch, deps: PatchDeps): Result<AnyAuthorizationPayload>
// rpc-errors.ts
export function authorizationRpcError(error: { message?: string; code?: string } | null): NextResponse
// xml.ts
export function selectEmbeddedOpme<T extends { status: AuthorizationStatus }>(children: T[]): T | null
export type AuthorizationXmlResult =
  | { ok: true; xml: Buffer; hash: string; fileName: string }
  | { ok: false; status: 404 | 409 | 422; error: string; errors?: string[] }
  | { ok: false; rpcError: { message?: string; code?: string } }
export async function generateAuthorizationXml(supabase: BillingClient, accountId: string, id: string, now: Date): Promise<AuthorizationXmlResult>
```

- [ ] **11.1 Testes que falham.** Criar `tests/billing/authorizations-server.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createSupabaseMock, filterValue, type RecordedCall } from '../helpers/supabase-mock'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { generateAuthorizationXml, selectEmbeddedOpme } from '@/lib/billing/authorizations/xml'
import { authorizationRpcError } from '@/lib/billing/authorizations/rpc-errors'
import { applyContentPatch, refreshPayload } from '@/lib/billing/authorizations/edit'
import { resolveCreateContext } from '@/lib/billing/authorizations/sources'
import { AUTH_SOURCES, fakeOpmeAnnex, fakeSpSadtRequest, opmeItem, procedureItem } from '../tiss/authorization-fixtures'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }))

const asClient = (m: ReturnType<typeof createSupabaseMock>) => m.client as unknown as SupabaseClient<Database>
const NOW = new Date('2026-10-05T15:00:00Z')

function row(source: { type: string; providerGuideNumber: string; requestedAt: string; payload: unknown }, over: Record<string, unknown> = {}) {
  return { id: `a${source.providerGuideNumber}`, type: source.type, status: 'ready', provider_guide_number: source.providerGuideNumber,
    requested_at: source.requestedAt, payload: source.payload, missing_fields: [], parent_id: null, ...over }
}

function xmlMock(rows: { main: ReturnType<typeof row>; children?: ReturnType<typeof row>[]; parent?: { provider_guide_number: string } }) {
  return createSupabaseMock({
    tiss_authorizations: {
      select: (call: RecordedCall) => {
        if (filterValue(call, 'eq', 'parent_id')) return { data: rows.children ?? [] }
        if (filterValue(call, 'eq', 'id') === rows.main.id) return { data: rows.main }
        return { data: rows.parent ?? null }
      },
    },
    tiss_authorization_items: {
      select: (call: RecordedCall) => {
        const id = filterValue(call, 'eq', 'authorization_id')
        return { data: String(id).startsWith('a43') ? [opmeItem(1)] : [procedureItem(1)] }
      },
    },
  })
}

describe('OPME embutido', () => {
  it('só com exatamente um OPME não cancelado', () => {
    expect(selectEmbeddedOpme([])).toBeNull()
    expect(selectEmbeddedOpme([{ status: 'cancelled' as const }, { status: 'ready' as const }])).toEqual({ status: 'ready' })
    expect(selectEmbeddedOpme([{ status: 'ready' as const }, { status: 'draft' as const }])).toBeNull()
  })
})

describe('generateAuthorizationXml', () => {
  it('rascunho → 409 sem gerar nem registrar evento', async () => {
    const m = xmlMock({ main: row(fakeSpSadtRequest(), { status: 'draft', missing_fields: ['items'] }) })
    expect(await generateAuthorizationXml(asClient(m), 'acc1', 'a41', NOW)).toMatchObject({ ok: false, status: 409 })
    expect(m.rpc).not.toHaveBeenCalled()
  })

  it('SP/SADT com um OPME pronto embute o anexo e registra o hash', async () => {
    const m = xmlMock({ main: row(fakeSpSadtRequest()), children: [row(fakeOpmeAnnex(), { parent_id: 'a41' })] })
    const r = await generateAuthorizationXml(asClient(m), 'acc1', 'a41', NOW)
    if (!r.ok) throw new Error(JSON.stringify(r))
    expect(r.xml.toString('latin1')).toContain('<ans:anexoClinico><ans:solicitacaoOPME>')
    expect(r.fileName).toBe('solicitacao-sp-sadt-41.xml')
    expect(m.rpc).toHaveBeenCalledWith('log_tiss_authorization_xml', { p_id: 'a41', p_hash: r.hash })
    expect(filterValue(m.callsTo('tiss_authorizations')[0], 'eq', 'account_id')).toBe('acc1')
  })

  it('dois OPME ativos → não embute; um OPME incompleto → 409', async () => {
    const two = xmlMock({ main: row(fakeSpSadtRequest()), children: [row(fakeOpmeAnnex()), row(fakeOpmeAnnex(), { id: 'a44' })] })
    const r = await generateAuthorizationXml(asClient(two), 'acc1', 'a41', NOW)
    expect(r.ok && r.xml.toString('latin1')).not.toContain('anexoClinico')
    const draft = xmlMock({ main: row(fakeSpSadtRequest()), children: [row(fakeOpmeAnnex(), { status: 'draft', missing_fields: ['professional.phone'] })] })
    expect(await generateAuthorizationXml(asClient(draft), 'acc1', 'a41', NOW)).toMatchObject({ ok: false, status: 409 })
  })

  it('OPME avulso referencia o número do pai', async () => {
    const m = xmlMock({ main: row(fakeOpmeAnnex(), { parent_id: 'a41' }), parent: { provider_guide_number: '41' } })
    const r = await generateAuthorizationXml(asClient(m), 'acc1', 'a43', NOW)
    expect(r.ok && r.xml.toString('latin1')).toContain('<ans:numeroGuiaReferenciada>41</ans:numeroGuiaReferenciada>')
    expect(r.ok && r.fileName).toBe('anexo-opme-43.xml')
  })

  it('XML reprovado no XSD → 422 com erros sem valores', async () => {
    const source = fakeSpSadtRequest()
    source.payload.beneficiary.card_number = '9'.repeat(25)
    const m = xmlMock({ main: row(source) })
    const r = await generateAuthorizationXml(asClient(m), 'acc1', 'a41', NOW)
    expect(r).toMatchObject({ ok: false, status: 422 })
    expect(JSON.stringify(r)).not.toContain('9'.repeat(25))
    expect(m.rpc).not.toHaveBeenCalled()
  })
})

describe('erros de RPC', () => {
  it('mapeia pelas chaves exatas e não vaza mensagens desconhecidas', async () => {
    expect(authorizationRpcError({ message: 'tiss_authorization_changed' }).status).toBe(409)
    expect(authorizationRpcError({ message: 'tiss_authorization_forbidden', code: '42501' }).status).toBe(403)
    expect(authorizationRpcError({ message: 'tiss_authorization_invalid_transition' }).status).toBe(409)
    const unknown = authorizationRpcError({ message: 'duplicate key value violates ... FICT-CARD' })
    expect(unknown.status).toBe(500)
    expect(JSON.stringify(await unknown.json())).not.toContain('FICT-CARD')
  })
})

describe('edição tipada', () => {
  it('aplica patch do pedido conforme o tipo e recusa campo de outro tipo', () => {
    const p = fakeSpSadtRequest().payload
    const r = applyContentPatch(p, { expected_updated_at: 'x', refresh: false, request: { observation: 'ok' }, card_number: 'NOVA' }, {})
    expect(r.ok && r.value.type === 'sp_sadt_request' && r.value.request.observation).toBe('ok')
    expect(r.ok && r.value.beneficiary.card_number).toBe('NOVA')
    expect(applyContentPatch(p, { expected_updated_at: 'x', refresh: false, request: { daily_count: 2 } }, {}).ok).toBe(false)
  })

  it('refresh preserva o pedido clínico', () => {
    const current = fakeOpmeAnnex().payload
    const fresh = refreshPayload(current, { ...AUTH_SOURCES, workspace: { ...AUTH_SOURCES.workspace, legal_name: 'Nova' } })
    expect(fresh.provider.legal_name).toBe('Nova')
    expect(fresh.type === 'opme_request' && fresh.request.technical_justification).toBe(current.request.technical_justification)
  })
})

describe('contexto de criação', () => {
  const SESSION = { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'member' as const, modules: [] }

  it('a partir do agendamento: unidade/paciente/operadora do agendamento e TUSS como primeiro item', async () => {
    const m = createSupabaseMock({
      appointments: { select: { data: { id: 'ap1', workspace_id: 'w2', patient_id: 'pa1', doctor_id: 'recepcao', insurer_id: 'in1', patient_insurance_id: 'pi1', insurer_procedure_id: 'pr1' } } },
      insurer_procedures: { select: { data: { tuss_code: '40301630', description: 'Hemograma' } } },
      health_insurers: { select: { data: AUTH_SOURCES.insurer } },
      workspaces: { select: { data: AUTH_SOURCES.workspace } },
      patient_insurances: { select: { data: [{ id: 'pi1', card_number: 'CARD-1', is_primary: true }] } },
    })
    m.rpc.mockResolvedValue({ data: [AUTH_SOURCES.professional], error: null })
    const r = await resolveCreateContext(asClient(m), SESSION, {
      type: 'sp_sadt_request', appointment_id: 'ap1', parent_id: null, patient_id: null, insurer_id: null,
      patient_insurance_id: null, professional_id: null,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.context).toMatchObject({ workspaceId: 'w2', patientId: 'pa1', insurerId: 'in1', appointmentId: 'ap1' })
    expect(r.context.items).toEqual([expect.objectContaining({ table_code: '22', code: '40301630', quantity_requested: 1 })])
    // doctor_id do agendamento é quem agendou; só vira solicitante se estiver na lista de profissionais.
    expect(r.context.payload.professional.id).toBeNull()
    expect(r.context.payload.beneficiary.card_number).toBe('CARD-1')
    expect(m.rpc).toHaveBeenCalledWith('tiss_authorization_professionals', { p_workspace_id: 'w2' })
  })

  it('operadora sem ANS → 400 com a mensagem padrão', async () => {
    const m = createSupabaseMock({
      health_insurers: { select: { data: { ans_registry: null, provider_code: null, tiss_version: '4.03.00' } } },
      workspaces: { select: { data: AUTH_SOURCES.workspace } },
      patient_insurances: { select: { data: [] } },
    })
    m.rpc.mockResolvedValue({ data: [], error: null })
    const r = await resolveCreateContext(asClient(m), SESSION, {
      type: 'hospitalization_request', appointment_id: null, parent_id: null, patient_id: 'pa1', insurer_id: 'in1',
      patient_insurance_id: null, professional_id: null,
    })
    expect(r).toEqual({ ok: false, status: 400, error: 'Complete o registro ANS e o código do prestador desta operadora em Convênios.' })
  })
})
```

- [ ] **11.2 Rodar e ver falhar:** `npx vitest run tests/billing/authorizations-server.test.ts`.

- [ ] **11.3 Implementar `lib/billing/authorizations/edit.ts`:**

```ts
import {
  applyAuthorizationEdits, buildAuthorizationPayload, mergeRefreshedAuthorizationPayload,
  type AuthorizationSources, type ProfessionalOption,
} from './payload'
import { parseRequestPatch, type ContentPatch, type Result } from './validation'
import type { AnyAuthorizationPayload, AuthorizationPayload, AuthorizationType, RequestDataByType } from './types'

// Pontes entre o payload "qualquer tipo" das rotas e as funções genéricas:
// o switch estreita o tipo e evita casts.

export function buildInitialPayload(type: AuthorizationType, src: AuthorizationSources): AnyAuthorizationPayload {
  switch (type) {
    case 'sp_sadt_request': return buildAuthorizationPayload('sp_sadt_request', src)
    case 'hospitalization_request': return buildAuthorizationPayload('hospitalization_request', src)
    case 'opme_request': return buildAuthorizationPayload('opme_request', src)
  }
}

function refreshTyped<T extends AuthorizationType>(current: AuthorizationPayload<T>, src: AuthorizationSources): AuthorizationPayload<T> {
  return mergeRefreshedAuthorizationPayload(current, buildAuthorizationPayload(current.type, src, current.request))
}

export function refreshPayload(current: AnyAuthorizationPayload, src: AuthorizationSources): AnyAuthorizationPayload {
  switch (current.type) {
    case 'sp_sadt_request': return refreshTyped(current, src)
    case 'hospitalization_request': return refreshTyped(current, src)
    case 'opme_request': return refreshTyped(current, src)
  }
}

export interface PatchDeps {
  professional?: ProfessionalOption | null
  patientInsurance?: { id: string; card_number: string } | null
}

function patchTyped<T extends AuthorizationType>(
  payload: AuthorizationPayload<T>,
  patch: ContentPatch,
  deps: PatchDeps,
): Result<AuthorizationPayload<T>> {
  let request: RequestDataByType[T] | undefined
  if (patch.request !== undefined) {
    const parsed = parseRequestPatch(payload.type, payload.request, patch.request)
    if (!parsed.ok) return parsed
    request = parsed.value
  }
  return {
    ok: true,
    value: applyAuthorizationEdits(payload, {
      professional: deps.professional,
      patientInsurance: deps.patientInsurance,
      card_number: patch.card_number,
      newborn: patch.newborn,
      professional_phone: patch.professional_phone,
      professional_email: patch.professional_email,
      request,
    }),
  }
}

export function applyContentPatch(payload: AnyAuthorizationPayload, patch: ContentPatch, deps: PatchDeps): Result<AnyAuthorizationPayload> {
  switch (payload.type) {
    case 'sp_sadt_request': return patchTyped(payload, patch, deps)
    case 'hospitalization_request': return patchTyped(payload, patch, deps)
    case 'opme_request': return patchTyped(payload, patch, deps)
  }
}
```

> `applyAuthorizationEdits` trata `undefined` como "não mexer", então passar as chaves com `undefined` é seguro.

- [ ] **11.4 Implementar `lib/billing/authorizations/sources.ts`:**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { ApiSession } from '@/lib/session/api'
import { INCOMPLETE_INSURER_ERROR, hasTissIdentity } from '../insurer'
import { buildInitialPayload } from './edit'
import type { AuthorizationSources, ProfessionalOption } from './payload'
import type { AnyAuthorizationPayload, AuthorizationItemInput } from './types'
import type { CreateInput } from './validation'

type BillingClient = SupabaseClient<Database>
export type Failure = { ok: false; status: 400 | 404; error: string }

// Profissionais com CRM da account (RPC security definer: profiles é
// privado por RLS). Lança em erro — a rota responde 500 genérico.
export async function loadProfessionals(supabase: BillingClient, workspaceId: string): Promise<ProfessionalOption[]> {
  const { data, error } = await supabase.rpc('tiss_authorization_professionals', { p_workspace_id: workspaceId })
  if (error) throw new Error('billing: não foi possível carregar os profissionais')
  return data ?? []
}

// Fontes do snapshot, todas lidas com o client do usuário (RLS) e presas à account.
export async function loadAuthorizationSources(
  supabase: BillingClient,
  args: {
    accountId: string
    workspaceId: string
    insurerId: string
    patientId: string
    patientInsuranceId: string | null
    professionalId: string | null
  },
): Promise<{ ok: true; sources: AuthorizationSources; professionals: ProfessionalOption[] } | Failure> {
  const [{ data: insurer }, { data: workspace }, { data: cards }, professionals] = await Promise.all([
    supabase
      .from('health_insurers')
      .select('ans_registry, provider_code, tiss_version')
      .eq('id', args.insurerId)
      .eq('account_id', args.accountId)
      .maybeSingle(),
    supabase
      .from('workspaces')
      .select('cnes, cnpj, legal_name')
      .eq('id', args.workspaceId)
      .eq('account_id', args.accountId)
      .maybeSingle(),
    supabase
      .from('patient_insurances')
      .select('id, card_number, is_primary')
      .eq('patient_id', args.patientId)
      .eq('insurer_id', args.insurerId)
      .eq('account_id', args.accountId)
      .order('is_primary', { ascending: false }),
    loadProfessionals(supabase, args.workspaceId),
  ])

  if (!insurer || !hasTissIdentity(insurer)) return { ok: false, status: 400, error: INCOMPLETE_INSURER_ERROR }
  if (!workspace) return { ok: false, status: 404, error: 'Unidade não encontrada' }

  const list = cards ?? []
  const card = (args.patientInsuranceId ? list.find((c) => c.id === args.patientInsuranceId) : list[0]) ?? null
  const professional = args.professionalId ? professionals.find((p) => p.id === args.professionalId) ?? null : null

  return {
    ok: true,
    professionals,
    sources: {
      insurer: { ans_registry: insurer.ans_registry, provider_code: insurer.provider_code, tiss_version: insurer.tiss_version },
      workspace,
      professional,
      patientInsurance: card ? { id: card.id, card_number: card.card_number } : null,
    },
  }
}

export interface CreateContext {
  workspaceId: string
  patientId: string
  insurerId: string
  appointmentId: string | null
  parentId: string | null
  payload: AnyAuthorizationPayload
  items: AuthorizationItemInput[]
}

// Resolve unidade/paciente/operadora/profissional a partir do pai (OPME), do
// agendamento ou do corpo, nesta ordem, e monta o snapshot inicial.
export async function resolveCreateContext(
  supabase: BillingClient,
  session: ApiSession,
  input: CreateInput,
): Promise<{ ok: true; context: CreateContext } | Failure> {
  let workspaceId = session.workspaceId
  let patientId = input.patient_id
  let insurerId = input.insurer_id
  let appointmentId = input.appointment_id
  let patientInsuranceId = input.patient_insurance_id
  let professionalId = input.professional_id
  let items: AuthorizationItemInput[] = []

  if (input.parent_id) {
    const { data } = await supabase
      .from('tiss_authorizations')
      .select('id, workspace_id, patient_id, insurer_id, appointment_id, type, status, payload')
      .eq('id', input.parent_id)
      .eq('account_id', session.accountId)
      .maybeSingle()
    const parent = data as unknown as {
      workspace_id: string; patient_id: string; insurer_id: string; appointment_id: string | null
      type: string; status: string; payload: AnyAuthorizationPayload
    } | null
    if (!parent || parent.type === 'opme_request') return { ok: false, status: 404, error: 'Guia de origem não encontrada' }
    if (parent.status === 'cancelled') return { ok: false, status: 400, error: 'A guia de origem está cancelada.' }
    workspaceId = parent.workspace_id
    patientId = parent.patient_id
    insurerId = parent.insurer_id
    appointmentId = parent.appointment_id
    patientInsuranceId = patientInsuranceId ?? parent.payload.beneficiary.patient_insurance_id
    professionalId = professionalId ?? parent.payload.professional.id
  } else if (input.appointment_id) {
    const { data: appointment } = await supabase
      .from('appointments')
      .select('id, workspace_id, patient_id, doctor_id, insurer_id, patient_insurance_id, insurer_procedure_id')
      .eq('id', input.appointment_id)
      .eq('account_id', session.accountId)
      .maybeSingle()
    if (!appointment) return { ok: false, status: 404, error: 'Agendamento não encontrado' }
    if (!appointment.patient_id || !appointment.insurer_id) {
      return { ok: false, status: 400, error: 'O agendamento precisa ter paciente cadastrado e convênio.' }
    }
    workspaceId = appointment.workspace_id
    patientId = appointment.patient_id
    insurerId = appointment.insurer_id
    patientInsuranceId = patientInsuranceId ?? appointment.patient_insurance_id
    // doctor_id é quem criou o agendamento (pode ser a recepção): só vira
    // solicitante se aparecer na lista de profissionais com CRM.
    professionalId = professionalId ?? appointment.doctor_id
    if (input.type === 'sp_sadt_request' && appointment.insurer_procedure_id) {
      const { data: procedure } = await supabase
        .from('insurer_procedures')
        .select('tuss_code, description')
        .eq('id', appointment.insurer_procedure_id)
        .eq('insurer_id', appointment.insurer_id)
        .eq('account_id', session.accountId)
        .maybeSingle()
      if (procedure) {
        items = [{
          table_code: '22', code: procedure.tuss_code, description: procedure.description.slice(0, 150),
          quantity_requested: 1, manufacturer_option: null, requested_value_cents: null,
          anvisa_registration: null, manufacturer_reference: null, operating_authorization: null,
        }]
      }
    }
  }

  if (!patientId || !insurerId) return { ok: false, status: 400, error: 'Informe o paciente e a operadora.' }

  const loaded = await loadAuthorizationSources(supabase, {
    accountId: session.accountId, workspaceId, insurerId, patientId, patientInsuranceId, professionalId,
  })
  if (!loaded.ok) return loaded

  return {
    ok: true,
    context: {
      workspaceId, patientId, insurerId, appointmentId, parentId: input.parent_id,
      payload: buildInitialPayload(input.type, loaded.sources),
      items,
    },
  }
}
```

- [ ] **11.5 Implementar `lib/billing/authorizations/rpc-errors.ts`:**

```ts
import { NextResponse } from 'next/server'
import { INCOMPLETE_INSURER_ERROR } from '../insurer'

// Mensagens fixas por chave de erro dos RPCs (raise exception '<chave>').
// Nunca devolver error.message cru: pode citar valores (carteirinha etc.).
const RPC_ERRORS: Record<string, { status: number; error: string }> = {
  tiss_authorization_forbidden: { status: 403, error: 'Sem permissão para esta ação.' },
  billing_module_disabled: { status: 403, error: "Módulo 'billing' não está ativo no seu plano" },
  tiss_authorization_not_found: { status: 404, error: 'Autorização não encontrada' },
  tiss_authorization_not_editable: { status: 409, error: 'Autorização já enviada ou cancelada — somente leitura.' },
  tiss_authorization_changed: { status: 409, error: 'A autorização foi alterada por outra pessoa. Recarregue e tente de novo.' },
  tiss_authorization_invalid_transition: { status: 409, error: 'Mudança de status não permitida.' },
  tiss_authorization_incomplete: { status: 409, error: 'Complete os campos pendentes antes de gerar o XML.' },
  tiss_authorization_payload_mismatch: { status: 409, error: 'Os dados da operadora mudaram. Use "Recarregar dados".' },
  tiss_authorization_parent_invalid: { status: 400, error: 'Guia de origem inválida para o anexo OPME.' },
  tiss_authorization_account_mismatch: { status: 400, error: 'Paciente, operadora ou unidade não pertencem a esta conta.' },
  tiss_authorization_appointment_mismatch: { status: 400, error: 'O agendamento não é deste paciente ou desta unidade.' },
  tiss_authorization_item_kind: { status: 400, error: 'Tipo de item incompatível com a autorização.' },
  tiss_authorization_item_not_found: { status: 400, error: 'Item da resposta não pertence a esta autorização.' },
  tiss_authorization_invalid: { status: 400, error: 'Dados inválidos.' },
  tiss_insurer_incomplete: { status: 400, error: INCOMPLETE_INSURER_ERROR },
}

export function authorizationRpcError(error: { message?: string; code?: string } | null): NextResponse {
  const known = error?.message ? RPC_ERRORS[error.message] : undefined
  if (known) return NextResponse.json({ error: known.error }, { status: known.status })
  // CHECK/cast do banco (limites do XSD) que passaram pela validação da rota.
  if (error?.code === '23514' || error?.code === '22P02' || error?.code === '22023') {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  }
  console.error('[billing] erro inesperado em RPC de autorização', { code: error?.code ?? 'unknown' })
  return NextResponse.json({ error: 'Não foi possível concluir a operação.' }, { status: 500 })
}
```

- [ ] **11.6 Implementar `lib/billing/authorizations/xml.ts`:**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { BuiltBatch } from '@/lib/billing/types'
import { validate } from '@/lib/tiss/v4_03_00/batch'
import { buildAuthorizationRequestMessage, buildOpmeAnnexMessage } from '@/lib/tiss/v4_03_00/authorization-messages'
import { AUTHORIZATION_ITEM_COLUMNS } from './constants'
import type {
  AnyAuthorizationPayload, AnyAuthorizationXmlSource, AuthorizationItem, AuthorizationStatus, AuthorizationType,
  AuthorizationXmlSource,
} from './types'

type BillingClient = SupabaseClient<Database>

interface XmlRow {
  id: string
  type: AuthorizationType
  status: AuthorizationStatus
  provider_guide_number: string
  requested_at: string
  payload: AnyAuthorizationPayload
  missing_fields: string[]
  parent_id: string | null
}

const XML_ROW_COLUMNS = 'id, type, status, provider_guide_number, requested_at, payload, missing_fields, parent_id'

const FILE_PREFIX: Record<AuthorizationType, string> = {
  sp_sadt_request: 'solicitacao-sp-sadt',
  hospitalization_request: 'solicitacao-internacao',
  opme_request: 'anexo-opme',
}

export type AuthorizationXmlResult =
  | { ok: true; xml: Buffer; hash: string; fileName: string }
  | { ok: false; status: 404 | 409 | 422; error: string; errors?: string[] }
  | { ok: false; rpcError: { message?: string; code?: string } }

// D5: embute o OPME só quando há exatamente um vinculado não cancelado.
export function selectEmbeddedOpme<T extends { status: AuthorizationStatus }>(children: T[]): T | null {
  const active = children.filter((c) => c.status !== 'cancelled')
  return active.length === 1 ? active[0] : null
}

function toSource(row: XmlRow, items: AuthorizationItem[]): AnyAuthorizationXmlSource {
  const base = { providerGuideNumber: row.provider_guide_number, requestedAt: row.requested_at, items }
  const payload = row.payload
  switch (payload.type) {
    case 'sp_sadt_request': return { ...base, type: payload.type, payload }
    case 'hospitalization_request': return { ...base, type: payload.type, payload }
    case 'opme_request': return { ...base, type: payload.type, payload }
  }
}

async function loadItems(supabase: BillingClient, authorizationId: string): Promise<AuthorizationItem[]> {
  const { data } = await supabase
    .from('tiss_authorization_items')
    .select(AUTHORIZATION_ITEM_COLUMNS)
    .eq('authorization_id', authorizationId)
    .order('position', { ascending: true })
  return (data ?? []) as unknown as AuthorizationItem[]
}

const INCOMPLETE = 'Complete os campos pendentes antes de gerar o XML.'

// Gera sob demanda (nada vai para o storage), valida no XSD e registra o
// evento xml_generated com o hash. Leituras com o client do usuário (RLS).
export async function generateAuthorizationXml(
  supabase: BillingClient,
  accountId: string,
  id: string,
  now: Date,
): Promise<AuthorizationXmlResult> {
  const { data } = await supabase
    .from('tiss_authorizations')
    .select(XML_ROW_COLUMNS)
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  const row = data as unknown as XmlRow | null
  if (!row) return { ok: false, status: 404, error: 'Autorização não encontrada' }
  if (row.status === 'draft' || row.missing_fields.length > 0) return { ok: false, status: 409, error: INCOMPLETE }

  const source = toSource(row, await loadItems(supabase, row.id))
  let built: BuiltBatch
  try {
    if (source.type === 'opme_request') {
      const { data: parent } = await supabase
        .from('tiss_authorizations')
        .select('provider_guide_number')
        .eq('id', row.parent_id ?? '')
        .eq('account_id', accountId)
        .maybeSingle()
      if (!parent) return { ok: false, status: 404, error: 'Guia de origem não encontrada' }
      built = buildOpmeAnnexMessage({ annex: source, referencedGuideNumber: parent.provider_guide_number, now })
    } else {
      const { data: children } = await supabase
        .from('tiss_authorizations')
        .select(XML_ROW_COLUMNS)
        .eq('parent_id', row.id)
        .eq('account_id', accountId)
      const embedded = selectEmbeddedOpme((children ?? []) as unknown as XmlRow[])
      let opme: AuthorizationXmlSource<'opme_request'> | null = null
      if (embedded) {
        if (embedded.missing_fields.length > 0) {
          return { ok: false, status: 409, error: 'O anexo OPME vinculado está incompleto. Complete-o ou cancele-o antes de gerar o XML.' }
        }
        const child = toSource(embedded, await loadItems(supabase, embedded.id))
        if (child.type !== 'opme_request') return { ok: false, status: 409, error: INCOMPLETE }
        opme = child
      }
      built = buildAuthorizationRequestMessage({ request: source, embeddedOpme: opme, now })
    }
  } catch {
    // buildX lança só sem itens — já coberto por missing_fields; defesa.
    return { ok: false, status: 409, error: INCOMPLETE }
  }

  const validation = await validate(built.xml)
  if (!validation.valid) {
    return { ok: false, status: 422, error: 'O XML gerado não passou na validação do XSD da ANS.', errors: validation.errors }
  }

  const { error } = await supabase.rpc('log_tiss_authorization_xml', { p_id: row.id, p_hash: built.hash })
  if (error) return { ok: false, rpcError: error }

  return { ok: true, xml: built.xml, hash: built.hash, fileName: `${FILE_PREFIX[row.type]}-${row.provider_guide_number}.xml` }
}
```

- [ ] **11.7 Rodar e ver passar:** `npx vitest run tests/billing/authorizations-server.test.ts` e `npx tsc --noEmit`.
- [ ] **11.8 Commit:**

```bash
git add lib/billing/authorizations tests/billing/authorizations-server.test.ts
git commit -m "feat(tiss): carga do snapshot, edição tipada e geração do XML de autorizações

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 12 — API: listar, criar e profissionais

**Modelo sugerido:** sonnet

**Files:** criar `app/api/billing/authorizations/route.ts`, `app/api/billing/authorizations/professionals/route.ts`, `tests/billing/authorizations-api.test.ts`.

**Interfaces:**
- Consumes: `requireBilling(req, { adminOnly: false })`; Tarefas 6, 7, 11.
- Produces (HTTP):
  - `GET /api/billing/authorizations?status=a,b&type=&insurer_id=&professional_id=&patient_id=&from=&to=&page=` → `200 { authorizations: AuthorizationListRow[]; total: number; page: number; pageSize: 50 }`.
  - `POST /api/billing/authorizations` body `CreateInput` → `201 { id, status, provider_guide_number }` | 400 | 403 | 404 | 409.
  - `GET /api/billing/authorizations/professionals` → `200 { professionals: ProfessionalOption[] }`.

Antes de escrever: ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (assinatura de handlers e `params` como Promise no Next 16).

- [ ] **12.1 Testes que falham.** Criar `tests/billing/authorizations-api.test.ts` (as Tarefas 13 e 14 acrescentam imports e `describe`s):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock, type SupabaseMockConfig } from '../helpers/supabase-mock'
import { AUTH_SOURCES } from '../tiss/authorization-fixtures'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  session: null as null | { userId: string; accountId: string; workspaceId: string; role: string; modules: string[] },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client,
  // Rotas de autorização nunca usam service role.
  createAdminClient: () => { throw new Error('service client em rota de usuário') },
}))
vi.mock('@/lib/session/api', async () => {
  const { NextResponse: NR } = await import('next/server')
  return {
    requireWorkspaceSession: async () =>
      g.session ? { session: g.session } : { error: NR.json({ error: 'Unauthorized' }, { status: 401 }) },
    requireRole: (session: { role: string }, roles: string[]) =>
      roles.includes(session.role) ? null : NR.json({ error: 'forbidden' }, { status: 403 }),
  }
})

import { GET as list, POST as create } from '@/app/api/billing/authorizations/route'
import { GET as professionals } from '@/app/api/billing/authorizations/professionals/route'

const MEMBER = { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'member', modules: ['billing'] }
const AT = '2026-10-05T13:00:00.123456+00:00'
const APPOINTMENT = '30000000-0000-0000-0000-000000000001'

function setup(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock({ accounts: { select: { data: { modules: ['billing'] } } }, ...config })
  return g.supabase
}
const req = (url: string, init?: RequestInit) => new NextRequest(`https://app.test${url}`, init as never)
const json = (body: unknown, method = 'POST') => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('GET/POST /api/billing/authorizations', () => {
  beforeEach(() => {
    g.session = { ...MEMBER }
    setup()
  })

  it('member lista com filtros, presa à account', async () => {
    setup({ tiss_authorizations: { select: { data: [], count: 0 } } })
    const uuid = '40000000-0000-0000-0000-000000000001'
    const res = await list(req(`/api/billing/authorizations?status=draft,bogus&type=opme_request&insurer_id=${uuid}&patient_id=${uuid}&professional_id=${uuid}&from=2026-10-01&to=2026-10-31`))
    expect(res.status).toBe(200)
    const [call] = g.supabase.callsTo('tiss_authorizations', 'select')
    expect(call.filters).toEqual(expect.arrayContaining([
      ['eq', 'account_id', 'acc1'],
      ['in', 'status', ['draft']],
      ['eq', 'type', 'opme_request'],
      ['eq', 'insurer_id', uuid],
      ['eq', 'patient_id', uuid],
      ['filter', 'payload->professional->>id', 'eq', uuid],
      ['gte', 'requested_at', '2026-10-01'],
      ['lte', 'requested_at', '2026-10-31'],
    ]))
  })

  it('account sem o módulo billing recebe 403 sem consultar autorizações', async () => {
    setup({ accounts: { select: { data: { modules: ['agenda'] } } } })
    expect((await list(req('/api/billing/authorizations'))).status).toBe(403)
    expect(g.supabase.callsTo('tiss_authorizations')).toHaveLength(0)
  })

  it('member cria a partir do agendamento: RPC com snapshot, pendências e item TUSS; sem tocar em guias', async () => {
    setup({
      appointments: { select: { data: { id: APPOINTMENT, workspace_id: 'w2', patient_id: 'pa1', doctor_id: 'p1', insurer_id: 'in1', patient_insurance_id: 'pi1', insurer_procedure_id: 'pr1' } } },
      insurer_procedures: { select: { data: { tuss_code: '40301630', description: 'Hemograma' } } },
      health_insurers: { select: { data: AUTH_SOURCES.insurer } },
      workspaces: { select: { data: AUTH_SOURCES.workspace } },
      patient_insurances: { select: { data: [{ id: 'pi1', card_number: 'CARD-1', is_primary: true }] } },
    })
    g.supabase.rpc.mockImplementation(async (fn: string) =>
      fn === 'tiss_authorization_professionals'
        ? { data: [AUTH_SOURCES.professional], error: null }
        : { data: { id: 'a1', status: 'ready', provider_guide_number: '41' }, error: null })

    const res = await create(req('/api/billing/authorizations', json({ type: 'sp_sadt_request', appointment_id: APPOINTMENT })))

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'a1', status: 'ready', provider_guide_number: '41' })
    const [, args] = g.supabase.rpc.mock.calls.find(([fn]) => fn === 'create_tiss_authorization') ?? []
    expect(args).toMatchObject({
      p_workspace_id: 'w2', p_patient_id: 'pa1', p_insurer_id: 'in1', p_type: 'sp_sadt_request',
      p_appointment_id: APPOINTMENT, p_parent_id: null, p_missing_fields: [],
      p_items: [expect.objectContaining({ table_code: '22', code: '40301630' })],
      p_payload: expect.objectContaining({ type: 'sp_sadt_request', professional: expect.objectContaining({ id: 'p1' }) }),
    })
    expect(g.supabase.callsTo('tiss_guides')).toHaveLength(0)
  })

  it('corpo inválido → 400; erro do RPC vira mensagem fixa', async () => {
    expect((await create(req('/api/billing/authorizations', json({ type: 'opme_request' })))).status).toBe(400)
    setup({
      health_insurers: { select: { data: AUTH_SOURCES.insurer } },
      workspaces: { select: { data: AUTH_SOURCES.workspace } },
      patient_insurances: { select: { data: [] } },
    })
    g.supabase.rpc.mockImplementation(async (fn: string) =>
      fn === 'tiss_authorization_professionals' ? { data: [], error: null } : { data: null, error: { message: 'tiss_authorization_forbidden', code: '42501' } })
    const uuid = '40000000-0000-0000-0000-000000000001'
    const res = await create(req('/api/billing/authorizations', json({ type: 'hospitalization_request', patient_id: uuid, insurer_id: uuid })))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Sem permissão para esta ação.' })
  })

  it('lista profissionais da account pelo RPC, no workspace da sessão', async () => {
    g.supabase.rpc.mockResolvedValue({ data: [AUTH_SOURCES.professional], error: null })
    const res = await professionals(req('/api/billing/authorizations/professionals'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ professionals: [AUTH_SOURCES.professional] })
    expect(g.supabase.rpc).toHaveBeenCalledWith('tiss_authorization_professionals', { p_workspace_id: 'w1' })
  })
})
```

- [ ] **12.2 Rodar e ver falhar:** `npx vitest run tests/billing/authorizations-api.test.ts`.

- [ ] **12.3 Implementar `app/api/billing/authorizations/route.ts`:**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { isDate } from '@/lib/billing/validation'
import { AUTHORIZATION_LIST_COLUMNS } from '@/lib/billing/authorizations/constants'
import { computeAuthorizationMissing } from '@/lib/billing/authorizations/missing'
import { authorizationRpcError } from '@/lib/billing/authorizations/rpc-errors'
import { resolveCreateContext } from '@/lib/billing/authorizations/sources'
import { isAuthorizationStatus, isAuthorizationType } from '@/lib/billing/authorizations/status'
import { parseCreateBody } from '@/lib/billing/authorizations/validation'

const PAGE_SIZE = 50
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Qualquer membro com o módulo billing ativo na account; a RLS restringe aos
// workspaces do membro. Filtros: ?status=draft,sent &type= &insurer_id=
// &patient_id= &professional_id= &from=&to= (data da solicitação) &page=
export async function GET(req: NextRequest) {
  const result = await requireBilling(req, { adminOnly: false })
  if ('error' in result) return result.error
  const { session } = result

  const sp = req.nextUrl.searchParams
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const statuses = (sp.get('status') ?? '').split(',').filter(isAuthorizationStatus)
  const type = sp.get('type')

  const supabase = await createClient()
  let query = supabase
    .from('tiss_authorizations')
    .select(AUTHORIZATION_LIST_COLUMNS, { count: 'exact' })
    .eq('account_id', session.accountId)
    .order('requested_at', { ascending: false })
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

  if (statuses.length > 0) query = query.in('status', statuses)
  if (isAuthorizationType(type)) query = query.eq('type', type)
  for (const key of ['insurer_id', 'patient_id'] as const) {
    const value = sp.get(key)
    if (value && UUID.test(value)) query = query.eq(key, value)
  }
  const professionalId = sp.get('professional_id')
  if (professionalId && UUID.test(professionalId)) {
    query = query.filter('payload->professional->>id', 'eq', professionalId)
  }
  const from = sp.get('from')
  const to = sp.get('to')
  if (from && isDate(from)) query = query.gte('requested_at', from)
  if (to && isDate(to)) query = query.lte('requested_at', to)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: 'Não foi possível carregar as autorizações.' }, { status: 500 })
  return NextResponse.json({ authorizations: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE })
}

// Cria a partir do agendamento, do paciente+operadora ou (OPME) da guia de
// origem. O snapshot é montado aqui; o RPC numera, valida acesso e grava.
export async function POST(req: NextRequest) {
  const result = await requireBilling(req, { adminOnly: false })
  if ('error' in result) return result.error
  const { session } = result

  const parsed = parseCreateBody(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const supabase = await createClient()
  let resolved: Awaited<ReturnType<typeof resolveCreateContext>>
  try {
    resolved = await resolveCreateContext(supabase, session, parsed.value)
  } catch {
    return NextResponse.json({ error: 'Não foi possível montar a autorização.' }, { status: 500 })
  }
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  const { context } = resolved
  const { data, error } = await supabase.rpc('create_tiss_authorization', {
    p_workspace_id: context.workspaceId,
    p_patient_id: context.patientId,
    p_insurer_id: context.insurerId,
    p_type: parsed.value.type,
    p_appointment_id: context.appointmentId,
    p_parent_id: context.parentId,
    p_payload: context.payload,
    p_missing_fields: computeAuthorizationMissing(context.payload, context.items.length),
    p_items: context.items,
  })
  if (error || !data) return authorizationRpcError(error)
  return NextResponse.json(data, { status: 201 })
}
```

- [ ] **12.4 Implementar `app/api/billing/authorizations/professionals/route.ts`:**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { loadProfessionals } from '@/lib/billing/authorizations/sources'

// Profissionais com CRM da account, para o seletor "Profissional solicitante".
export async function GET(req: NextRequest) {
  const result = await requireBilling(req, { adminOnly: false })
  if ('error' in result) return result.error
  const { session } = result
  try {
    const supabase = await createClient()
    return NextResponse.json({ professionals: await loadProfessionals(supabase, session.workspaceId) })
  } catch {
    return NextResponse.json({ error: 'Não foi possível carregar os profissionais.' }, { status: 500 })
  }
}
```

- [ ] **12.5 Rodar e ver passar:** `npx vitest run tests/billing/authorizations-api.test.ts tests/billing/api.test.ts` e `npx tsc --noEmit`.
- [ ] **12.6 Commit:**

```bash
git add app/api/billing/authorizations tests/billing/authorizations-api.test.ts
git commit -m "feat(tiss): API de listagem e criação de autorizações

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 13 — API: detalhe, edição de conteúdo/"Recarregar dados" e itens

**Modelo sugerido:** sonnet

**Files:** criar `lib/billing/authorizations/detail.ts`, `app/api/billing/authorizations/[id]/route.ts`, `app/api/billing/authorizations/[id]/items/route.ts`; modificar `tests/billing/authorizations-api.test.ts`.

**Interfaces:**
- Produces:

```ts
// detail.ts
export async function loadAuthorizationDetail(supabase: SupabaseClient<Database>, accountId: string, id: string): Promise<AuthorizationDetail | null>
```
  - `GET /api/billing/authorizations/[id]` → `200 AuthorizationDetail` | 404.
  - `PATCH /api/billing/authorizations/[id]` body `ContentPatch` (`{ expected_updated_at, action?: 'refresh', card_number?, newborn?, patient_insurance_id?, professional_id?, professional_phone?, professional_email?, requested_at?, request? }`) → `200 AuthorizationDetail` | 400 | 404 | 409.
  - `PUT /api/billing/authorizations/[id]/items` body `{ expected_updated_at, items: AuthorizationItemInput[] }` → `200 AuthorizationDetail` | 400 | 404 | 409.

- [ ] **13.1 Testes que falham.** Em `tests/billing/authorizations-api.test.ts`, ampliar os imports existentes (`filterValue`, `type RecordedCall` de `../helpers/supabase-mock`; `fakeSpSadtRequest`, `procedureItem` de `../tiss/authorization-fixtures` — nas mesmas linhas de import, sem duplicar) e acrescentar:

```ts
import { GET as detail, PATCH as patch } from '@/app/api/billing/authorizations/[id]/route'
import { PUT as putItems } from '@/app/api/billing/authorizations/[id]/items/route'

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

function authorizationRow(over: Record<string, unknown> = {}) {
  return {
    id: 'a1', workspace_id: 'w1', patient_id: 'pa1', insurer_id: 'in1', appointment_id: null, parent_id: null,
    type: 'sp_sadt_request', status: 'ready', provider_guide_number: '41', missing_fields: [], requested_at: '2026-10-05',
    updated_at: AT, payload: fakeSpSadtRequest(1).payload, ...over,
  }
}

function detailMock(row = authorizationRow(), extra: SupabaseMockConfig = {}) {
  const m = setup({
    tiss_authorizations: { select: (call: RecordedCall) => (filterValue(call, 'eq', 'parent_id') ? { data: [] } : { data: row }) },
    tiss_authorization_items: { select: { data: [procedureItem(1)] } },
    ...extra,
  })
  m.rpc.mockImplementation(async (fn: string) =>
    fn === 'tiss_authorization_professionals' ? { data: [AUTH_SOURCES.professional], error: null } : { data: { id: 'a1' }, error: null })
  return m
}
const rpcArgs = (fn: string) => g.supabase.rpc.mock.calls.find(([name]) => name === fn)?.[1]

describe('detalhe, conteúdo e itens', () => {
  beforeEach(() => { g.session = { ...MEMBER } })

  it('detalhe traz itens, pai e filhos; 404 fora da account', async () => {
    detailMock()
    const res = await detail(req('/api/billing/authorizations/a1'), ctx('a1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ authorization: { id: 'a1' }, items: [{ id: 'i1' }], parent: null, children: [] })
    setup({ tiss_authorizations: { select: { data: null } } })
    expect((await detail(req('/api/billing/authorizations/x'), ctx('x'))).status).toBe(404)
  })

  it('edita o pedido repassando expected_updated_at como string e recalculando pendências', async () => {
    detailMock()
    const res = await patch(req('/api/billing/authorizations/a1', json({ expected_updated_at: AT, request: { observation: 'Em jejum' } }, 'PATCH')), ctx('a1'))
    expect(res.status).toBe(200)
    expect(rpcArgs('update_tiss_authorization')).toMatchObject({
      p_id: 'a1', p_expected_updated_at: AT, p_missing_fields: [], p_event: 'updated', p_requested_at: null,
      p_payload: expect.objectContaining({ request: expect.objectContaining({ observation: 'Em jejum' }) }),
    })
  })

  it('autorização enviada é somente leitura (409 sem RPC)', async () => {
    detailMock(authorizationRow({ status: 'sent' }))
    const res = await patch(req('/api/billing/authorizations/a1', json({ expected_updated_at: AT, card_number: 'X' }, 'PATCH')), ctx('a1'))
    expect(res.status).toBe(409)
    expect(rpcArgs('update_tiss_authorization')).toBeUndefined()
  })

  it('"Recarregar dados" relê configurações, preserva o pedido e grava evento refreshed', async () => {
    detailMock(authorizationRow(), {
      health_insurers: { select: { data: AUTH_SOURCES.insurer } },
      workspaces: { select: { data: { ...AUTH_SOURCES.workspace, legal_name: 'Razão Nova' } } },
      patient_insurances: { select: { data: [{ id: 'pi1', card_number: 'CARD-1', is_primary: true }] } },
    })
    await patch(req('/api/billing/authorizations/a1', json({ action: 'refresh', expected_updated_at: AT }, 'PATCH')), ctx('a1'))
    const args = rpcArgs('update_tiss_authorization') as { p_event: string; p_payload: { provider: { legal_name: string }; request: { clinical_indication: string } } }
    expect(args.p_event).toBe('refreshed')
    expect(args.p_payload.provider.legal_name).toBe('Razão Nova')
    expect(args.p_payload.request.clinical_indication).toBe('Investigação de anemia')
  })

  it('profissional fora da lista (sem CRM) → 400', async () => {
    detailMock(authorizationRow(), {
      health_insurers: { select: { data: AUTH_SOURCES.insurer } },
      workspaces: { select: { data: AUTH_SOURCES.workspace } },
      patient_insurances: { select: { data: [] } },
    })
    const other = '40000000-0000-0000-0000-000000000009'
    const res = await patch(req('/api/billing/authorizations/a1', json({ expected_updated_at: AT, professional_id: other }, 'PATCH')), ctx('a1'))
    expect(res.status).toBe(400)
  })

  it('conflito de edição vira 409 com mensagem fixa', async () => {
    const m = detailMock()
    m.rpc.mockImplementation(async () => ({ data: null, error: { message: 'tiss_authorization_changed' } }))
    const res = await patch(req('/api/billing/authorizations/a1', json({ expected_updated_at: AT, newborn: true }, 'PATCH')), ctx('a1'))
    expect(res.status).toBe(409)
  })

  it('substitui itens validados; OPME sem opção de fabricante → 400', async () => {
    detailMock()
    const items = [{ table_code: '22', code: '40301630', description: 'Hemograma', quantity_requested: 1 }, { table_code: '22', code: '40302040', description: 'Glicose', quantity_requested: 2 }]
    const ok = await putItems(req('/api/billing/authorizations/a1/items', json({ expected_updated_at: AT, items }, 'PUT')), ctx('a1'))
    expect(ok.status).toBe(200)
    expect(rpcArgs('update_tiss_authorization')).toMatchObject({ p_items: [expect.objectContaining({ code: '40301630' }), expect.objectContaining({ code: '40302040', quantity_requested: 2 })] })
    detailMock(authorizationRow({ type: 'opme_request', payload: { ...fakeSpSadtRequest(1).payload, type: 'opme_request', request: { technical_justification: 'x', material_specification: null, observation: null } } }))
    const bad = await putItems(req('/api/billing/authorizations/a1/items', json({ expected_updated_at: AT, items: [{ table_code: '19', code: '7000', description: 'Placa', quantity_requested: 1 }] }, 'PUT')), ctx('a1'))
    expect(bad.status).toBe(400)
  })
})
```

- [ ] **13.2 Rodar e ver falhar:** `npx vitest run tests/billing/authorizations-api.test.ts -t "detalhe, conteúdo e itens"`.

- [ ] **13.3 Implementar `lib/billing/authorizations/detail.ts`:**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { AUTHORIZATION_COLUMNS, AUTHORIZATION_ITEM_COLUMNS, AUTHORIZATION_SUMMARY_COLUMNS } from './constants'
import type { AuthorizationDetail, AuthorizationItem, AuthorizationRow, AuthorizationSummary } from './types'

// Leitura com o client do usuário: a RLS garante workspace; o filtro de
// account repete a regra (padrão das rotas de faturamento).
export async function loadAuthorizationDetail(
  supabase: SupabaseClient<Database>,
  accountId: string,
  id: string,
): Promise<AuthorizationDetail | null> {
  const { data } = await supabase
    .from('tiss_authorizations')
    .select(AUTHORIZATION_COLUMNS)
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!data) return null
  const authorization = data as unknown as AuthorizationRow

  const [{ data: items }, { data: parent }, { data: children }] = await Promise.all([
    supabase
      .from('tiss_authorization_items')
      .select(AUTHORIZATION_ITEM_COLUMNS)
      .eq('authorization_id', id)
      .order('position', { ascending: true }),
    authorization.parent_id
      ? supabase
          .from('tiss_authorizations')
          .select(AUTHORIZATION_SUMMARY_COLUMNS)
          .eq('id', authorization.parent_id)
          .eq('account_id', accountId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('tiss_authorizations')
      .select(AUTHORIZATION_SUMMARY_COLUMNS)
      .eq('parent_id', id)
      .eq('account_id', accountId)
      .order('created_at', { ascending: true }),
  ])

  return {
    authorization,
    items: (items ?? []) as unknown as AuthorizationItem[],
    parent: (parent ?? null) as unknown as AuthorizationSummary | null,
    children: (children ?? []) as unknown as AuthorizationSummary[],
  }
}
```

> No teste, o mock devolve a mesma linha para "pai" e para o principal quando `parent_id` existe; os testes desta tarefa usam `parent_id: null`.

- [ ] **13.4 Implementar `app/api/billing/authorizations/[id]/route.ts`:**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { loadAuthorizationDetail } from '@/lib/billing/authorizations/detail'
import { applyContentPatch, refreshPayload, type PatchDeps } from '@/lib/billing/authorizations/edit'
import { computeAuthorizationMissing } from '@/lib/billing/authorizations/missing'
import { authorizationRpcError } from '@/lib/billing/authorizations/rpc-errors'
import { loadAuthorizationSources } from '@/lib/billing/authorizations/sources'
import { isEditable } from '@/lib/billing/authorizations/status'
import type { AnyAuthorizationPayload } from '@/lib/billing/authorizations/types'
import { parseContentPatch } from '@/lib/billing/authorizations/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: false })
  if ('error' in result) return result.error
  const supabase = await createClient()
  const found = await loadAuthorizationDetail(supabase, result.session.accountId, id)
  if (!found) return NextResponse.json({ error: 'Autorização não encontrada' }, { status: 404 })
  return NextResponse.json(found)
}

// Conteúdo só em draft/ready (o RPC repete a regra e confere updated_at).
// { action: 'refresh' } = "Recarregar dados" (configurações novas, pedido preservado).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: false })
  if ('error' in result) return result.error
  const { session } = result

  const parsed = parseContentPatch(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const patch = parsed.value

  const supabase = await createClient()
  const current = await loadAuthorizationDetail(supabase, session.accountId, id)
  if (!current) return NextResponse.json({ error: 'Autorização não encontrada' }, { status: 404 })
  const a = current.authorization
  if (!isEditable(a.status)) {
    return NextResponse.json({ error: 'Autorização já enviada ou cancelada — somente leitura.' }, { status: 409 })
  }

  let payload: AnyAuthorizationPayload
  try {
    const needsSources = patch.refresh || patch.professional_id !== undefined || patch.patient_insurance_id !== undefined
    if (needsSources) {
      const loaded = await loadAuthorizationSources(supabase, {
        accountId: session.accountId,
        workspaceId: a.workspace_id,
        insurerId: a.insurer_id,
        patientId: a.patient_id,
        patientInsuranceId: patch.patient_insurance_id !== undefined ? patch.patient_insurance_id : a.payload.beneficiary.patient_insurance_id,
        professionalId: patch.professional_id !== undefined ? patch.professional_id : a.payload.professional.id,
      })
      if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
      if (patch.refresh) {
        payload = refreshPayload(a.payload, loaded.sources)
      } else {
        if (patch.professional_id && !loaded.sources.professional) {
          return NextResponse.json({ error: 'Profissional não encontrado ou sem CRM cadastrado.' }, { status: 400 })
        }
        if (patch.patient_insurance_id && !loaded.sources.patientInsurance) {
          return NextResponse.json({ error: 'Carteirinha não é deste paciente nesta operadora.' }, { status: 400 })
        }
        const deps: PatchDeps = {
          professional: patch.professional_id !== undefined ? loaded.sources.professional : undefined,
          patientInsurance: patch.patient_insurance_id !== undefined ? loaded.sources.patientInsurance : undefined,
        }
        const applied = applyContentPatch(a.payload, patch, deps)
        if (!applied.ok) return NextResponse.json({ error: applied.error }, { status: 400 })
        payload = applied.value
      }
    } else {
      const applied = applyContentPatch(a.payload, patch, {})
      if (!applied.ok) return NextResponse.json({ error: applied.error }, { status: 400 })
      payload = applied.value
    }
  } catch {
    return NextResponse.json({ error: 'Não foi possível carregar os dados da autorização.' }, { status: 500 })
  }

  const { error } = await supabase.rpc('update_tiss_authorization', {
    p_id: id,
    p_expected_updated_at: patch.expected_updated_at,
    p_payload: payload,
    p_missing_fields: computeAuthorizationMissing(payload, current.items.length),
    p_requested_at: patch.requested_at ?? null,
    p_event: patch.refresh ? 'refreshed' : 'updated',
  })
  if (error) return authorizationRpcError(error)
  return NextResponse.json(await loadAuthorizationDetail(supabase, session.accountId, id))
}
```

- [ ] **13.5 Implementar `app/api/billing/authorizations/[id]/items/route.ts`:**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { loadAuthorizationDetail } from '@/lib/billing/authorizations/detail'
import { computeAuthorizationMissing } from '@/lib/billing/authorizations/missing'
import { authorizationRpcError } from '@/lib/billing/authorizations/rpc-errors'
import { isEditable } from '@/lib/billing/authorizations/status'
import { parseExpectedUpdatedAt, parseItems } from '@/lib/billing/authorizations/validation'

// Substitui todos os itens (procedimentos ou materiais OPME) numa transação,
// recalculando as pendências; só em draft/ready.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: false })
  if ('error' in result) return result.error
  const { session } = result

  const body: unknown = await req.json().catch(() => null)
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const at = parseExpectedUpdatedAt(record.expected_updated_at)
  if (!at.ok) return NextResponse.json({ error: at.error }, { status: 400 })

  const supabase = await createClient()
  const current = await loadAuthorizationDetail(supabase, session.accountId, id)
  if (!current) return NextResponse.json({ error: 'Autorização não encontrada' }, { status: 404 })
  if (!isEditable(current.authorization.status)) {
    return NextResponse.json({ error: 'Autorização já enviada ou cancelada — somente leitura.' }, { status: 409 })
  }

  const items = parseItems(current.authorization.type, record.items)
  if (!items.ok) return NextResponse.json({ error: items.error }, { status: 400 })

  const { error } = await supabase.rpc('update_tiss_authorization', {
    p_id: id,
    p_expected_updated_at: at.value,
    p_payload: current.authorization.payload,
    p_missing_fields: computeAuthorizationMissing(current.authorization.payload, items.value.length),
    p_items: items.value,
    p_event: 'updated',
  })
  if (error) return authorizationRpcError(error)
  return NextResponse.json(await loadAuthorizationDetail(supabase, session.accountId, id))
}
```

- [ ] **13.6 Rodar e ver passar:** `npx vitest run tests/billing/authorizations-api.test.ts` e `npx tsc --noEmit`.
- [ ] **13.7 Commit:**

```bash
git add lib/billing/authorizations/detail.ts app/api/billing/authorizations tests/billing/authorizations-api.test.ts
git commit -m "feat(tiss): API de detalhe, edição, recarga e itens das autorizações

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 14 — API: envio, cancelamento, resposta, histórico e download do XML

**Modelo sugerido:** sonnet

**Files:** criar `app/api/billing/authorizations/[id]/transitions/route.ts`, `[id]/response/route.ts`, `[id]/events/route.ts`, `[id]/xml/route.ts`; modificar `next.config.ts`, `tests/billing/authorizations-api.test.ts`.

**Interfaces (Produces, HTTP):**
- `POST …/[id]/transitions` body `{ to: 'sent' | 'cancelled'; expected_updated_at: string }` → `200 AuthorizationDetail` | 400 | 403 (member cancelando após envio) | 404 | 409.
- `POST …/[id]/response` body `{ expected_updated_at, status_code, operator_guide_number?, password?, authorization_date?, password_valid_until?, items?: [{ id, quantity_authorized?, authorized_value_cents? }] }` → `200 AuthorizationDetail` | 400 | 403 (código 6 por member) | 404 | 409.
- `GET …/[id]/events` → `200 { events: AuthorizationEventRow[] }`.
- `GET …/[id]/xml` → `200` corpo ISO-8859-1, `Content-Type: application/xml; charset=ISO-8859-1`, `Content-Disposition: attachment; filename="<prefixo>-<número>.xml"`, `Cache-Control: no-store` | 404 | 409 | 422 `{ error, errors }`.

- [ ] **14.1 Testes que falham.** Acrescentar a `tests/billing/authorizations-api.test.ts`:

```ts
import { POST as transition } from '@/app/api/billing/authorizations/[id]/transitions/route'
import { POST as respond } from '@/app/api/billing/authorizations/[id]/response/route'
import { GET as events } from '@/app/api/billing/authorizations/[id]/events/route'
import { GET as xml } from '@/app/api/billing/authorizations/[id]/xml/route'

describe('status, resposta, histórico e XML', () => {
  beforeEach(() => { g.session = { ...MEMBER } })

  it('member marca como enviada a partir de ready', async () => {
    detailMock()
    const res = await transition(req('/api/billing/authorizations/a1/transitions', json({ to: 'sent', expected_updated_at: AT })), ctx('a1'))
    expect(res.status).toBe(200)
    expect(rpcArgs('transition_tiss_authorization')).toEqual({ p_id: 'a1', p_to: 'sent', p_expected_updated_at: AT })
  })

  it('member não cancela depois do envio (403 sem RPC); owner cancela; terminal → 409', async () => {
    detailMock(authorizationRow({ status: 'sent' }))
    expect((await transition(req('/x', json({ to: 'cancelled', expected_updated_at: AT })), ctx('a1'))).status).toBe(403)
    expect(rpcArgs('transition_tiss_authorization')).toBeUndefined()
    g.session = { ...MEMBER, role: 'owner' }
    expect((await transition(req('/x', json({ to: 'cancelled', expected_updated_at: AT })), ctx('a1'))).status).toBe(200)
    detailMock(authorizationRow({ status: 'authorized' }))
    expect((await transition(req('/x', json({ to: 'cancelled', expected_updated_at: AT })), ctx('a1'))).status).toBe(409)
  })

  it('resposta: member registra autorização com itens; código 6 só owner/admin; antes do envio → 409', async () => {
    detailMock(authorizationRow({ status: 'sent' }))
    const ok = await respond(req('/x', json({ expected_updated_at: AT, status_code: '1', operator_guide_number: 'OP1', password: 'S1',
      authorization_date: '2026-10-06', password_valid_until: '2026-11-05', items: [{ id: 'i1', quantity_authorized: 1 }] })), ctx('a1'))
    expect(ok.status).toBe(200)
    expect(rpcArgs('record_tiss_authorization_response')).toEqual({
      p_id: 'a1', p_expected_updated_at: AT, p_status_code: '1', p_operator_guide_number: 'OP1', p_password: 'S1',
      p_authorization_date: '2026-10-06', p_password_valid_until: '2026-11-05',
      p_items: [{ id: 'i1', quantity_authorized: 1, authorized_value_cents: null }],
    })
    detailMock(authorizationRow({ status: 'sent' }))
    expect((await respond(req('/x', json({ expected_updated_at: AT, status_code: '6' })), ctx('a1'))).status).toBe(403)
    detailMock(authorizationRow({ status: 'ready' }))
    expect((await respond(req('/x', json({ expected_updated_at: AT, status_code: '1' })), ctx('a1'))).status).toBe(409)
    expect(rpcArgs('record_tiss_authorization_response')).toBeUndefined()
  })

  it('histórico em ordem de gravação, preso à account', async () => {
    setup({ tiss_authorization_events: { select: { data: [{ id: 1, event: 'created' }, { id: 2, event: 'ready' }] } } })
    const res = await events(req('/x'), ctx('a1'))
    expect(await res.json()).toEqual({ events: [{ id: 1, event: 'created' }, { id: 2, event: 'ready' }] })
    const [call] = g.supabase.callsTo('tiss_authorization_events', 'select')
    expect(call.filters).toEqual(expect.arrayContaining([['eq', 'authorization_id', 'a1'], ['eq', 'account_id', 'acc1'], ['order', 'id', { ascending: true }]]))
  })

  it('XML: rascunho → 409 JSON; pronta → arquivo ISO-8859-1 com nome e evento registrado', async () => {
    detailMock(authorizationRow({ status: 'draft', missing_fields: ['items'] }))
    expect((await xml(req('/x'), ctx('a1'))).status).toBe(409)
    detailMock()
    const res = await xml(req('/x'), ctx('a1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/xml; charset=ISO-8859-1')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="solicitacao-sp-sadt-41.xml"')
    const body = Buffer.from(await res.arrayBuffer()).toString('latin1')
    expect(body.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe(true)
    expect(body).toContain('<ans:tipoTransacao>SOLICITACAO_PROCEDIMENTOS</ans:tipoTransacao>')
    expect(rpcArgs('log_tiss_authorization_xml')).toMatchObject({ p_id: 'a1', p_hash: expect.stringMatching(/^[a-f0-9]{32}$/) })
  })
})
```

- [ ] **14.2 Rodar e ver falhar:** `npx vitest run tests/billing/authorizations-api.test.ts -t "status, resposta"`.

- [ ] **14.3 Implementar `app/api/billing/authorizations/[id]/transitions/route.ts`:**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { loadAuthorizationDetail } from '@/lib/billing/authorizations/detail'
import { authorizationRpcError } from '@/lib/billing/authorizations/rpc-errors'
import { canCancel, canMarkSent } from '@/lib/billing/authorizations/status'
import { parseExpectedUpdatedAt } from '@/lib/billing/authorizations/validation'

// D3: ready → sent (qualquer membro); cancelamento até ready por qualquer
// membro, depois do envio só owner/admin. O RPC repete tudo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: false })
  if ('error' in result) return result.error
  const { session } = result

  const body: unknown = await req.json().catch(() => null)
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const to = record.to
  if (to !== 'sent' && to !== 'cancelled') return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  const at = parseExpectedUpdatedAt(record.expected_updated_at)
  if (!at.ok) return NextResponse.json({ error: at.error }, { status: 400 })

  const supabase = await createClient()
  const current = await loadAuthorizationDetail(supabase, session.accountId, id)
  if (!current) return NextResponse.json({ error: 'Autorização não encontrada' }, { status: 404 })
  const { status } = current.authorization

  if (to === 'sent' && !canMarkSent(status)) {
    return NextResponse.json({ error: 'Só autorizações prontas podem ser marcadas como enviadas.' }, { status: 409 })
  }
  if (to === 'cancelled' && !canCancel(status, session.role)) {
    return canCancel(status, 'owner')
      ? NextResponse.json({ error: 'Só owner/admin cancelam uma autorização já enviada.' }, { status: 403 })
      : NextResponse.json({ error: 'Esta autorização não pode mais ser cancelada.' }, { status: 409 })
  }

  const { error } = await supabase.rpc('transition_tiss_authorization', { p_id: id, p_to: to, p_expected_updated_at: at.value })
  if (error) return authorizationRpcError(error)
  return NextResponse.json(await loadAuthorizationDetail(supabase, session.accountId, id))
}
```

- [ ] **14.4 Implementar `app/api/billing/authorizations/[id]/response/route.ts`:**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { loadAuthorizationDetail } from '@/lib/billing/authorizations/detail'
import { authorizationRpcError } from '@/lib/billing/authorizations/rpc-errors'
import { canRecordResponse } from '@/lib/billing/authorizations/status'
import { parseResponseBody } from '@/lib/billing/authorizations/validation'

// D6: resposta da operadora digitada (status, número na operadora, senha,
// datas e quantidades/valores autorizados). Sem parse de XML de resposta.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: false })
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const current = await loadAuthorizationDetail(supabase, session.accountId, id)
  if (!current) return NextResponse.json({ error: 'Autorização não encontrada' }, { status: 404 })

  const parsed = parseResponseBody(await req.json().catch(() => null), current.items)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const r = parsed.value

  const { status } = current.authorization
  if (!canRecordResponse(status, r.status_code, session.role)) {
    return canRecordResponse(status, r.status_code, 'owner')
      ? NextResponse.json({ error: 'Só owner/admin registram o cancelamento pela operadora.' }, { status: 403 })
      : NextResponse.json({ error: 'A resposta só pode ser registrada depois do envio.' }, { status: 409 })
  }

  const { error } = await supabase.rpc('record_tiss_authorization_response', {
    p_id: id,
    p_expected_updated_at: r.expected_updated_at,
    p_status_code: r.status_code,
    p_operator_guide_number: r.operator_guide_number,
    p_password: r.password,
    p_authorization_date: r.authorization_date,
    p_password_valid_until: r.password_valid_until,
    p_items: r.items,
  })
  if (error) return authorizationRpcError(error)
  return NextResponse.json(await loadAuthorizationDetail(supabase, session.accountId, id))
}
```

- [ ] **14.5 Implementar `app/api/billing/authorizations/[id]/events/route.ts`:**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: false })
  if ('error' in result) return result.error

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tiss_authorization_events')
    .select('id, event, from_status, to_status, actor_id, data, created_at')
    .eq('authorization_id', id)
    .eq('account_id', result.session.accountId)
    .order('id', { ascending: true })
  if (error) return NextResponse.json({ error: 'Não foi possível carregar o histórico.' }, { status: 500 })
  return NextResponse.json({ events: data ?? [] })
}
```

- [ ] **14.6 Implementar `app/api/billing/authorizations/[id]/xml/route.ts`:**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { authorizationRpcError } from '@/lib/billing/authorizations/rpc-errors'
import { generateAuthorizationXml } from '@/lib/billing/authorizations/xml'

// Validação com xmllint-wasm pode levar alguns segundos na primeira chamada.
export const maxDuration = 60

// Gera o XML na hora (D5: nada no storage), valida no XSD e registra o
// evento xml_generated. Erros de validação saem sem valores.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: false })
  if ('error' in result) return result.error

  const supabase = await createClient()
  const generated = await generateAuthorizationXml(supabase, result.session.accountId, id, new Date())
  if (!generated.ok) {
    if ('rpcError' in generated) return authorizationRpcError(generated.rpcError)
    return NextResponse.json(
      { error: generated.error, ...(generated.errors ? { errors: generated.errors } : {}) },
      { status: generated.status },
    )
  }
  return new NextResponse(new Uint8Array(generated.xml), {
    headers: {
      'Content-Type': 'application/xml; charset=ISO-8859-1',
      'Content-Disposition': `attachment; filename="${generated.fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
}
```

- [ ] **14.7 `next.config.ts`:** em `outputFileTracingIncludes`, acrescentar a rota de XML ao lado das duas existentes (mesmo motivo: XSDs lidos do disco em runtime). Conferir na doc local (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md` ou equivalente — `grep -rl outputFileTracingIncludes node_modules/next/dist/docs`) como a chave casa rotas dinâmicas; usar o glob indicado, por exemplo:

```ts
    '/api/billing/authorizations/*/xml': ['./lib/tiss/schemas/**/*'],
```

Verificação no build (Tarefa 19): o arquivo `.next/server/app/api/billing/authorizations/[id]/xml/route.js.nft.json` precisa listar `tissV4_03_00.xsd`.

- [ ] **14.8 Rodar e ver passar:** `npx vitest run tests/billing/authorizations-api.test.ts tests/billing/api.test.ts tests/billing/user-client.test.ts` e `npx tsc --noEmit`.
- [ ] **14.9 Commit:**

```bash
git add app/api/billing/authorizations next.config.ts tests/billing/authorizations-api.test.ts
git commit -m "feat(tiss): API de envio, cancelamento, resposta, histórico e XML das autorizações

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 15 — Navegação "Convênios / TISS" e abas de `/faturamento` por papel

**Modelo sugerido:** sonnet

**Files:** criar `lib/billing/tabs.ts`; modificar `lib/nav/tabs.ts`, `tests/nav/tabs.test.ts`, `app/(dashboard)/faturamento/page.tsx`.

**Interfaces:**
- Produces:

```ts
// lib/billing/tabs.ts
export type BillingTab = 'autorizacoes' | 'guias' | 'lotes'
export function billingTabsFor(role: MembershipRole): BillingTab[]
export function resolveBillingTab(requested: string | undefined, role: MembershipRole): BillingTab
```
- `MODULE_ROUTES.billing = { href: '/faturamento', label: 'Convênios / TISS' }`; `ADMIN_MIN_MODULES = ['revenue_cycle']`.

Desenho (resolve o conflito "billing está em ADMIN_MIN_MODULES"): o slug `billing` continua sendo o único item de menu, agora visível para `member`; o que é admin-only passa a ser decidido **dentro** da página (abas) e nas APIs/RLS (inalteradas). Guias/Lotes: a página não renderiza as abas para member e as rotas `/api/billing/guides|batches` continuam `adminOnly: true` (403 coberto em `tests/billing/api.test.ts`), e a RLS `is_account_admin` continua valendo. Não se cria slug novo, nem se mexe em `OVERRIDABLE_MODULES`.

Antes de escrever: ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` (seção `searchParams`, que é `Promise` no Next 16).

- [ ] **15.1 Testes que falham.** Em `tests/nav/tabs.test.ts`, trocar o caso `'billing nega member, libera admin/owner'` por:

```ts
  it('billing (Convênios / TISS) aparece para member, admin e owner — Guias/Lotes são filtrados na página', () => {
    expect(isModuleVisible('billing', ['billing'], 'member')).toBe(true)
    expect(isModuleVisible('billing', ['billing'], 'admin')).toBe(true)
    expect(isModuleVisible('billing', ['billing'], 'owner')).toBe(true)
    expect(isModuleVisible('billing', ['agenda'], 'owner')).toBe(false)
  })
```

e acrescentar ao fim do arquivo:

```ts
import { billingTabsFor, resolveBillingTab } from '@/lib/billing/tabs'

describe('Convênios / TISS', () => {
  it('rótulo e título da rota', () => {
    expect(MODULE_ROUTES.billing).toEqual({ href: '/faturamento', label: 'Convênios / TISS' })
    expect(moduleTitleFromPath('/faturamento')).toBe('Convênios / TISS')
  })
  it('member só vê Autorizações; owner/admin veem as três abas', () => {
    expect(billingTabsFor('member')).toEqual(['autorizacoes'])
    expect(billingTabsFor('admin')).toEqual(['autorizacoes', 'guias', 'lotes'])
    expect(resolveBillingTab('guias', 'member')).toBe('autorizacoes')
    expect(resolveBillingTab('lotes', 'owner')).toBe('lotes')
    expect(resolveBillingTab(undefined, 'owner')).toBe('autorizacoes')
  })
})
```

- [ ] **15.2 Rodar e ver falhar:** `npx vitest run tests/nav/tabs.test.ts`.
- [ ] **15.3 Implementar.**
  - `lib/nav/tabs.ts`: `billing: { href: '/faturamento', label: 'Convênios / TISS' }`; `export const ADMIN_MIN_MODULES: ModuleSlug[] = ['revenue_cycle']` com o comentário: "'billing' saiu daqui: member vê o menu Convênios / TISS e só a aba Autorizações; Guias e Lotes seguem admin-only na página, na API (requireBilling adminOnly) e na RLS (is_account_admin)."
  - `lib/billing/tabs.ts`:

```ts
import type { MembershipRole } from '@/types/database'

export type BillingTab = 'autorizacoes' | 'guias' | 'lotes'

// Autorizações: todo membro da account com o módulo. Guias e lotes: owner/admin
// (mesma regra das rotas /api/billing/guides|batches e da RLS).
export function billingTabsFor(role: MembershipRole): BillingTab[] {
  return role === 'member' ? ['autorizacoes'] : ['autorizacoes', 'guias', 'lotes']
}

export function resolveBillingTab(requested: string | undefined, role: MembershipRole): BillingTab {
  const tabs = billingTabsFor(role)
  return tabs.find((t) => t === requested) ?? 'autorizacoes'
}
```

  - `app/(dashboard)/faturamento/page.tsx`:
    - assinatura `export default async function FaturamentoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> })`;
    - redireciona para `/dashboard` só quando `!session.accountModules.includes('billing')` (member agora entra);
    - título "Convênios / TISS", subtítulo "Autorizações prévias (SP/SADT, internação e OPME) e, para a gestão, guias e lotes XML.";
    - lê `tab`, `nova` (tipo), `appointment_id` e `autorizacao` (id para abrir) dos `searchParams` (só strings; arrays ignorados); `nova` só vale se `isAuthorizationType(nova) && nova !== 'opme_request'` (OPME nasce do pai), os ids só se tiverem formato de UUID;
    - sem operadoras: owner/admin veem o link para `/configuracoes/convenios` (texto atual); member vê "Peça a um administrador para cadastrar as operadoras.";
    - `Tabs defaultValue={resolveBillingTab(tab, session.role)}` com `TabsTrigger`/`TabsContent` gerados por `billingTabsFor(session.role)`: `autorizacoes` → `<AuthorizationsTable insurers={insurers} role={session.role} initial={{ newType, appointmentId, openId }} />` (Tarefa 16; até lá, renderizar um placeholder `null` e importar na Tarefa 16), `guias` → `GuidesTable`, `lotes` → `BatchesTable` (sem mudanças).
- [ ] **15.4 Rodar e ver passar:** `npx vitest run tests/nav/tabs.test.ts` e `npx tsc --noEmit`.
- [ ] **15.5 Commit:**

```bash
git add lib/nav/tabs.ts lib/billing/tabs.ts tests/nav/tabs.test.ts "app/(dashboard)/faturamento/page.tsx"
git commit -m "feat(tiss): menu Convênios / TISS para membros com abas por papel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 16 — UI: tabela de autorizações, filtros e criação

**Modelo sugerido:** sonnet

**Files:** criar `components/billing/authorizations/AuthorizationStatusBadge.tsx`, `AuthorizationsTable.tsx`, `NewAuthorizationDialog.tsx`; modificar `app/(dashboard)/faturamento/page.tsx` (ligar o componente).

**Interfaces:**
- Consumes: `GET/POST /api/billing/authorizations`, `GET /api/billing/authorizations/professionals`, `GET /api/patients?q=`, `GET /api/billing/patients/[id]/insurances`; `InsurerOption` (`components/billing/PatientInsurances.tsx`); `formatDate` (`components/billing/GuideEditSheet.tsx`); rótulos da Tarefa 6; `friendlyErrorMessage` (`lib/friendly-errors`).
- Produces:

```tsx
// AuthorizationStatusBadge.tsx
export const AUTHORIZATION_STATUS_BADGE: Record<AuthorizationStatus, string>
export function AuthorizationStatusBadge(props: { status: AuthorizationStatus; missing?: number }): JSX.Element
// AuthorizationsTable.tsx
export function AuthorizationsTable(props: {
  insurers: InsurerOption[]
  role: MembershipRole
  initial?: { newType?: AuthorizationType; appointmentId?: string; openId?: string }
}): JSX.Element
// NewAuthorizationDialog.tsx
export function NewAuthorizationDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  insurers: InsurerOption[]
  defaults?: { type?: Exclude<AuthorizationType, 'opme_request'>; appointmentId?: string }
  onCreated: (id: string) => void
}): JSX.Element
```

Comportamento (seguir o padrão visual de `GuidesTable`/`BatchesTable`; classes `ph-no-capture ph-mask` em tudo que mostra paciente/carteirinha, como no `GuideEditSheet`):

- [ ] **16.1 Badge.** `AUTHORIZATION_STATUS_BADGE` reaproveita as cores de `STATUS_BADGE` das guias onde o conceito é o mesmo (`draft`, `ready`, `sent`, `cancelled`) e define `under_review`/`pending_info` (âmbar/azul claros), `authorized` (verde), `partially_authorized` (verde claro), `denied` (vermelho). Mostra `⚠ n pendências` quando `missing > 0`, como a tabela de guias.
- [ ] **16.2 Tabela.** Estado: filtros `status` (todos ou um dos 9), `type` (todos/SP-SADT/Internação/OPME), `insurer_id` (das `insurers`), `professional_id` (lista de `/professionals`, carregada uma vez), `patient` (campo de busca com debounce de 300 ms em `/api/patients?q=`; ao escolher, filtra por `patient_id`; "limpar" remove), `from`/`to` (data da solicitação) e `page`. Cada mudança refaz o `GET` com `URLSearchParams` (mesmo padrão `cancelled`-flag do `useEffect` de `GuidesTable`). Colunas: Nº, Tipo, Paciente, Operadora, Profissional, Solicitada em (`formatDate`), Status (badge), Nº na operadora. Linha clicável abre `AuthorizationEditSheet` (Tarefa 17) com o `id`; até a Tarefa 17 existir, deixar `selectedId` no estado e renderizar o sheet na Tarefa 17. Botão "Nova autorização" abre o diálogo. Paginação de 50 igual a `GuidesTable`.
- [ ] **16.3 Abertura por URL.** `initial.newType`+`initial.appointmentId` abrem o diálogo já preenchido ao montar; `initial.openId` abre o sheet daquela autorização. Depois de usar, limpar a query com `router.replace('/faturamento?tab=autorizacoes')` para não reabrir no refresh.
- [ ] **16.4 Diálogo de criação.** Campos: Tipo (SP/SADT ou Internação — OPME não aparece aqui; nasce do "Adicionar OPME" do pai). Com `defaults.appointmentId`: mostra "A partir do agendamento" e só o seletor de profissional (opcional; vazio = o servidor tenta o médico do agendamento). Sem agendamento: busca de paciente (mesma busca da tabela), operadora (lista das carteirinhas do paciente via `/api/billing/patients/{id}/insurances`, mostrando `nome — carteirinha`; se o paciente não tem carteirinha, permite escolher qualquer operadora de `insurers` e a carteirinha fica pendente), profissional. Enviar = `POST` com `{ type, appointment_id }` ou `{ type, patient_id, insurer_id, patient_insurance_id, professional_id }`; sucesso → `onCreated(id)` (a tabela recarrega e abre o sheet); erro → `friendlyErrorMessage`.
- [ ] **16.5 Ligar na página** (`AuthorizationsTable` na aba `autorizacoes`).
- [ ] **16.6 Verificar:** `npx tsc --noEmit`; `npx eslint components/billing/authorizations "app/(dashboard)/faturamento/page.tsx"`; `npx vitest run tests/nav tests/billing`.
- [ ] **16.7 Commit:**

```bash
git add components/billing/authorizations "app/(dashboard)/faturamento/page.tsx"
git commit -m "feat(tiss): lista de autorizações com filtros e criação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 17 — UI: sheet de edição (formulários por tipo, itens, OPME, resposta, histórico)

**Modelo sugerido:** sonnet

**Files:** criar `components/billing/authorizations/AuthorizationEditSheet.tsx`, `AuthorizationRequestFields.tsx`, `AuthorizationItemsEditor.tsx`, `AuthorizationResponseForm.tsx`, `AuthorizationTimeline.tsx`; modificar `AuthorizationsTable.tsx` (renderizar o sheet).

**Interfaces:**
- Consumes: todas as rotas das Tarefas 12–14; `ProcedureRow`-like da rota `/api/billing/insurers/[id]/procedures` (GET, membro); `formatCents`, `parseCents`, `centsToInput` (`components/billing/money.ts`); domínios/rótulos (Tarefa 6); `canCancel`, `canMarkSent`, `canRecordResponse`, `isEditable` (Tarefa 6); `AUTHORIZATION_SETTINGS_FIELDS`.
- Produces:

```tsx
export function AuthorizationEditSheet(props: {
  authorizationId: string | null
  role: MembershipRole
  insurers: InsurerOption[]
  onOpenChange: (open: boolean) => void
  onChanged: () => void                 // tabela recarrega
  onOpenAuthorization: (id: string) => void // navegar para pai/filho OPME
}): JSX.Element
export function AuthorizationRequestFields<T extends AuthorizationType>(props: {
  type: T; value: RequestDataByType[T]; editable: boolean; missing: Set<string>
  onChange: (next: RequestDataByType[T]) => void
}): JSX.Element
export function AuthorizationItemsEditor(props: {
  type: AuthorizationType; insurerId: string; items: AuthorizationItem[]; editable: boolean
  onSave: (items: AuthorizationItemInput[]) => Promise<void>
}): JSX.Element
export function AuthorizationResponseForm(props: {
  detail: AuthorizationDetail; role: MembershipRole
  onSubmit: (body: Omit<ResponseInput, 'expected_updated_at'>) => Promise<void>
}): JSX.Element
export function AuthorizationTimeline(props: { authorizationId: string; professionals: ProfessionalOption[]; refreshKey: number }): JSX.Element
```

Regras de comportamento:

- [ ] **17.1 Carga e concorrência.** O sheet faz `GET /api/billing/authorizations/{id}` ao abrir e após cada ação; toda mutação envia `expected_updated_at: detail.authorization.updated_at` **exatamente como veio** (string; nunca `new Date(...)`). Resposta 409 com a mensagem de conflito → mostra o erro e recarrega o detalhe.
- [ ] **17.2 Cabeçalho.** Tipo, "Nº {provider_guide_number}", badge, paciente, operadora, data da solicitação (editável em draft/ready via `requested_at`). Se `parent`: link "Guia de origem nº X" (`onOpenAuthorization`). Se SP/SADT/Internação: lista `children` (OPME) com badge e link; botão **"Adicionar OPME"** quando o pai não está `cancelled` → `POST { type: 'opme_request', parent_id }` → `onOpenAuthorization(novoId)`. Aviso informativo quando há 2+ OPME ativos: "Com mais de um anexo, nenhum vai embutido; envie cada OPME pelo próprio XML."
- [ ] **17.3 Pendências.** Lista `missing_fields` com `AUTHORIZATION_MISSING_LABELS`; campos de `AUTHORIZATION_SETTINGS_FIELDS` com link para `/configuracoes` (perfil/unidade) e o botão **"Recarregar dados"** (`PATCH { action: 'refresh' }`), só em draft/ready. Campo com pendência fica destacado como no `GuideEditSheet` (`border-amber-400 bg-amber-50`).
- [ ] **17.4 Beneficiário e profissional.** Carteirinha: seletor das carteirinhas do paciente na operadora (`patient_insurance_id`) ou digitação (`card_number`, até 20); "Atendimento a RN" (switch). Profissional: seletor de `/professionals` (`professional_id`), telefone (obrigatório no OPME; máscara livre, o servidor guarda só dígitos) e e-mail (até 60).
- [ ] **17.5 Pedido por tipo (`AuthorizationRequestFields`).** Selects alimentados pelos objetos de `domains.ts` (rótulo visível, código enviado). Textareas com contador e `maxLength` igual ao XSD: indicação clínica 500, observação 500 (SP/SADT, OPME) / 1000 (Internação), justificativa 1000, especificação 500. SP/SADT: caráter, indicação clínica, cobertura especial, guia principal, executante (opcional: código na operadora + CNES), etapa e "ausência do código de validação"/"código de validação" num bloco "Avançado" recolhido. Internação: hospital (código na operadora, nome, data sugerida), caráter, tipo, regime, diárias (1–99), previsão de OPME/quimio, indicação clínica, até 4 CIDs (aceita "K35.9"; o servidor normaliza), indicação de acidente, observação, bloco "Avançado". OPME: justificativa, especificação, observação. "Salvar" envia só o que mudou em `request` + campos do bloco 17.4 num único `PATCH`.
- [ ] **17.6 Itens (`AuthorizationItemsEditor`).** Linhas com tabela (`TABELA`), código, descrição, quantidade; para SP/SADT/Internação, "Adicionar do catálogo" lista os procedimentos TUSS da operadora (`/api/billing/insurers/{insurerId}/procedures`) e preenche tabela 22, código e descrição; OPME tem ainda opção de fabricante (1/2/3), valor unitário (`parseCents`/`centsToInput`), ANVISA (15), referência do fabricante (60) e AFE (30); tabela padrão 19 para OPME. Remover/reordenar linhas localmente; "Salvar itens" → `PUT …/items` com a lista inteira. Em leitura (não editável), mostra também quantidade/valor autorizados.
- [ ] **17.7 Ações.** "Baixar XML" (visível fora de draft): `fetch` do `GET …/xml`; se `ok`, cria `Blob`, lê o nome do `Content-Disposition` e dispara download; se 409/422, mostra `error` e a lista `errors` (já sem valores). "Marcar como enviada" (`canMarkSent`) e "Cancelar" (`canCancel(status, role)`) com `confirm()`; ambos `POST …/transitions`. Botões escondidos quando a regra do `status.ts` não permite.
- [ ] **17.8 Resposta (`AuthorizationResponseForm`).** Visível quando `status ∈ sent | under_review | pending_info` (formulário) e, em leitura, para qualquer status com `responded_at`. Campos: status da operadora (códigos 1–7 com rótulo de `STATUS_SOLICITACAO`; o "6 - Solicitação cancelada" só aparece para owner/admin), número da guia na operadora (20), senha (20), data da autorização, validade da senha, e por item a quantidade autorizada (0–999) — e o valor autorizado só em OPME. Envia `POST …/response`.
- [ ] **17.9 Histórico (`AuthorizationTimeline`).** `GET …/events`; lista em ordem com rótulo do evento (`created` "Criada", `updated` "Editada", `items_changed` "Itens alterados", `refreshed` "Dados recarregados", `ready` "Pronta para envio", `sent` "Marcada como enviada", `response_recorded` "Resposta registrada", `cancelled` "Cancelada", `xml_generated` "XML gerado"), transição `de → para` com `AUTHORIZATION_STATUS_LABELS`, data/hora em `America/Sao_Paulo` e autor (nome se `actor_id` estiver em `professionals`; senão "Equipe" — `profiles` é privado por RLS). Recarrega quando `refreshKey` muda.
- [ ] **17.10 Verificar:** `npx tsc --noEmit`; `npx eslint components/billing/authorizations`; `npx vitest run tests/billing tests/tiss tests/nav`. Smoke manual (Tarefa 19).
- [ ] **17.11 Commit:**

```bash
git add components/billing/authorizations
git commit -m "feat(tiss): edição de autorizações com itens, OPME, resposta e histórico

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 18 — Atalho no `AppointmentModal`

**Modelo sugerido:** haiku

**Files:** modificar `components/agenda/AppointmentModal.tsx`.

**Interfaces:**
- Consumes: `values.id`, `values.patient_id`, `values.billing?.insurer_id` (já existentes no formulário).
- Produces: links para `/faturamento?tab=autorizacoes&nova=<tipo>&appointment_id=<id>` (lidos pela página na Tarefa 15/16).

- [ ] **18.1** Na seção de convênio (dentro de `{billingMode && (…)}`, logo depois de `<AppointmentBillingFields … />`), quando `values.id && values.patient_id && values.billing?.insurer_id`, renderizar:

```tsx
<div className="flex flex-wrap items-center gap-2 pt-1">
  <span className="text-xs text-gray-400">Solicitar autorização:</span>
  <Link
    href={`/faturamento?tab=autorizacoes&nova=sp_sadt_request&appointment_id=${values.id}`}
    className="text-xs text-[var(--cyan-dark)] underline"
  >
    SP/SADT
  </Link>
  <Link
    href={`/faturamento?tab=autorizacoes&nova=hospitalization_request&appointment_id=${values.id}`}
    className="text-xs text-[var(--cyan-dark)] underline"
  >
    Internação
  </Link>
</div>
```

  com `import Link from 'next/link'`. Usa o agendamento **salvo** (convênio/paciente do banco); se o usuário mudou o convênio sem salvar, a criação usa o que está gravado — texto de ajuda: "Usa os dados já salvos do agendamento."
- [ ] **18.2 Verificar:** `npx tsc --noEmit`; `npx eslint components/agenda/AppointmentModal.tsx`; `npx vitest run tests/billing/appointments.test.ts`.
- [ ] **18.3 Commit:**

```bash
git add components/agenda/AppointmentModal.tsx
git commit -m "feat(tiss): atalho para solicitar autorização a partir do agendamento

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 19 — Verificação final e documentação

**Modelo sugerido:** sonnet

**Files:** modificar `docs/billing-tiss.md`.

- [ ] **19.1 Faturamento intocado (provas objetivas):**
  - `git diff dev -- supabase/billing.sql supabase/billing-authenticated.sql lib/billing/batches.ts lib/billing/guides.ts lib/tiss/v4_03_00/guide-consulta.ts lib/tiss/v4_03_00/guide-sp-sadt.ts lib/tiss/xml.ts lib/tiss/v4_03_00/hash.ts app/api/billing/guides app/api/billing/batches app/api/cron` → vazio.
  - `git diff dev -- supabase/schema.sql | grep '^-' | grep -v '^---'` → vazio (só inserções).
  - `git log --oneline dev..HEAD -- tests/tiss/golden` → só o commit da Tarefa 1.
- [ ] **19.2 Sem `any`:** `git diff dev --name-only -- '*.ts' '*.tsx' | xargs grep -nE ':\s*any\b|as any|<any>'` → vazio.
- [ ] **19.3 Tipos:** `npx tsc --noEmit`.
- [ ] **19.4 Lint só dos caminhos alterados** (o lint do repo inteiro estoura memória em worktree):

```bash
npx eslint lib/billing/authorizations lib/billing/tabs.ts lib/tiss/v4_03_00 lib/nav/tabs.ts \
  app/api/billing/authorizations "app/(dashboard)/faturamento/page.tsx" \
  components/billing/authorizations components/agenda/AppointmentModal.tsx next.config.ts \
  tests/billing tests/tiss tests/nav
```

- [ ] **19.5 Testes focados:** `npx vitest run tests/billing tests/tiss tests/nav`.
- [ ] **19.6 Suíte completa:** `npx vitest run --maxWorkers=2`; comparar com a linha de base da Tarefa 1 (as únicas diferenças aceitáveis são testes novos passando).
- [ ] **19.7 Build:** `npm run build`. Depois conferir que os XSDs entram no trace da rota de XML: `grep -l "tissV4_03_00.xsd" ".next/server/app/api/billing/authorizations/[id]/xml/route.js.nft.json"` (se o arquivo tiver outro nome, `find .next/server/app/api/billing/authorizations -name "*.nft.json"`). Se o build falhar só por download de fontes do Google no sandbox, registrar e repetir com rede.
- [ ] **19.8 Documentação:** em `docs/billing-tiss.md`, acrescentar seção "Autorizações (SP/SADT, Internação, OPME)":
  - instalação: rodar `supabase/tiss-authorizations.sql` no SQL Editor **depois** de `supabase/billing.sql` (dev e prod separadamente; idempotente; não mexe em dados existentes);
  - quem usa: qualquer membro com o módulo; cancelar após envio e registrar "6 - cancelada" só owner/admin;
  - fluxo: criar → completar pendências → "Baixar XML" → enviar pelo portal/webservice da operadora → "Marcar como enviada" → registrar resposta;
  - limites conhecidos (seção "Pontos do design" abaixo).
- [ ] **19.9 Smoke manual sugerido ao usuário (após aplicar o SQL no dev):** criar SP/SADT a partir de um agendamento de convênio; completar pendências; adicionar 2 itens; "Adicionar OPME" com 1 material; baixar o XML da SP/SADT (deve conter `anexoClinico`) e o do OPME (`ENVIO_ANEXO`); marcar enviada; registrar resposta 7 com quantidade autorizada; como member, tentar cancelar após envio (botão não aparece; API 403); conferir que `/faturamento` como member mostra só Autorizações e que gerar lote de guias continua igual.
- [ ] **19.10 Commit:**

```bash
git add docs/billing-tiss.md
git commit -m "docs(tiss): instalação e uso das autorizações TISS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Comandos de verificação, em ordem: `npx tsc --noEmit` → `npx eslint <caminhos>` → `npx vitest run tests/billing tests/tiss tests/nav` → `npx vitest run --maxWorkers=2` → `npm run build`.

---

## Pontos do design que esbarram no código (decididos no plano; revisar com o usuário)

Nenhuma decisão D1–D6 foi trocada. Onde o código atual impede a leitura literal, o plano escolheu o caminho abaixo:

1. **D4 — `next_tiss_number('guide')` exige `is_account_admin`** (versão do bloco authenticated). Como `member` cria autorizações, o RPC `create_tiss_authorization` incrementa `health_insurers.next_guide_number` **inline**, com o mesmo `select … for update` da linha da operadora — exatamente como `ensure_tiss_guide_for_appointment` já faz. Mesmo contador, sem alterar a função. Efeito: a sequência das guias de cobrança passa a ter "buracos" (números usados por autorizações), aceito pelo TISS.
2. **`billing` em `ADMIN_MIN_MODULES`.** Para o member ver o menu, `billing` sai dessa lista; Guias/Lotes ficam escondidos pela página e continuam bloqueados na API e na RLS. Limitação herdada: `billing` não está em `OVERRIDABLE_MODULES`, então um member **com** `module_overrides` não vê o menu (a API funciona). Se quiser controle por pessoa, incluir `billing` em `OVERRIDABLE_MODULES` (aparece um checkbox novo em Equipe) — fora deste plano.
3. **Resposta "6 - Solicitação cancelada".** D3 mapeia 6→`cancelled`, e a seção de permissões diz que cancelar após envio exige admin. O plano exige owner/admin também para registrar a resposta 6 (senão o member contornaria a regra).
4. **Estados terminais.** Por D3, `authorized`/`partially_authorized`/`denied` não têm saída: um erro de digitação na senha depois de "autorizada" não pode ser corrigido. Se for necessário, seria uma transição nova (ex.: `authorized → authorized` só para admin).
5. **OPME embutido incompleto.** D5 manda embutir quando há exatamente 1 OPME não cancelado; se esse OPME está em rascunho, o XML do pai é recusado (409 "Complete ou cancele o anexo") em vez de sair inválido ou sem o anexo. Marcar o pai como enviado **não** muda o status do OPME embutido (cada um tem seu ciclo); o usuário marca o OPME separadamente.
6. **Regras acrescentadas (não contradizem o design):** OPME não pode ser criado sob pai cancelado e herda o workspace do pai; o `payload` repete o `type` para o TypeScript estreitar (o RPC confere); `requested_at` é editável em draft/ready.
7. **`patient_id` com FK NO ACTION.** Apagar um paciente que tem autorização passa a falhar (antes não existia a tabela). É o comportamento desejado para auditoria, mas é uma mudança visível em `DELETE /api/patients/[id]` para esses pacientes.
8. **Profissionais listados a membros.** `tiss_authorization_professionals` expõe nome, CRM/UF/CBO, telefone e e-mail dos membros **com CRM** a qualquer membro da account com o módulo (necessário para escolher o solicitante do OPME). Membros sem CRM não aparecem. O histórico mostra o nome do autor só quando ele está nessa lista (profiles é privado).
9. **"transition: ready"** da ordem sugerida não vira rota: por D3, `draft`/`ready` são calculados por `missing_fields` a cada edição.
10. **Ambiguidades do XSD já documentadas na spec**, implementadas assim: `tipoTransacao` inferido (`SOLICITACAO_PROCEDIMENTOS`, `ENVIO_ANEXO`); tabela 19 como padrão de OPME; `numeroGuiaReferenciada` = número do prestador do pai; `valorSolicitado` tratado como unitário (como no formulário em papel).

