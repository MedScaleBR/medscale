# Configuração da Clara: dados da clínica nas páginas próprias — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar da tela da Clara os dados da clínica (serviços, convênios, dados por unidade) e editá-los em `/configuracoes/servicos`, `/configuracoes/convenios` e `/locais/[id]`, com a Clara lendo dessas fontes.

**Architecture:** Procedimentos/preços passam a vir só de `procedure_catalog`; convênios só de `health_insurers` (ANS/código do prestador ficam opcionais e só são exigidos com o módulo `billing`); dados por unidade continuam em `workspaces`, editados numa página de detalhe da unidade. O prompt da Clara recebe a lista de convênios e deriva os procedimentos do catálogo. A tela da Clara fica só com comportamento.

**Tech Stack:** Next.js 16 (App Router, `params` como Promise), React client components, Supabase (RLS), Vitest (+ PGlite nos testes de SQL), Tailwind/shadcn (Base UI).

**Spec:** `docs/superpowers/specs/2026-10-02-clara-config-split-design.md`

## Global Constraints

- Sem migração de dados: `bot_config.procedures`, `bot_config.insurance_plans` e `workspaces.consultation_price_from` ficam no banco sem leitura/escrita do app.
- Desvio aprovado do spec: em vez de `migration_convenios_sem_tiss.sql`, as alterações de `health_insurers` entram de forma idempotente em `supabase/billing.sql` (já é o arquivo de migração do faturamento, pendente em prod) e no `supabase/schema.sql`.
- `supabase/billing.sql` e `supabase/schema.sql` precisam **terminar exatamente** com o conteúdo de `supabase/billing-authenticated.sql` (teste `database.test.ts` checa isso) — qualquer edição na função `ensure_tiss_guide_for_appointment` é feita idêntica nos três.
- Mensagem de operadora incompleta, exata: `Complete o registro ANS e o código do prestador desta operadora em Convênios.`
- Páginas novas são owner/admin (member é redirecionado para `/configuracoes`), exceto `/locais/[id]`, que member vê em modo leitura.
- O working tree tem alterações do usuário não relacionadas: **nunca** use `git add -A`/`git add .`; adicione só os arquivos da task.
- Textos de UI em português, no tom dos existentes. Comentários em português, densidade igual ao arquivo vizinho.
- Rodar testes com `npx vitest run <arquivo>`; suíte completa com `npm test`.

## Review Focus

- Salvar a tela da Clara depois de editar Serviços/Convênios não pode apagar `payment_methods`, `pricing_info`, `exam_preparation` nem `accepts_private` — o form da Clara deixa de mandar esses campos (Task 10) e o `PATCH /api/bot/config` só grava o que veio (teste na Task 6).
- Conta com `billing` ativo e uma operadora cadastrada sem ANS/código (ex.: cadastrada antes de ativar o módulo): não gera guia (Task 1, SQL), não gera lote manual (Task 2, 400) nem automático (Task 2, cron ignora).
- Duas operadoras sem ANS na mesma conta são válidas; duas com o mesmo ANS continuam proibidas (Task 1).
- Em conta com várias unidades, o catálogo editado em Serviços grava na unidade escolhida no seletor, não na unidade ativa da sessão — as chamadas levam `?workspace_id=` (Task 8; verificação manual no fim).
- Procedimento com o mesmo nome em duas unidades aparece uma vez só em "Procedimentos realizados" (Task 5).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/billing.sql`, `supabase/schema.sql`, `supabase/billing-authenticated.sql` | ANS/código opcionais, unique parcial, guard na geração de guia |
| `types/database.ts` | Tipos de `health_insurers` |
| `lib/billing/insurer.ts` (novo) | `hasTissIdentity`, `TissIdentity`, `INCOMPLETE_INSURER_ERROR` |
| `lib/billing/guides.ts`, `lib/billing/batches.ts`, `app/api/billing/batches/route.ts`, `app/api/cron/tiss-batches/route.ts` | Só operadora completa vira guia/lote |
| `lib/billing/validation.ts`, `lib/billing/access.ts`, `app/api/billing/insurers/route.ts` | Cadastro de convênio sem o módulo billing |
| `app/(dashboard)/configuracoes/convenios/page.tsx`, `components/billing/InsurersSettings.tsx`, `components/billing/InsurerForm.tsx`, `components/configuracoes/AcceptsPrivateToggle.tsx` (novo) | UI de Convênios |
| `lib/bot/config.ts`, `lib/bot/prompt-builder.ts`, `lib/llm/agent.ts` | Clara lê convênios da tabela e procedimentos do catálogo |
| `app/api/bot/config/route.ts`, `app/(dashboard)/agenda/page.tsx` | Fim do uso de `insurance_plans`/`procedures` |
| `app/api/procedures/route.ts`, `app/api/procedures/[id]/route.ts` | Escrita do catálogo por owner/admin, sem módulo |
| `components/configuracoes/servicos/ProcedureCatalog.tsx` (novo), `components/configuracoes/servicos/ServicesClient.tsx` (novo), `app/(dashboard)/configuracoes/servicos/page.tsx` (novo) | Página Serviços |
| `components/configuracoes/RevenueSettingsClient.tsx`, `app/(dashboard)/configuracoes/receita/page.tsx` | Receita só com o fechamento diário |
| `lib/cep.ts` (novo), `components/locais/UnitDetailForm.tsx` (novo), `app/(dashboard)/locais/[id]/page.tsx` (novo), `components/locais/WorkspacesClient.tsx`, `app/(dashboard)/locais/page.tsx`, `app/api/workspaces/[id]/route.ts` | Página da unidade |
| `app/(dashboard)/configuracoes/bot/page.tsx`, `components/configuracoes/bot/BotConfigForm.tsx`, `components/configuracoes/bot/ClinicDataLinks.tsx` (novo), `components/configuracoes/bot/WorkspaceBotFields.tsx` (remover), `components/configuracoes/SettingsClient.tsx` | Tela da Clara e hub |

---

### Task 1: `health_insurers` com ANS e código do prestador opcionais (SQL + tipos)

**Files:**
- Modify: `supabase/billing.sql` (tabela em ~16-35; função `ensure_tiss_guide_for_appointment` no bloco final)
- Modify: `supabase/billing-authenticated.sql:69-70`
- Modify: `supabase/schema.sql` (tabela em ~585-604; função no bloco final ~2197)
- Modify: `types/database.ts:366-390`
- Test: `tests/billing/database.test.ts`

**Interfaces:**
- Produces: `Database['public']['Tables']['health_insurers']['Row']` com `ans_registry: string | null` e `provider_code: string | null`; `Insert` exige só `account_id` e `name`. A RPC `ensure_tiss_guide_for_appointment` devolve `{ status: 'skipped', reason: 'no_insurer' }` para operadora sem ANS ou sem código.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/billing/database.test.ts`, dentro do `describe('migração de faturamento em PostgreSQL com RLS real', ...)`, adicionar no fim:

```ts
  it('operadora sem registro ANS ou código do prestador não gera guia', async () => {
    await db.exec(`update public.health_insurers set ans_registry = null, provider_code = null`)
    await asUser(ids.member)
    expect(await ensure()).toEqual({ status: 'skipped', reason: 'no_insurer' })
  })

  it('aceita várias operadoras sem ANS na mesma conta, mas não duas com o mesmo ANS', async () => {
    await db.exec(`insert into public.health_insurers (account_id, name) values ('${ids.account}', 'Unimed'), ('${ids.account}', 'Bradesco')`)
    await expect(
      db.exec(`insert into public.health_insurers (account_id, name, ans_registry, provider_code) values ('${ids.account}', 'Duplicada', '999999', 'X')`),
    ).rejects.toThrow()
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/billing/database.test.ts`
Expected: os dois testes novos FAIL (`null value in column "ans_registry"` / not-null violation).

- [ ] **Step 3: Ajustar a definição da tabela em `supabase/billing.sql` e `supabase/schema.sql`**

Nos dois arquivos, no `create table ... public.health_insurers`, trocar:

```sql
  ans_registry          text not null check (ans_registry ~ '^\d{6}$'),
  provider_code         text not null,           -- código do prestador na operadora
```
por:
```sql
  -- ANS e código do prestador só existem com o módulo billing: sem ele o
  -- convênio é só o nome que a Clara informa ao paciente.
  ans_registry          text check (ans_registry ~ '^\d{6}$'),
  provider_code         text,                    -- código do prestador na operadora
```
e remover a linha `unique (account_id, ans_registry)` junto com a vírgula final da linha anterior (`updated_at ... default now(),` → `updated_at ... default now()`).

Logo depois do `);` que fecha a tabela, nos dois arquivos, adicionar:

```sql
create unique index if not exists health_insurers_account_ans_unique
  on public.health_insurers (account_id, ans_registry) where ans_registry is not null;
```

Só em `supabase/billing.sql` (é reexecutado sobre bancos que já têm a tabela), logo antes desse `create unique index`, adicionar:

```sql
-- Bancos criados antes de ANS/código ficarem opcionais.
alter table public.health_insurers alter column ans_registry drop not null;
alter table public.health_insurers alter column provider_code drop not null;
alter table public.health_insurers drop constraint if exists health_insurers_account_id_ans_registry_key;
```

- [ ] **Step 4: Guard na função de geração de guia (três arquivos, texto idêntico)**

Em `supabase/billing-authenticated.sql`, no `ensure_tiss_guide_for_appointment`, logo depois de:
```sql
  if not found then return jsonb_build_object('status', 'skipped', 'reason', 'no_insurer'); end if;
```
adicionar:
```sql
  if i.ans_registry is null or i.provider_code is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'no_insurer');
  end if;
```
Fazer exatamente a mesma inserção na cópia da função no fim de `supabase/billing.sql` e no fim de `supabase/schema.sql` (procure a mesma linha `'no_insurer'`; existe uma ocorrência no bloco final de cada arquivo).

- [ ] **Step 5: Tipos**

Em `types/database.ts`, `health_insurers`:
```ts
          ans_registry: string | null
          provider_code: string | null
```
e o `Insert`:
```ts
        Insert: Partial<Database['public']['Tables']['health_insurers']['Row']> & {
          account_id: string
          name: string
        }
```

- [ ] **Step 6: Rodar os testes**

Run: `npx vitest run tests/billing/database.test.ts`
Expected: PASS em todos (inclusive "é idempotente e mantém o bloco de autorização igual").

- [ ] **Step 7: Commit**

```bash
git add supabase/billing.sql supabase/billing-authenticated.sql supabase/schema.sql types/database.ts tests/billing/database.test.ts
git commit -m "feat(billing): registro ANS e codigo do prestador opcionais em health_insurers"
```
(`npx tsc --noEmit` ainda vai acusar erros em `lib/billing/*` — resolvidos na Task 2.)

---

### Task 2: Só operadora com ANS e código vira guia ou lote

**Files:**
- Create: `lib/billing/insurer.ts`
- Modify: `lib/billing/guides.ts:16-30` (tipo `GuideSources.insurer`), `lib/billing/guides.ts:251`
- Modify: `lib/billing/batches.ts:53-57, 89-91`
- Modify: `app/api/billing/batches/route.ts:47-53`
- Modify: `app/api/cron/tiss-batches/route.ts:69`
- Test: `tests/billing/insurer.test.ts` (novo), `tests/billing/api.test.ts`

**Interfaces:**
- Consumes: tipos da Task 1.
- Produces:
  ```ts
  export type TissIdentity = { ans_registry: string; provider_code: string }
  export function hasTissIdentity<T extends { ans_registry: string | null; provider_code: string | null }>(insurer: T): insurer is T & TissIdentity
  export const INCOMPLETE_INSURER_ERROR: string
  ```
  `createBatchesForInsurer(supabase, insurer: Pick<InsurerRow, 'id' | 'account_id' | 'tiss_version' | 'max_guides_per_batch'> & TissIdentity, options)`.

- [ ] **Step 1: Testes que falham**

`tests/billing/insurer.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { hasTissIdentity } from '@/lib/billing/insurer'

describe('hasTissIdentity', () => {
  it('exige registro ANS e código do prestador preenchidos', () => {
    expect(hasTissIdentity({ ans_registry: '123456', provider_code: 'P1' })).toBe(true)
    expect(hasTissIdentity({ ans_registry: null, provider_code: 'P1' })).toBe(false)
    expect(hasTissIdentity({ ans_registry: '123456', provider_code: null })).toBe(false)
    expect(hasTissIdentity({ ans_registry: '', provider_code: '' })).toBe(false)
  })
})
```

Em `tests/billing/api.test.ts`, no `describe('lotes')`:
- No teste existente `'"Gerar lote agora" usa a operadora da account e registra o autor'`, trocar o mock da operadora por `{ id: 'ins1', account_id: 'acc1', tiss_version: '4.03.00', ans_registry: '999999', provider_code: 'P1' }`.
- Adicionar:
```ts
  it('"Gerar lote agora" recusa operadora sem registro ANS', async () => {
    g.createBatches.mockClear()
    setup({ health_insurers: { select: { data: { id: 'ins1', account_id: 'acc1', tiss_version: '4.03.00', ans_registry: null, provider_code: null } } } })

    const res = await generateBatch(req('/api/billing/batches', json({ insurer_id: 'ins1' })))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Complete o registro ANS e o código do prestador desta operadora em Convênios.')
    expect(g.createBatches).not.toHaveBeenCalled()
  })
```
No `describe('cron /api/cron/tiss-batches')`, adicionar:
```ts
  it('ignora operadora sem registro ANS no horário do lote', async () => {
    g.createBatches.mockClear()
    setup({
      accounts: { select: { data: [{ id: 'acc1' }] } },
      appointments: { select: { data: [] } },
      health_insurers: { select: { data: [{ ...insurer, ans_registry: null }] } },
      tiss_batches: { select: { data: [] } },
    })

    const res = await cron(cronReq())

    expect(res.status).toBe(200)
    expect(g.createBatches).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/billing/insurer.test.ts tests/billing/api.test.ts`
Expected: FAIL — módulo `@/lib/billing/insurer` não existe; o teste do lote recebe 200; o cron chama `createBatches`.

- [ ] **Step 3: Implementar o helper**

`lib/billing/insurer.ts`:
```ts
// Operadora pronta para TISS: tem registro ANS e código do prestador. Sem o
// módulo billing a conta cadastra só o nome do convênio (para a Clara), e
// essas operadoras nunca podem chegar a uma guia ou lote.
export type TissIdentity = { ans_registry: string; provider_code: string }

export function hasTissIdentity<T extends { ans_registry: string | null; provider_code: string | null }>(
  insurer: T,
): insurer is T & TissIdentity {
  return Boolean(insurer.ans_registry && insurer.provider_code)
}

export const INCOMPLETE_INSURER_ERROR =
  'Complete o registro ANS e o código do prestador desta operadora em Convênios.'
```

- [ ] **Step 4: Aplicar nos pontos de faturamento**

`app/api/billing/batches/route.ts`, logo após `if (!insurer) return NextResponse.json({ error: 'Operadora não encontrada' }, { status: 404 })`:
```ts
  if (!hasTissIdentity(insurer)) return NextResponse.json({ error: INCOMPLETE_INSURER_ERROR }, { status: 400 })
```
(import `{ hasTissIdentity, INCOMPLETE_INSURER_ERROR } from '@/lib/billing/insurer'`).

`app/api/cron/tiss-batches/route.ts:69`:
```ts
  const due = (insurers ?? []).filter(hasTissIdentity).filter((i) => isBatchDue(i, now))
```

`lib/billing/batches.ts`: importar `type TissIdentity` de `./insurer` e trocar as assinaturas:
```ts
  insurer: Pick<InsurerRow, 'id' | 'account_id' | 'tiss_version' | 'max_guides_per_batch'> & TissIdentity,
```
(em `createBatchesForInsurer`) e
```ts
  insurer: Pick<InsurerRow, 'id' | 'account_id'> & TissIdentity,
```
(em `createOneBatch`).

`lib/billing/guides.ts`: no `GuideSources`, o campo `insurer` passa a ser `Pick<InsurerRow, 'tiss_version' | 'default_consult_guide'> & TissIdentity` (import de `./insurer`). Na linha 251:
```ts
  // Operadora sem ANS/código (convênio cadastrado só para a Clara) não vira guia.
  if (!insurer || !workspace || !hasTissIdentity(insurer)) return null
```

- [ ] **Step 5: Rodar testes e checagem de tipos**

Run: `npx vitest run tests/billing` e `npx tsc --noEmit`
Expected: testes PASS. O `tsc` não deve acusar nada em `lib/billing/*` nem nas rotas de billing. Se acusar `InsurerRow` com `string | null` em `components/billing/*`, deixe — a Task 4 resolve. Qualquer outro erro em código de faturamento: corrija com `hasTissIdentity` antes de usar `ans_registry`/`provider_code`.

- [ ] **Step 6: Commit**

```bash
git add lib/billing/insurer.ts lib/billing/guides.ts lib/billing/batches.ts app/api/billing/batches/route.ts app/api/cron/tiss-batches/route.ts tests/billing/insurer.test.ts tests/billing/api.test.ts
git commit -m "feat(billing): operadora sem ANS ou codigo do prestador nao gera guia nem lote"
```

---

### Task 3: Cadastro de convênio sem o módulo billing (API)

**Files:**
- Modify: `lib/billing/validation.ts:13-45` (`parseInsurerInput`)
- Modify: `lib/billing/access.ts` (novo `requireInsurerAccess`)
- Modify: `app/api/billing/insurers/route.ts` (GET/POST/PATCH)
- Test: `tests/billing/batches.test.ts` (`describe('validação de entrada')`), `tests/billing/api.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function parseInsurerInput(body: Record<string, unknown>, partial: boolean, opts: { tiss: boolean }): Result<InsurerInput>
  export async function requireInsurerAccess(req: NextRequest, opts: { adminOnly: boolean }):
    Promise<{ session: ApiSession; billingEnabled: boolean } | { error: NextResponse }>
  ```

- [ ] **Step 1: Testes que falham**

Em `tests/billing/batches.test.ts`, `describe('validação de entrada')`: acrescentar `{ tiss: true }` como terceiro argumento em todas as chamadas existentes de `parseInsurerInput`, e adicionar:
```ts
  it('sem o módulo billing aceita só nome e ativo, ignorando campos TISS', () => {
    expect(parseInsurerInput({ name: ' Unimed ', ans_registry: '12', batch_hour: 99, is_active: true }, false, { tiss: false })).toEqual({
      ok: true,
      value: { name: 'Unimed', is_active: true },
    })
  })

  it('com o módulo billing continua exigindo registro ANS no cadastro', () => {
    expect(parseInsurerInput({ name: 'Unimed' }, false, { tiss: true })).toEqual({
      ok: false,
      error: 'Registro ANS deve ter exatamente 6 dígitos.',
    })
  })
```

Em `tests/billing/api.test.ts`, `describe('acesso às rotas /api/billing')`, substituir o teste `'deve responder 403 com o módulo billing inativo na account'` por:
```ts
  it('sem o módulo billing, guias dão 403 mas convênios continuam acessíveis', async () => {
    setup({ accounts: { select: { data: { modules: ['agenda'] } } }, health_insurers: { select: { data: [] } } })
    expect((await listInsurers(req('/api/billing/insurers'))).status).toBe(200)
    expect((await listGuides(req('/api/billing/guides'))).status).toBe(403)
  })

  it('sem o módulo billing, cadastra convênio só com o nome', async () => {
    setup({
      accounts: { select: { data: { modules: ['agenda'] } } },
      health_insurers: { insert: { data: { id: 'ins1', name: 'Unimed' } } },
    })

    const res = await createInsurer(req('/api/billing/insurers', json({ name: 'Unimed', ans_registry: '12' })))

    expect(res.status).toBe(201)
    const [call] = g.supabase.callsTo('health_insurers', 'insert')
    expect(call.payload).toEqual({ name: 'Unimed', account_id: 'acc1' })
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/billing/batches.test.ts tests/billing/api.test.ts`
Expected: FAIL (convênios dão 403 sem billing; o parse sem TISS devolve erro de ANS).

- [ ] **Step 3: `parseInsurerInput`**

Em `lib/billing/validation.ts`, trocar o começo da função por:
```ts
// Campos de um convênio sem o módulo billing — é só o nome que a Clara informa.
const BASIC_INSURER_FIELDS = ['name', 'is_active']

export function parseInsurerInput(
  body: Record<string, unknown>,
  partial: boolean,
  { tiss }: { tiss: boolean },
): Result<InsurerInput> {
  if (!tiss) body = Object.fromEntries(Object.entries(body).filter(([k]) => BASIC_INSURER_FIELDS.includes(k)))
  const out: InsurerInput = {}
  const has = (k: string) => (!partial && (tiss || BASIC_INSURER_FIELDS.includes(k))) || k in body
```
(o resto da função fica igual).

- [ ] **Step 4: `requireInsurerAccess`**

Em `lib/billing/access.ts`, adicionar:
```ts
// Cadastro de convênios (/api/billing/insurers) vale para qualquer account:
// sem o módulo billing o convênio é só o nome que a Clara informa. Devolve se
// o módulo está ativo para a rota decidir se exige os campos TISS.
export async function requireInsurerAccess(
  req: NextRequest,
  { adminOnly }: { adminOnly: boolean },
): Promise<{ session: ApiSession; billingEnabled: boolean } | { error: NextResponse }> {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result
  const { session } = result

  if (adminOnly) {
    const denied = requireRole(session, ['owner', 'admin'])
    if (denied) return { error: denied }
  }

  const supabase = await createClient()
  const { data: account } = await supabase.from('accounts').select('modules').eq('id', session.accountId).maybeSingle()
  return { session, billingEnabled: Boolean(account?.modules?.includes('billing')) }
}
```

- [ ] **Step 5: Rota de operadoras**

Em `app/api/billing/insurers/route.ts`: trocar o import de `requireBilling` por `requireInsurerAccess`. Em GET: `const result = await requireInsurerAccess(req, { adminOnly: false })`. Em POST e PATCH: `const result = await requireInsurerAccess(req, { adminOnly: true })`, `const { session, billingEnabled } = result`, e as chamadas viram `parseInsurerInput(body, false, { tiss: billingEnabled })` / `parseInsurerInput(body, true, { tiss: billingEnabled })`. Atualizar o comentário do topo do GET: "Qualquer membro: convênios ativos (seletor da agenda)…". As rotas `app/api/billing/insurers/[id]/procedures` continuam com `requireBilling`.

- [ ] **Step 6: Rodar os testes**

Run: `npx vitest run tests/billing`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/billing/validation.ts lib/billing/access.ts app/api/billing/insurers/route.ts tests/billing/batches.test.ts tests/billing/api.test.ts
git commit -m "feat(billing): cadastro de convenio sem o modulo de faturamento"
```

---

### Task 4: Página Convênios para todas as contas

**Files:**
- Create: `components/configuracoes/AcceptsPrivateToggle.tsx`
- Modify: `components/billing/InsurerForm.tsx`
- Modify: `components/billing/InsurersSettings.tsx`
- Modify: `app/(dashboard)/configuracoes/convenios/page.tsx`

**Interfaces:**
- Consumes: `POST/PATCH /api/billing/insurers` da Task 3; `PATCH /api/bot/config` aceita `accepts_private`.
- Produces: `InsurerRow` com `ans_registry: string | null`, `provider_code: string | null`; `InsurersSettings` e `InsurerForm` recebem `billingEnabled: boolean`.

- [ ] **Step 1: `AcceptsPrivateToggle`**

```tsx
'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { friendlyErrorMessage } from '@/lib/friendly-errors'

// "Aceita particular" é da conta inteira (bot_config) — a Clara usa junto com
// a lista de convênios. Salva na hora, sem botão.
export function AcceptsPrivateToggle({ initialValue }: { initialValue: boolean }) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)

  const toggle = async (next: boolean) => {
    setValue(next)
    setError(null)
    const res = await fetch('/api/bot/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accepts_private: next }),
    })
    if (!res.ok) {
      setValue(!next)
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Erro ao salvar.')
    }
  }

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
      <label className="flex items-center justify-between gap-4">
        <div>
          <span className="text-sm font-medium text-gray-900">Aceita consultas particulares</span>
          <p className="mt-0.5 text-xs text-gray-400">A Clara informa ao paciente junto com os convênios abaixo.</p>
        </div>
        <Switch checked={value} onCheckedChange={toggle} />
      </label>
      {error && (
        <p className="mt-2 text-xs text-red-600">
          {friendlyErrorMessage(error, 'Não foi possível salvar esta alteração. Tente novamente.')}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `InsurerForm` ciente do módulo**

- `InsurerRow`: `ans_registry: string | null` e `provider_code: string | null`.
- `InsurerForm` e `InsurerFormBody` ganham a prop `billingEnabled: boolean` (repassada de um para o outro).
- Estado inicial: `useState(insurer ? { ...insurer, ans_registry: insurer.ans_registry ?? '', provider_code: insurer.provider_code ?? '' } : EMPTY)`.
- No `save`, o body vira:
```ts
        body: JSON.stringify({
          ...(insurer ? { id: insurer.id } : {}),
          name: form.name,
          is_active: form.is_active,
          ...(billingEnabled
            ? {
                ans_registry: form.ans_registry,
                provider_code: form.provider_code,
                tiss_version: form.tiss_version,
                default_consult_guide: form.default_consult_guide,
                batch_weekdays: form.batch_weekdays,
                batch_hour: form.batch_hour,
                max_guides_per_batch: form.max_guides_per_batch,
              }
            : {}),
        }),
```
- No JSX, envolver tudo entre o campo "Nome da operadora" e o `<label>` "Ativa" (ANS/código, versão/guia, fechamento do lote, hora/máx. guias) em `{billingEnabled && (<>…</>)}`. O label do nome passa a ser `{billingEnabled ? 'Nome da operadora' : 'Nome do convênio'}`.

- [ ] **Step 3: `InsurersSettings` ciente do módulo**

- Nova prop `billingEnabled: boolean`; repassar ao `<InsurerForm … billingEnabled={billingEnabled} />`.
- Descrição do card: `{billingEnabled ? 'Registro ANS, código do prestador, tabela de procedimentos e horário do lote de cada convênio.' : 'Convênios que a clínica atende — a Clara informa ao paciente.'}`; título `{billingEnabled ? 'Operadoras' : 'Convênios aceitos'}`.
- Na linha de cada convênio: o `<span>` com "ANS … TISS …" só renderiza quando `billingEnabled && i.ans_registry && i.provider_code`. Quando `billingEnabled && !(i.ans_registry && i.provider_code)`, renderizar no lugar:
```tsx
<Badge className="border-none bg-amber-50 text-amber-700">Falta ANS/código do prestador</Badge>
```
- Sem `billingEnabled`, a linha não expande: o botão do nome não mostra chevron nem alterna `expanded`, e o bloco `<ProcedureTable>` não renderiza (`{billingEnabled && open && …}`).
- O card "Dados do prestador" (`ProviderFields`) só renderiza com `billingEnabled`.

- [ ] **Step 4: Página**

`app/(dashboard)/configuracoes/convenios/page.tsx`:
- Gate: trocar a condição por `if (session.role === 'member') redirect('/configuracoes')` e o comentário por "Convênios: owner/admin. Sem o módulo billing é só a lista que a Clara informa; com ele, entram os dados TISS."
- `const billingEnabled = session.accountModules.includes('billing')`.
- Adicionar ao `Promise.all`: `supabase.from('bot_config').select('accepts_private').eq('account_id', session.accountId).maybeSingle()`.
- Subtítulo: `{billingEnabled ? 'Operadoras, tabela TUSS e dados do prestador para o faturamento TISS.' : 'Convênios aceitos e atendimento particular — a Clara usa estas informações com o paciente.'}`.
- Renderizar `<AcceptsPrivateToggle initialValue={botConfig?.accepts_private ?? true} />` antes de `<InsurersSettings … billingEnabled={billingEnabled} />`.

- [ ] **Step 5: Tipos e lint dos arquivos**

Run: `npx tsc --noEmit` e `npx eslint components/billing components/configuracoes/AcceptsPrivateToggle.tsx "app/(dashboard)/configuracoes/convenios"`
Expected: sem erros nesses arquivos.

- [ ] **Step 6: Commit**

```bash
git add components/configuracoes/AcceptsPrivateToggle.tsx components/billing/InsurerForm.tsx components/billing/InsurersSettings.tsx "app/(dashboard)/configuracoes/convenios/page.tsx"
git commit -m "feat(convenios): pagina de convenios para todas as contas, com particular"
```

---

### Task 5: Clara lê convênios da tabela e procedimentos do catálogo

**Files:**
- Modify: `lib/bot/config.ts`
- Modify: `lib/bot/prompt-builder.ts:43-160`
- Modify: `lib/llm/agent.ts:392-430, 566-567`
- Modify: `tests/helpers/agent-harness.ts`, `tests/agent/prompt-builder.test.ts`, `tests/agent/security.test.ts`, `tests/agent/config.test.ts`, `tests/agent/context.test.ts`

**Interfaces:**
- Produces: `BotConfig` sem `procedures`/`insurancePlans`; `UnitContext` sem `consultationPriceFrom`; `buildDynamicSystemPrompt` recebe `insurancePlans: string[]` (obrigatório).

- [ ] **Step 1: Ajustar fixtures e escrever os testes que falham**

`tests/helpers/agent-harness.ts`: remover `consultationPriceFrom: null` de `UNIT` e `procedures: []`, `insurancePlans: []` de `DEFAULT_BOT_CONFIG`; em `defaultSupabaseConfig()` adicionar `health_insurers: { select: { data: [] } },`.

`tests/agent/security.test.ts`: remover `procedures: []` e `insurancePlans: []` do `BotConfig` base.

`tests/agent/config.test.ts`: remover `procedures`/`insurance_plans` de `ROW`, `procedures`/`insurancePlans` do `toMatchObject` do mapeamento, e no teste de nulos trocar para `{ ...ROW, payment_methods: null, faq: null }` com `expect(config).toMatchObject({ paymentMethods: [], faq: [] })`.

`tests/agent/prompt-builder.test.ts`:
- `BASE`: remover `procedures` e `insurancePlans`. `UNIT`: remover `consultationPriceFrom`.
- `build()`: adicionar `insurancePlans: [],` antes de `...overrides`.
- Reescrever o `describe('buildDynamicSystemPrompt — convênios e valores')`:
```ts
describe('buildDynamicSystemPrompt — convênios e valores', () => {
  it('deve informar atendimento só particular quando não há convênios', () => {
    expect(build({ acceptsPrivate: true })).toContain('Atendimento apenas particular')
  })

  it('deve listar os convênios e mencionar particular quando aceita os dois', () => {
    const prompt = build({ acceptsPrivate: true }, { insurancePlans: ['Unimed', 'Bradesco'] })
    expect(prompt).toContain('Convênios aceitos: Unimed, Bradesco')
    expect(prompt).toContain('Também atende particular')
  })

  it('deve dizer que não atende particular quando só aceita convênio', () => {
    expect(build({ acceptsPrivate: false }, { insurancePlans: ['Unimed'] })).toContain('Não atende particular')
  })

  it('deve mandar consultar a equipe quando não há convênio nem particular', () => {
    expect(build({ acceptsPrivate: false })).toContain('Consulte a equipe')
  })

  it('não deve inventar preço quando não há catálogo', () => {
    const prompt = build()
    expect(prompt).toContain('a equipe entrará em contato')
    expect(prompt).not.toContain('R$')
  })

  it('com catálogo, manda usar só os valores da tabela', () => {
    const prompt = build({}, { procedureCatalogByUnit: { w1: [{ id: 'p1', name: 'Consulta', price: 300 }] } })
    expect(prompt).toContain('R$300')
    expect(prompt).toContain('Valores: informe só os da tabela')
  })
})

describe('buildDynamicSystemPrompt — procedimentos', () => {
  it('deve listar os procedimentos do catálogo das unidades, sem repetir', () => {
    const prompt = build(
      {},
      {
        units: [UNIT, { ...UNIT, id: 'w2', name: 'Unidade 2' }],
        procedureCatalogByUnit: {
          w1: [{ id: 'p1', name: 'Consulta', price: 300 }],
          w2: [
            { id: 'p2', name: 'Consulta', price: 350 },
            { id: 'p3', name: 'Infiltração', price: 500 },
          ],
        },
      },
    )
    expect(prompt).toContain('Procedimentos realizados: Consulta, Infiltração')
  })

  it('sem catálogo, fala em consultas gerais', () => {
    expect(build()).toContain('Procedimentos realizados: consultas gerais')
  })
})
```

`tests/agent/context.test.ts`: adicionar (no `describe` principal, que já tem `beforeEach` com `resetAgentHarness`):
```ts
  it('deve informar à Clara os convênios ativos cadastrados em Convênios', async () => {
    const supabase = mergeSupabaseConfig({ health_insurers: { select: { data: [{ name: 'Unimed' }] } } })

    await processIncomingMessage(PARAMS)

    expect(systemPrompt()).toContain('Convênios aceitos: Unimed')
    const [call] = supabase.callsTo('health_insurers', 'select')
    expect(call.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'account_id', PARAMS.accountId],
        ['eq', 'is_active', true],
      ]),
    )
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/agent`
Expected: FAIL (tipos com campos sobrando/faltando, "Procedimentos realizados: consultas gerais" com catálogo, convênios não chegam ao prompt).

- [ ] **Step 3: `lib/bot/config.ts`**

- `BotConfig`: remover `procedures` e `insurancePlans`; no `getBotConfig` remover as duas linhas do mapeamento.
- Comentário do topo: "Configuração da Clara — uma por account… Procedimentos vêm do catálogo (procedure_catalog) e convênios de health_insurers, carregados no agente."
- `UnitContext`: remover `consultationPriceFrom`; em `getAccountUnits`, tirar `consultation_price_from` do `select` e do mapeamento.

- [ ] **Step 4: `lib/bot/prompt-builder.ts`**

- `UnitInfo`: remover `consultationPriceFrom`.
- `BuildPromptInput`: adicionar
```ts
  // Convênios ativos da account (health_insurers) — a Clara só informa estes.
  insurancePlans: string[]
```
e incluir `insurancePlans` na desestruturação de `buildDynamicSystemPrompt`.
- Trocar o bloco de procedimentos:
```ts
  // ── Procedimentos (nomes do catálogo das unidades, sem repetir) ─────────────
  const procedureNames = [
    ...new Set(units.flatMap((u) => (procedureCatalogByUnit[u.id] ?? []).map((p) => p.name))),
  ]
  const proceduresText = procedureNames.length > 0 ? procedureNames.join(', ') : 'consultas gerais'
```
- No bloco de convênios, `config.insurancePlans` → `insurancePlans` (quatro ocorrências).
- No `unitsSection`, remover a linha `u.consultationPriceFrom ? … : null,`.
- Trocar o bloco "Preço (quando há uma unidade só, ou preço uniforme)" inteiro por:
```ts
  // ── Preço: só o que está no catálogo ─────────────────────────────────────
  const priceText =
    procedureNames.length > 0
      ? 'Valores: informe só os da tabela "Procedimentos e valores" abaixo.'
      : 'Para informações sobre valores, informe que a equipe entrará em contato.'
```

- [ ] **Step 5: `lib/llm/agent.ts`**

Depois do bloco 6.6 (catálogo), adicionar:
```ts
  // 6.7. Convênios aceitos — os ativos cadastrados em Convênios.
  const { data: insurerRows } = await supabase
    .from('health_insurers')
    .select('name')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('name', { ascending: true })
  const insurancePlans = (insurerRows ?? []).map((i) => i.name)
```
No `buildDynamicSystemPrompt({...})`: remover `consultationPriceFrom: u.consultationPriceFrom,` do map de unidades e passar `insurancePlans,`. Na linha 566-567:
```ts
      const snapshotPrice = resolvedProcedure?.price ?? null
```

- [ ] **Step 6: Rodar os testes**

Run: `npx vitest run tests/agent tests/waitlist tests/webhook`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/bot/config.ts lib/bot/prompt-builder.ts lib/llm/agent.ts tests/helpers/agent-harness.ts tests/agent/prompt-builder.test.ts tests/agent/security.test.ts tests/agent/config.test.ts tests/agent/context.test.ts
git commit -m "feat(clara): convenios de health_insurers e procedimentos do catalogo no prompt"
```

---

### Task 6: Fim de `insurance_plans`/`procedures` na API da Clara e na agenda

**Files:**
- Modify: `app/api/bot/config/route.ts:7-25`
- Modify: `app/(dashboard)/agenda/page.tsx:47-65`
- Modify (só comentários): `lib/revenue/cycle.ts:237`, `app/api/appointments/route.ts:64`, `app/api/appointments/[id]/route.ts:62`
- Test: `tests/bot/config-route.test.ts` (novo)

**Interfaces:**
- Consumes: nada novo.
- Produces: `PATCH /api/bot/config` ignora `procedures` e `insurance_plans`; só grava as chaves presentes no body.

- [ ] **Step 1: Teste que falha**

`tests/bot/config-route.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/session/api', () => ({
  requireWorkspaceSession: async () => ({
    session: { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner', modules: [] },
  }),
  requireRole: () => null,
}))

import { PATCH } from '@/app/api/bot/config/route'

const patch = (body: unknown) =>
  PATCH(
    new NextRequest('https://app.test/api/bot/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

describe('PATCH /api/bot/config', () => {
  beforeEach(() => {
    g.supabase = createSupabaseMock({ bot_config: { upsert: { data: { account_id: 'acc1' } } } })
  })

  it('ignora procedures e insurance_plans e só grava o que veio', async () => {
    const res = await patch({ procedures: ['x'], insurance_plans: ['Unimed'], tone_of_voice: 'Calma' })

    expect(res.status).toBe(200)
    const [call] = g.supabase.callsTo('bot_config', 'upsert')
    expect(call.payload).toEqual({ tone_of_voice: 'Calma', account_id: 'acc1' })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/bot/config-route.test.ts`
Expected: FAIL — o payload contém `procedures` e `insurance_plans`.

- [ ] **Step 3: Implementar**

Em `app/api/bot/config/route.ts`, remover `'procedures'` e `'insurance_plans'` de `EDITABLE_FIELDS` e atualizar o comentário: "…Procedimentos ficam no catálogo (procedure_catalog) e convênios em health_insurers."

Em `app/(dashboard)/agenda/page.tsx`, substituir os blocos "Convênios atendidos" e "Faturamento TISS" (linhas 47-65) por:
```ts
  // Convênios aceitos (seletor "Atendimento" do modal) — os ativos cadastrados
  // em Convênios. Com o módulo billing, o modal usa as operadoras (com id).
  const { data: insurerRows } = await supabase
    .from('health_insurers')
    .select('id, name')
    .eq('account_id', session.accountId)
    .eq('is_active', true)
    .order('name')
  const healthPlans = (insurerRows ?? []).map((i) => i.name)
  const billingInsurers = session.accountModules.includes('billing') ? (insurerRows ?? []) : []
```
e no JSX `billingInsurers={billingInsurers}`.

Nos três comentários listados, trocar `(bot_config.insurance_plans)` por `(nome de um convênio de health_insurers)`.

- [ ] **Step 4: Rodar testes**

Run: `npx vitest run tests/bot tests/billing tests/revenue` e `npx tsc --noEmit`
Expected: PASS; `tsc` sem erros novos nesses arquivos.

- [ ] **Step 5: Commit**

```bash
git add app/api/bot/config/route.ts "app/(dashboard)/agenda/page.tsx" lib/revenue/cycle.ts app/api/appointments/route.ts "app/api/appointments/[id]/route.ts" tests/bot/config-route.test.ts
git commit -m "refactor(clara): agenda e config da Clara deixam de usar a lista antiga de convenios"
```

---

### Task 7: Catálogo editável por owner/admin, sem depender do módulo de receita

**Files:**
- Modify: `app/api/procedures/route.ts:5-40`
- Modify: `app/api/procedures/[id]/route.ts:8-23`
- Test: `tests/revenue/procedures-api.test.ts` (novo)

**Interfaces:**
- Produces: `POST /api/procedures`, `PATCH|DELETE /api/procedures/[id]` exigem owner/admin e nenhum módulo; gravam na workspace da sessão (que aceita `?workspace_id=` como override). `GET` continua exigindo `revenue_cycle`.

- [ ] **Step 1: Teste que falha**

`tests/revenue/procedures-api.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  session: null as null | { userId: string; accountId: string; workspaceId: string; role: string; modules: string[] },
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/session/api', async () => {
  const { NextResponse: NR } = await import('next/server')
  return {
    requireWorkspaceSession: async () =>
      g.session ? { session: g.session } : { error: NR.json({ error: 'Unauthorized' }, { status: 401 }) },
    requireRole: (session: { role: string }, roles: string[]) =>
      roles.includes(session.role) ? null : NR.json({ error: 'forbidden' }, { status: 403 }),
    requireModule: (session: { modules: string[] }, module: string) =>
      session.modules.includes(module) ? null : NR.json({ error: 'module' }, { status: 403 }),
  }
})

import { POST } from '@/app/api/procedures/route'
import { PATCH, DELETE } from '@/app/api/procedures/[id]/route'

const BASE = { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', modules: [] as string[] }
const req = (method: string, body?: unknown) =>
  new NextRequest('https://app.test/api/procedures', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  } as never)
const params = { params: Promise.resolve({ id: 'p1' }) }

describe('catálogo de procedimentos — escrita', () => {
  beforeEach(() => {
    g.supabase = createSupabaseMock({
      procedure_catalog: { insert: { data: { id: 'p1', name: 'Consulta' } }, update: { data: { id: 'p1' } } },
    })
  })

  it('admin cadastra procedimento mesmo sem o módulo de receita', async () => {
    g.session = { ...BASE, role: 'admin' }
    const res = await POST(req('POST', { name: 'Consulta', default_price: 300 }))
    expect(res.status).toBe(201)
    const [call] = g.supabase.callsTo('procedure_catalog', 'insert')
    expect(call.payload).toMatchObject({ workspace_id: 'w1', name: 'Consulta', default_price: 300 })
  })

  it('admin edita e remove procedimento', async () => {
    g.session = { ...BASE, role: 'admin' }
    expect((await PATCH(req('PATCH', { default_price: 350 }), params)).status).toBe(200)
    expect((await DELETE(req('DELETE'), params)).status).toBe(200)
  })

  it('member não grava no catálogo', async () => {
    g.session = { ...BASE, role: 'member' }
    expect((await POST(req('POST', { name: 'Consulta', default_price: 300 }))).status).toBe(403)
    expect((await PATCH(req('PATCH', { default_price: 1 }), params)).status).toBe(403)
    expect((await DELETE(req('DELETE'), params)).status).toBe(403)
    expect(g.supabase.callsTo('procedure_catalog')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/revenue/procedures-api.test.ts`
Expected: FAIL (403 de módulo para admin).

- [ ] **Step 3: Implementar**

`app/api/procedures/route.ts`: importar `requireRole`; comentário do topo:
```ts
// Catálogo de procedimentos. Leitura: qualquer membro com o ciclo de receita
// (a /agenda usa no seletor). Escrita: owner/admin, sem depender de módulo —
// o catálogo alimenta a Clara em qualquer conta (página Serviços).
```
No POST, trocar o `requireModule` + checagem de owner por:
```ts
  const roleCheck = requireRole(session, ['owner', 'admin'])
  if (roleCheck) return roleCheck
```

`app/api/procedures/[id]/route.ts`: trocar `requireOwnerWithModule` por:
```ts
function requireCatalogEditor(req: NextRequest) {
  return requireWorkspaceSession(req).then((result) => {
    if ('error' in result) return { error: result.error }
    const roleCheck = requireRole(result.session, ['owner', 'admin'])
    if (roleCheck) return { error: roleCheck }
    return { session: result.session }
  })
}
```
(import `requireRole`, remover `requireModule` se não for mais usado), atualizando as duas chamadas e o comentário ("Edição/remoção de procedimento do catálogo — owner/admin.").

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run tests/revenue`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/procedures/route.ts "app/api/procedures/[id]/route.ts" tests/revenue/procedures-api.test.ts
git commit -m "feat(servicos): catalogo de procedimentos editavel por owner/admin sem modulo"
```

---

### Task 8: Página Serviços

**Files:**
- Create: `components/configuracoes/servicos/ProcedureCatalog.tsx`
- Create: `components/configuracoes/servicos/ServicesClient.tsx`
- Create: `app/(dashboard)/configuracoes/servicos/page.tsx`
- Modify: `components/configuracoes/RevenueSettingsClient.tsx` (remover catálogo e dialog)
- Modify: `app/(dashboard)/configuracoes/receita/page.tsx`

**Interfaces:**
- Consumes: `POST /api/procedures`, `PATCH|DELETE /api/procedures/[id]` (Task 7) com `?workspace_id=`; `PATCH /api/bot/config` com `payment_methods`, `pricing_info`, `exam_preparation`; `TagInput` de `components/configuracoes/bot/TagInput`.
- Produces:
  ```ts
  export type Procedure = Database['public']['Tables']['procedure_catalog']['Row']
  export function ProcedureCatalog(props: { workspaceId: string; procedures: Procedure[]; onChange: (next: Procedure[]) => void }): JSX.Element
  ```
  `RevenueSettingsClient` passa a receber só `initialSettings`.

- [ ] **Step 1: Extrair `ProcedureCatalog`**

Criar `components/configuracoes/servicos/ProcedureCatalog.tsx` movendo de `RevenueSettingsClient.tsx`: `EMPTY_PROC`, `formatBRL`, o estado do dialog (`dialogOpen`, `editing`, `form`, `savingProc`), `openNew`, `openEdit`, `saveProcedure`, `removeProcedure`, o card "Catálogo de procedimentos" (linhas 124-186) e o Dialog (259-316). Mudanças em relação ao original:

```tsx
export type Procedure = Database['public']['Tables']['procedure_catalog']['Row']

// Catálogo de uma unidade. Controlado: a lista vive no pai (uma por unidade)
// e as rotas recebem ?workspace_id= para gravar na unidade escolhida, não na
// ativa da sessão.
export function ProcedureCatalog({
  workspaceId,
  procedures,
  onChange,
}: {
  workspaceId: string
  procedures: Procedure[]
  onChange: (next: Procedure[]) => void
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Procedure | null>(null)
  const [form, setForm] = useState(EMPTY_PROC)
  const [savingProc, setSavingProc] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const qs = `?workspace_id=${workspaceId}`
```
- `saveProcedure`: URL `editing ? \`/api/procedures/${editing.id}${qs}\` : \`/api/procedures${qs}\``; em sucesso chama `onChange(editing ? procedures.map(...) : [...procedures, saved].sort(...))`; em erro `setError(data.error ?? 'Erro ao salvar.')` (ler `await res.json()`); limpar `error` ao abrir o dialog.
- `removeProcedure`: `fetch(\`/api/procedures/${p.id}${qs}\`, { method: 'DELETE' })` e `onChange(procedures.filter((x) => x.id !== p.id))`.
- Descrição do card: "Nome, preço e duração de cada procedimento desta unidade. Alimenta a Clara, a agenda e o ciclo de receita."
- No Dialog, antes do `DialogFooter`: `{error && <p className="text-xs text-red-600">{friendlyErrorMessage(error, 'Não foi possível salvar o procedimento. Tente novamente.')}</p>}`.

- [ ] **Step 2: Enxugar `RevenueSettingsClient` e a página Receita**

Em `RevenueSettingsClient.tsx`: remover tudo que foi movido (estado/handlers do catálogo, card do catálogo, Dialog, imports que sobrarem: `Dialog*`, `Label`, `Plus`, `Pencil`, `Trash2`, tipo `Procedure`); a prop vira só `{ initialSettings }: { initialSettings: Settings }`.

Em `app/(dashboard)/configuracoes/receita/page.tsx`: remover a query de `procedure_catalog` (o `Promise.all` vira só a query de `revenue_settings`) e a prop `initialProcedures`; o comentário vira "Preferências do ciclo de receita: exclusivo do owner, e só com o módulo ativo."; o subtítulo vira:
```tsx
        <p className="text-sm text-gray-400">
          Preferências do fechamento diário. O catálogo de procedimentos fica em{' '}
          <Link href="/configuracoes/servicos" className="text-[var(--cyan-dark)] hover:underline">
            Serviços
          </Link>
          .
        </p>
```

- [ ] **Step 3: `ServicesClient`**

```tsx
'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TagInput } from '@/components/configuracoes/bot/TagInput'
import { ProcedureCatalog, type Procedure } from './ProcedureCatalog'
import { friendlyErrorMessage } from '@/lib/friendly-errors'

interface Extras {
  payment_methods: string[]
  pricing_info: string
  exam_preparation: string
}

export function ServicesClient({
  workspaces,
  activeWorkspaceId,
  initialProceduresByWorkspace,
  initialExtras,
}: {
  workspaces: { id: string; name: string }[]
  activeWorkspaceId: string
  initialProceduresByWorkspace: Record<string, Procedure[]>
  initialExtras: Extras
}) {
  const multiUnit = workspaces.length > 1
  const [selectedId, setSelectedId] = useState(
    workspaces.some((w) => w.id === activeWorkspaceId) ? activeWorkspaceId : workspaces[0]?.id,
  )
  const [byWorkspace, setByWorkspace] = useState(initialProceduresByWorkspace)
  const [extras, setExtras] = useState(initialExtras)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unitItems = useMemo(() => Object.fromEntries(workspaces.map((w) => [w.id, w.name])), [workspaces])

  const saveExtras = async () => {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch('/api/bot/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_methods: extras.payment_methods,
          pricing_info: extras.pricing_info || null,
          exam_preparation: extras.exam_preparation || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Erro ao salvar.')
      else {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {multiUnit && (
        <div>
          <Label className="text-xs">Unidade</Label>
          <Select items={unitItems} value={selectedId} onValueChange={(v) => v && setSelectedId(v)}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {selectedId && (
        <ProcedureCatalog
          key={selectedId}
          workspaceId={selectedId}
          procedures={byWorkspace[selectedId] ?? []}
          onChange={(next) => setByWorkspace((prev) => ({ ...prev, [selectedId]: next }))}
        />
      )}

      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="text-sm font-medium text-gray-900">Pagamento e preparo</h2>
        <p className="mt-0.5 text-xs text-gray-400">Vale para todas as unidades. A Clara informa ao paciente.</p>
        <div className="mt-4 space-y-4">
          <div>
            <Label>Formas de pagamento</Label>
            <p className="mb-2 text-xs text-gray-400">Digite e pressione Enter para adicionar</p>
            <TagInput
              value={extras.payment_methods}
              onChange={(v) => setExtras((e) => ({ ...e, payment_methods: v }))}
              placeholder="Ex: Pix, Cartão, Dinheiro"
            />
          </div>
          <div>
            <Label htmlFor="pricing_info">Observações sobre preços</Label>
            <p className="mb-1 text-xs text-gray-400">Condições que não cabem na tabela acima (parcelamento, retorno, pacotes)</p>
            <Textarea
              id="pricing_info"
              value={extras.pricing_info}
              onChange={(e) => setExtras((x) => ({ ...x, pricing_info: e.target.value }))}
              rows={3}
              className="mt-1"
              placeholder="Ex: Retorno em até 30 dias sem custo. Parcelamos em até 3x."
            />
          </div>
          <div>
            <Label htmlFor="exam_preparation">Preparo para exames/procedimentos</Label>
            <Textarea
              id="exam_preparation"
              value={extras.exam_preparation}
              onChange={(e) => setExtras((x) => ({ ...x, exam_preparation: e.target.value }))}
              rows={3}
              className="mt-1"
              placeholder="Ex: Jejum de 8h para exame X. Trazer exames anteriores."
            />
          </div>
          {error && (
            <p className="text-sm text-red-500">
              {friendlyErrorMessage(error, 'Não foi possível salvar esta alteração. Tente novamente.')}
            </p>
          )}
          <Button
            onClick={saveExtras}
            disabled={saving}
            className="bg-[var(--cyan)] font-medium text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            {saving ? 'Salvando...' : saved ? '✓ Salvo' : 'Salvar pagamento e preparo'}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Página**

`app/(dashboard)/configuracoes/servicos/page.tsx`:
```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { ServicesClient } from '@/components/configuracoes/servicos/ServicesClient'
import type { Procedure } from '@/components/configuracoes/servicos/ProcedureCatalog'

export default async function ServicosSettingsPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  // Serviços alimentam a Clara, a agenda e o ciclo de receita — owner/admin
  // (a API espelha isso, ver /api/procedures).
  if (session.role !== 'owner' && session.role !== 'admin') redirect('/configuracoes')

  const supabase = await createClient()
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name')
    .eq('account_id', session.accountId)
    .eq('is_active', true)
    .order('display_order')
  const workspaceList = workspaces ?? []

  const [{ data: procedures }, { data: botConfig }] = await Promise.all([
    supabase
      .from('procedure_catalog')
      .select('*')
      .in('workspace_id', workspaceList.map((w) => w.id))
      .eq('is_active', true)
      .order('name', { ascending: true }),
    supabase
      .from('bot_config')
      .select('payment_methods, pricing_info, exam_preparation')
      .eq('account_id', session.accountId)
      .maybeSingle(),
  ])

  const proceduresByWorkspace: Record<string, Procedure[]> = {}
  for (const p of procedures ?? []) (proceduresByWorkspace[p.workspace_id] ??= []).push(p)

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/configuracoes" className="mb-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-3.5 w-3.5" />
          Configurações
        </Link>
        <h1 className="text-xl font-medium text-gray-900">Serviços</h1>
        <p className="text-sm text-gray-400">
          Procedimentos, preços, formas de pagamento e preparo — o que a Clara informa ao paciente.
        </p>
      </div>

      <ServicesClient
        workspaces={workspaceList}
        activeWorkspaceId={session.workspaceId}
        initialProceduresByWorkspace={proceduresByWorkspace}
        initialExtras={{
          payment_methods: botConfig?.payment_methods ?? [],
          pricing_info: botConfig?.pricing_info ?? '',
          exam_preparation: botConfig?.exam_preparation ?? '',
        }}
      />
    </div>
  )
}
```

- [ ] **Step 5: Tipos e lint**

Run: `npx tsc --noEmit` e `npx eslint components/configuracoes "app/(dashboard)/configuracoes/servicos" "app/(dashboard)/configuracoes/receita"`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add components/configuracoes/servicos/ProcedureCatalog.tsx components/configuracoes/servicos/ServicesClient.tsx "app/(dashboard)/configuracoes/servicos/page.tsx" components/configuracoes/RevenueSettingsClient.tsx "app/(dashboard)/configuracoes/receita/page.tsx"
git commit -m "feat(servicos): pagina de servicos com catalogo por unidade, pagamento e preparo"
```

---

### Task 9: Página da unidade (`/locais/[id]`)

**Files:**
- Create: `lib/cep.ts`
- Create: `components/locais/UnitDetailForm.tsx`
- Create: `app/(dashboard)/locais/[id]/page.tsx`
- Modify: `components/locais/WorkspacesClient.tsx` (usar `lib/cep.ts`; card vira link)
- Modify: `app/(dashboard)/locais/page.tsx`
- Modify: `app/api/workspaces/[id]/route.ts:40-48` (remover `consultation_price_from`)
- Test: `tests/cep.test.ts` (novo)

**Interfaces:**
- Consumes: `PATCH /api/workspaces/[id]` (aceita `name, address, city, state, zip_code, business_hours, directions_parking, contact_info, handoff_number`); `HandoffHoursSettings({ initialHours, workspaceId })`.
- Produces:
  ```ts
  export function maskCep(raw: string): { digits: string; masked: string }
  export async function lookupCep(digits: string): Promise<{ address: string; city: string; state: string } | null>
  ```
  `WorkspacesClient` ganha a prop `linkToDetail?: boolean`.

- [ ] **Step 1: Teste que falha**

`tests/cep.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { maskCep, lookupCep } from '@/lib/cep'

afterEach(() => vi.unstubAllGlobals())

describe('maskCep', () => {
  it('mantém só 8 dígitos e coloca o hífen', () => {
    expect(maskCep('01310-100x9')).toEqual({ digits: '01310100', masked: '01310-100' })
    expect(maskCep('0131')).toEqual({ digits: '0131', masked: '0131' })
  })
})

describe('lookupCep', () => {
  it('monta endereço, cidade e UF a partir do ViaCEP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ logradouro: 'Av. Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' }),
    })))
    expect(await lookupCep('01310100')).toEqual({ address: 'Av. Paulista, Bela Vista', city: 'São Paulo', state: 'SP' })
  })

  it('devolve null para CEP inexistente ou falha de rede', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ erro: true }) })))
    expect(await lookupCep('00000000')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await lookupCep('01310100')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/cep.test.ts`
Expected: FAIL — módulo `@/lib/cep` não existe.

- [ ] **Step 3: `lib/cep.ts`**

```ts
// CEP: máscara e consulta ao ViaCEP (usado no cadastro e na página da unidade).
export function maskCep(raw: string): { digits: string; masked: string } {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  return { digits, masked: digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits }
}

// null quando o CEP não existe ou a consulta falha.
export async function lookupCep(digits: string): Promise<{ address: string; city: string; state: string } | null> {
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
    const data = await res.json()
    if (data.erro) return null
    return {
      address: [data.logradouro, data.bairro].filter(Boolean).join(', '),
      city: data.localidade ?? '',
      state: data.uf ?? '',
    }
  } catch {
    return null
  }
}
```

Run: `npx vitest run tests/cep.test.ts` — Expected: PASS.

- [ ] **Step 4: `WorkspacesClient` usa o helper e linka para a unidade**

Substituir o corpo de `handleCepChange` por:
```ts
  const handleCepChange = async (raw: string) => {
    const { digits, masked } = maskCep(raw)
    setForm((f) => ({ ...f, zip_code: masked }))
    setCepError(false)
    if (digits.length !== 8) return

    setCepLoading(true)
    const found = await lookupCep(digits)
    setCepLoading(false)
    if (!found) {
      setCepError(true)
      return
    }
    setForm((f) => ({ ...f, address: found.address, city: found.city || f.city, state: found.state || f.state }))
  }
```
Adicionar a prop `linkToDetail?: boolean` (comentário: "true em /locais: o nome da unidade abre a página de detalhe; o admin não usa"). No card, trocar `<p className="font-medium text-gray-900">{w.name}</p>` por:
```tsx
              {linkToDetail ? (
                <Link href={`/locais/${w.id}`} className="font-medium text-gray-900 hover:text-[var(--cyan-dark)] hover:underline">
                  {w.name}
                </Link>
              ) : (
                <p className="font-medium text-gray-900">{w.name}</p>
              )}
```
(import `Link from 'next/link'`). Em `app/(dashboard)/locais/page.tsx`, passar `linkToDetail` ao `<WorkspacesClient>` e trocar o subtítulo por "Unidades/clínicas da sua conta MedScale. Clique numa unidade para editar endereço, contatos e atendimento humano."

- [ ] **Step 5: `UnitDetailForm`**

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { HandoffHoursSettings } from '@/components/configuracoes/bot/HandoffHoursSettings'
import { lookupCep, maskCep } from '@/lib/cep'
import { friendlyErrorMessage } from '@/lib/friendly-errors'
import type { Database } from '@/types/database'

type HandoffHour = Database['public']['Tables']['handoff_hours']['Row']

export interface UnitDetail {
  id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  business_hours: string | null
  directions_parking: string | null
  contact_info: string | null
  handoff_number: string | null
}

type UnitForm = Record<Exclude<keyof UnitDetail, 'id'>, string>

function toForm(w: UnitDetail): UnitForm {
  return {
    name: w.name,
    address: w.address ?? '',
    city: w.city ?? '',
    state: w.state ?? '',
    zip_code: w.zip_code ?? '',
    business_hours: w.business_hours ?? '',
    directions_parking: w.directions_parking ?? '',
    contact_info: w.contact_info ?? '',
    handoff_number: w.handoff_number ?? '',
  }
}

// Dados da unidade que o paciente vê e que a Clara usa. Member só lê.
export function UnitDetailForm({
  workspace,
  handoffHours,
  canManage,
}: {
  workspace: UnitDetail
  handoffHours: HandoffHour[]
  canManage: boolean
}) {
  const [form, setForm] = useState(() => toForm(workspace))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cepError, setCepError] = useState(false)

  const setField = (key: keyof UnitForm, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const handleCepChange = async (raw: string) => {
    const { digits, masked } = maskCep(raw)
    setField('zip_code', masked)
    setCepError(false)
    if (digits.length !== 8) return
    const found = await lookupCep(digits)
    if (!found) {
      setCepError(true)
      return
    }
    setForm((f) => ({ ...f, address: found.address, city: found.city || f.city, state: found.state || f.state }))
  }

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          address: form.address || null,
          city: form.city || null,
          state: form.state || null,
          zip_code: form.zip_code || null,
          business_hours: form.business_hours || null,
          directions_parking: form.directions_parking || null,
          contact_info: form.contact_info || null,
          handoff_number: form.handoff_number || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Erro ao salvar.')
      else {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } finally {
      setSaving(false)
    }
  }

  const card = 'rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]'

  return (
    <div className="space-y-6">
      <section className={card}>
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">Identificação e endereço</h2>
        <fieldset disabled={!canManage} className="space-y-4">
          <div>
            <Label htmlFor="name">Nome da unidade</Label>
            <Input id="name" value={form.name} onChange={(e) => setField('name', e.target.value)} className="mt-1" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_1fr]">
            <div>
              <Label htmlFor="zip_code">CEP</Label>
              <Input id="zip_code" value={form.zip_code} onChange={(e) => handleCepChange(e.target.value)} className="mt-1" />
              {cepError && <p className="mt-1 text-xs text-red-500">CEP não encontrado.</p>}
            </div>
            <div>
              <Label htmlFor="address">Endereço</Label>
              <Input
                id="address"
                value={form.address}
                onChange={(e) => setField('address', e.target.value)}
                placeholder="Ex: Rua Exemplo, 123 - Sala 45, Bairro"
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-4">
            <div>
              <Label htmlFor="city">Cidade</Label>
              <Input id="city" value={form.city} onChange={(e) => setField('city', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="state">UF</Label>
              <Input id="state" maxLength={2} value={form.state} onChange={(e) => setField('state', e.target.value.toUpperCase())} className="mt-1" />
            </div>
          </div>
          <div>
            <Label htmlFor="directions_parking">Como chegar / estacionamento</Label>
            <Textarea
              id="directions_parking"
              value={form.directions_parking}
              onChange={(e) => setField('directions_parking', e.target.value)}
              rows={2}
              className="mt-1"
              placeholder="Ex: Estacionamento próprio no local. Em frente ao metrô X."
            />
          </div>
        </fieldset>
      </section>

      <section className={card}>
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">Atendimento ao paciente</h2>
        <fieldset disabled={!canManage} className="space-y-4">
          <div>
            <Label htmlFor="business_hours">Horário de atendimento presencial (texto livre)</Label>
            <Textarea
              id="business_hours"
              value={form.business_hours}
              onChange={(e) => setField('business_hours', e.target.value)}
              rows={2}
              className="mt-1"
              placeholder="Ex: Segunda a sexta das 08h às 17h. Sábados das 08h às 12h."
            />
            <p className="mt-1.5 text-xs text-gray-400">
              Texto exibido ao paciente — a Clara conversa e agenda 24/7. Quem controla os horários reais para agendar é o{' '}
              <a href="/expediente" className="text-[var(--cyan-dark)] hover:underline">
                expediente
              </a>
              .
            </p>
          </div>
          <div>
            <Label htmlFor="contact_info">Contatos</Label>
            <Textarea
              id="contact_info"
              value={form.contact_info}
              onChange={(e) => setField('contact_info', e.target.value)}
              rows={2}
              className="mt-1"
              placeholder="Ex: Telefone fixo, e-mail, Instagram"
            />
          </div>
          <div>
            <Label htmlFor="handoff_number">Número para transferência (handoff)</Label>
            <p className="mb-1 text-xs text-gray-400">Formato internacional: +5511999999999. Opcional.</p>
            <Input
              id="handoff_number"
              value={form.handoff_number}
              onChange={(e) => setField('handoff_number', e.target.value)}
              placeholder="+5511999999999"
              className="mt-1 font-mono"
            />
          </div>
        </fieldset>

        {canManage && (
          <div className="mt-4 space-y-3">
            {error && (
              <p className="text-sm text-red-500">
                {friendlyErrorMessage(error, 'Não foi possível salvar esta alteração. Tente novamente.')}
              </p>
            )}
            <Button
              onClick={save}
              disabled={saving || !form.name.trim()}
              className="bg-[var(--cyan)] font-medium text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
            >
              {saving ? 'Salvando...' : saved ? '✓ Salvo' : 'Salvar unidade'}
            </Button>
          </div>
        )}
      </section>

      {canManage && (
        <section className={card}>
          <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Horário de atendimento humano</h2>
          <p className="mb-4 text-xs text-gray-400">
            Fora destes horários, quando o paciente pede um humano a Clara avisa que a equipe retorna depois.
          </p>
          <HandoffHoursSettings initialHours={handoffHours} workspaceId={workspace.id} />
        </section>
      )}
    </div>
  )
}
```
Um único botão "Salvar unidade" salva os campos dos dois primeiros cards; o horário humano salva sozinho (é o `HandoffHoursSettings` de sempre).

- [ ] **Step 6: Página**

`app/(dashboard)/locais/[id]/page.tsx`:
```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { UnitDetailForm } from '@/components/locais/UnitDetailForm'

export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const [{ data: workspace }, { data: handoffHours }] = await Promise.all([
    supabase
      .from('workspaces')
      .select('id, name, address, city, state, zip_code, business_hours, directions_parking, contact_info, handoff_number')
      .eq('id', id)
      .eq('account_id', session.accountId)
      .maybeSingle(),
    supabase.from('handoff_hours').select('*').eq('workspace_id', id).order('day_of_week').order('start_time'),
  ])
  if (!workspace) notFound()

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/locais" className="mb-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-3.5 w-3.5" />
          Meus locais
        </Link>
        <h1 className="text-xl font-medium text-gray-900">{workspace.name}</h1>
        <p className="text-sm text-gray-400">Dados que aparecem para o paciente e que a Clara usa nesta unidade.</p>
      </div>
      <UnitDetailForm
        workspace={workspace}
        handoffHours={handoffHours ?? []}
        canManage={session.role === 'owner' || session.role === 'admin'}
      />
    </div>
  )
}
```

- [ ] **Step 7: API da unidade**

Em `app/api/workspaces/[id]/route.ts`, remover `'consultation_price_from',` da lista de campos editáveis.

- [ ] **Step 8: Testes, tipos e lint**

Run: `npx vitest run tests/cep.test.ts`, `npx tsc --noEmit`, `npx eslint lib/cep.ts components/locais "app/(dashboard)/locais" "app/api/workspaces/[id]"`
Expected: PASS / sem erros.

- [ ] **Step 9: Commit**

```bash
git add lib/cep.ts tests/cep.test.ts components/locais/UnitDetailForm.tsx components/locais/WorkspacesClient.tsx "app/(dashboard)/locais/page.tsx" "app/(dashboard)/locais/[id]/page.tsx" "app/api/workspaces/[id]/route.ts"
git commit -m "feat(locais): pagina da unidade com endereco, contatos e atendimento humano"
```

---

### Task 10: Tela da Clara só com comportamento + hub de Configurações

**Files:**
- Create: `components/configuracoes/bot/ClinicDataLinks.tsx`
- Modify: `components/configuracoes/bot/BotConfigForm.tsx`
- Modify: `app/(dashboard)/configuracoes/bot/page.tsx`
- Delete: `components/configuracoes/bot/WorkspaceBotFields.tsx`
- Modify: `components/configuracoes/SettingsClient.tsx:188-262`

**Interfaces:**
- Consumes: páginas das Tasks 4, 8, 9.
- Produces: `BotConfigForm` recebe `clinicData: { serviceNames: string[]; insurerNames: string[]; unitCount: number }` no lugar de `workspaces`, `handoffHoursByWorkspace` e `activeWorkspaceId`.

- [ ] **Step 1: `ClinicDataLinks`**

```tsx
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export interface ClinicData {
  serviceNames: string[]
  insurerNames: string[]
  unitCount: number
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// Dados da clínica que a Clara usa, editados nas páginas próprias.
export function ClinicDataLinks({ data }: { data: ClinicData }) {
  const links = [
    { href: '/configuracoes/servicos', label: 'Serviços', detail: plural(data.serviceNames.length, 'procedimento', 'procedimentos') },
    { href: '/configuracoes/convenios', label: 'Convênios', detail: plural(data.insurerNames.length, 'convênio', 'convênios') },
    { href: '/locais', label: 'Unidades', detail: plural(data.unitCount, 'unidade', 'unidades') },
  ]
  return (
    <section className="mb-6 break-inside-avoid rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Dados que a Clara usa</h3>
      <p className="mb-3 text-xs text-gray-400">Procedimentos, preços, convênios e endereços ficam nas páginas de cada um.</p>
      <ul className="divide-y divide-[var(--navy-06)]">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex items-center justify-between py-2.5 text-sm text-gray-900 hover:text-[var(--cyan-dark)]">
              <span>
                {l.label} <span className="ml-1 text-xs text-gray-400">{l.detail}</span>
              </span>
              <ArrowRight className="h-4 w-4 text-gray-400" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 2: `BotConfigForm`**

- `FormState`/`toFormState`: remover `procedures`, `insurance_plans`, `accepts_private`, `payment_methods`, `pricing_info`, `exam_preparation`. (O `handleSave` manda o `form` inteiro — assim esses campos param de ser enviados e não sobrescrevem o que foi salvo em Serviços/Convênios.)
- Props: trocar `workspaces`, `handoffHoursByWorkspace`, `activeWorkspaceId` por `clinicData: ClinicData` (import de `./ClinicDataLinks`). Remover imports de `WorkspaceBotFields`, `TagInput`, `Switch` e o tipo `HandoffHour` se não forem mais usados.
- Remover a `<section>` "Serviços e convênios" inteira e, no lugar dela, renderizar `<ClinicDataLinks data={clinicData} />`.
- Na seção "Atendimento humano (handoff)", trocar o parágrafo por:
```tsx
            <p className="mb-4 text-xs text-gray-400">
              O número de transferência e o horário de atendimento humano ficam em cada unidade, em{' '}
              <a href="/locais" className="text-[var(--cyan-dark)] hover:underline">
                Meus locais
              </a>
              .
            </p>
```
- `BotPreview`: `procedures: clinicData.serviceNames, insurance_plans: clinicData.insurerNames`.
- Remover a `<section>` "Dados por unidade" no fim.

- [ ] **Step 3: Página da Clara**

Em `app/(dashboard)/configuracoes/bot/page.tsx`, trocar o `Promise.all` e o agrupamento de `handoffHours` por:
```ts
  const supabase = await createClient()
  const [{ data: botConfig }, { data: profile }, { data: workspaces }, { data: insurers }, { data: membership }] =
    await Promise.all([
      supabase.from('bot_config').select('*').eq('account_id', session.accountId).maybeSingle(),
      supabase.from('profiles').select('phone').eq('id', session.userId).single(),
      supabase.from('workspaces').select('id').eq('account_id', session.accountId).eq('is_active', true),
      supabase
        .from('health_insurers')
        .select('name')
        .eq('account_id', session.accountId)
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('memberships')
        .select('handoff_push_enabled')
        .eq('account_id', session.accountId)
        .eq('user_id', session.userId)
        .maybeSingle(),
    ])

  const workspaceIds = (workspaces ?? []).map((w) => w.id)
  const { data: catalog } = await supabase
    .from('procedure_catalog')
    .select('name')
    .in('workspace_id', workspaceIds)
    .eq('is_active', true)
    .order('name')
```
Props do form: remover `workspaces`, `handoffHoursByWorkspace`, `activeWorkspaceId`; adicionar
```tsx
        clinicData={{
          serviceNames: [...new Set((catalog ?? []).map((p) => p.name))],
          insurerNames: (insurers ?? []).map((i) => i.name),
          unitCount: workspaceIds.length,
        }}
```
Subtítulo da página: "Conexão com a Meta e o jeito da Clara atender: mensagens, tom de voz, políticas, FAQ e transferência para humano. Serviços, convênios e unidades ficam nas páginas de cada um."

- [ ] **Step 4: Remover `WorkspaceBotFields`**

```bash
git rm components/configuracoes/bot/WorkspaceBotFields.tsx
```
Run: `npx tsc --noEmit` — Expected: nenhuma referência sobrando.

- [ ] **Step 5: Hub de Configurações**

Em `components/configuracoes/SettingsClient.tsx`:
- Card da Clara: subtítulo `Personalidade e FAQ` mantém; descrição vira "Mensagens, tom de voz, políticas, FAQ e transferência para humano."
- Logo depois do card da Clara (ainda dentro do bloco `canManageIntegrations`), adicionar um card no mesmo formato:
```tsx
      <Link
        href="/configuracoes/servicos"
        className="flex items-center justify-between rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--cyan)]"
      >
        <div>
          <h2 className="text-sm font-medium text-gray-900">Serviços</h2>
          <p className="mt-0.5 text-xs text-gray-400">
            Procedimentos e preços por unidade, formas de pagamento e preparo de exames.
          </p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-gray-400" />
      </Link>
```
- Card Receita: descrição vira "Preferências do fechamento diário."
- Card Convênios: condição vira `{canManageIntegrations && (` e a descrição:
```tsx
              {showBilling
                ? 'Operadoras, tabela TUSS, horário dos lotes e dados do prestador para o faturamento TISS.'
                : 'Convênios aceitos e atendimento particular — a Clara informa ao paciente.'}
```

- [ ] **Step 6: Tipos e lint**

Run: `npx tsc --noEmit` e `npx eslint components/configuracoes "app/(dashboard)/configuracoes"`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add components/configuracoes/bot/ClinicDataLinks.tsx components/configuracoes/bot/BotConfigForm.tsx "app/(dashboard)/configuracoes/bot/page.tsx" components/configuracoes/SettingsClient.tsx
git commit -m "feat(clara): tela da Clara so com comportamento, com atalhos para servicos, convenios e unidades"
```
(o `git rm` do Step 4 já deixou a remoção staged.)

---

### Task 11: Verificação final

- [ ] **Step 1: Suíte e build**

Run, em sequência: `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`
Expected: tudo verde. Se falhar algo fora dos arquivos tocados, ver se a falha envolve `procedures`, `insurancePlans`, `consultationPriceFrom`, `ans_registry` ou `health_insurers` (é desta mudança: corrigir) ou os arquivos que o usuário já tinha modificados no working tree (availability/session: fora do escopo, reportar sem corrigir).

- [ ] **Step 2: Conferência manual (`npm run dev`, conta owner com 2+ unidades)**

- `/configuracoes`: cards Clara, Serviços, Convênios (com e sem módulo billing), Receita com o texto novo.
- `/configuracoes/servicos`: trocar de unidade no seletor, criar um procedimento na unidade **não ativa**, recarregar — ele aparece só naquela unidade. Salvar formas de pagamento.
- `/configuracoes/convenios` sem billing: cadastrar "Unimed" só com nome; desligar "Aceita particular", recarregar e conferir que ficou desligado.
- `/configuracoes/bot`: card "Dados que a Clara usa" com as contagens; salvar a tela e voltar em Serviços/Convênios — formas de pagamento e particular não mudaram.
- `/locais`: clicar numa unidade, editar endereço via CEP, contatos e horário humano; como member, a página abre só leitura.

- [ ] **Step 3: Lembrar o usuário**

`supabase/billing.sql` precisa ser reaplicado no Supabase dev (e aplicado em prod junto com o resto do faturamento) antes do deploy.
