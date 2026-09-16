# Integrações Meta (Embedded Signup + Login com Facebook) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Goal:** Substituir todo o onboarding manual do WhatsApp por um botão "Conectar WhatsApp" (Embedded Signup da Meta) e adicionar um botão "Login com Facebook" que conecta a conta de anúncios e alimenta `/trafego` automaticamente.

**Architecture:** Duas verticais independentes sobre um cliente Graph compartilhado (`lib/meta/graph.ts`). O WhatsApp continua guardando credencial em `bot_config` (uma linha por account); o Ads ganha `meta_ads_connections` + `workspace_ad_accounts`. O sync de anúncios grava em `ad_campaigns` com `source='meta_sync'`, convivendo com as linhas digitadas à mão.

**Tech Stack:** Next.js 16.3.1 (App Router), TypeScript, Supabase (Postgres + RLS + pg_cron), Vitest, Tailwind, Sentry, PostHog.

**Spec:** `docs/superpowers/specs/2026-09-16-integracoes-meta-design.md` — leia antes de começar; o plano executa o que o spec argumenta.

## Global Constraints

- Next.js **16.3.1**: antes de mexer em qualquer API específica do Next (scripts, rotas, `after`), leia o guia correspondente em `node_modules/next/dist/docs/`. É regra do `AGENTS.md`.
- Toda credencial da Meta é persistida **cifrada** com `encryptToken` de `lib/crypto.ts`. Nunca em texto puro, nunca em log, nunca em resposta de API.
- Rotas de integração exigem `requireWorkspaceSession(req)` + `requireRole(session, ['owner', 'admin'])`. Rotas de cron exigem `requireCronAuth(req)`.
- Mensagens de UI e de erro de API em **português**, sem jargão da Meta sem explicação.
- Migrations são **idempotentes** (`if not exists` / `drop ... if exists` antes de criar) e ficam em `supabase/migration_*.sql`, aplicadas à mão no SQL Editor do Supabase.
- Versão da Graph API vem de `META_GRAPH_VERSION` com default `v22.0` — nunca hardcode nova versão em código novo.
- Commits frequentes, um por tarefa no mínimo. **Não abrir PR** — o usuário abre.
- `npm test` roda a suíte inteira; rode o arquivo específico durante o ciclo TDD.

---

## Mapa de arquivos

**Criados:**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migration_meta_integrations.sql` | schema das duas integrações + limpeza das conexões antigas |
| `lib/meta/graph.ts` | cliente HTTP da Graph API: versão, erro tipado, detecção de token expirado |
| `lib/meta/embedded-signup.ts` | os quatro passos Meta do Embedded Signup (troca de código, inscrição, registro, leitura do número) |
| `app/api/whatsapp/embedded-signup/route.ts` | orquestra os passos e persiste em `bot_config` |
| `components/configuracoes/WhatsAppConnectButton.tsx` | botão + SDK JS + captura do `WA_EMBEDDED_SIGNUP` |
| `lib/meta/ads-oauth.ts` | OAuth do Facebook Ads: URL de consentimento, troca por token longo, leitura do token válido |
| `app/api/meta/ads/connect/route.ts` | redireciona ao consentimento |
| `app/api/meta/ads/callback/route.ts` | valida `state`, salva conexão |
| `app/api/meta/ads/disconnect/route.ts` | apaga a conexão e os mapeamentos |
| `app/api/meta/ads/accounts/route.ts` | GET lista contas de anúncio, PUT grava mapeamento |
| `components/configuracoes/FacebookConnectButton.tsx` | botão + estado conectado/expirado |
| `components/configuracoes/AdAccountMap.tsx` | mapeamento unidade → conta de anúncio |
| `components/configuracoes/MetaIntegrationsCard.tsx` | card que reúne os dois botões |
| `lib/meta/ads-sync.ts` | busca insights e faz upsert idempotente em `ad_campaigns` |
| `app/api/meta/ads/sync/route.ts` | sync sob demanda da account ativa |
| `app/api/cron/meta-ads-sync/route.ts` | sync diário de todas as accounts conectadas |
| `tests/meta/*.test.ts` | cobertura das duas verticais |

**Modificados:** `types/database.ts`, `app/api/whatsapp/webhook/route.ts`, `app/api/bot/onboarding/disconnect/route.ts`, `components/configuracoes/bot/BotConfigForm.tsx`, `components/configuracoes/bot/BotStatusBadge.tsx`, `components/configuracoes/SettingsClient.tsx`, `app/(dashboard)/configuracoes/page.tsx`, `app/(dashboard)/configuracoes/bot/page.tsx`, `components/trafego/CampaignsClient.tsx`, `supabase/cron.sql`, `.env.local.example`, `tests/webhook/signature.test.ts`.

**Apagados:** `components/configuracoes/bot/BotOnboarding.tsx`, `app/api/bot/onboarding/verify-meta/route.ts`, `app/api/bot/onboarding/provision/route.ts`.

---

### Task 1: Migration e tipos

**Files:**
- Create: `supabase/migration_meta_integrations.sql`
- Modify: `types/database.ts`

**Interfaces:**
- Produces: tabelas `meta_ads_connections`, `workspace_ad_accounts`; colunas `ad_campaigns.source`, `ad_campaigns.external_campaign_id`, `bot_config.waba_id`, `bot_config.whatsapp_pin`; tipos `Database['public']['Tables']['meta_ads_connections']` e `['workspace_ad_accounts']`, `AdCampaignSource = 'manual' | 'meta_sync'`.

- [ ] **Step 1: Escrever a migration**

Crie `supabase/migration_meta_integrations.sql`:

```sql
-- Integrações Meta: Embedded Signup do WhatsApp + Login com Facebook (Ads).
-- Idempotente. Ver docs/superpowers/specs/2026-09-16-integracoes-meta-design.md
-- Aplicar no SQL Editor do Supabase.

-- 1. Conexão do Facebook Ads (uma por account, espelha google_tokens)
create table if not exists public.meta_ads_connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.accounts(id) on delete cascade,
  fb_user_id text not null,
  access_token text not null,          -- cifrado (lib/crypto.ts)
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  connected_by uuid references auth.users(id) on delete set null,
  is_valid boolean not null default true,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.meta_ads_connections enable row level security;

drop policy if exists meta_ads_connections_select on public.meta_ads_connections;
create policy meta_ads_connections_select on public.meta_ads_connections
  for select using (account_id = any(public.my_account_ids()));

-- 2. Mapeamento unidade -> conta de anúncio
create table if not exists public.workspace_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  ad_account_id text not null,         -- formato act_<id>
  ad_account_name text,
  created_at timestamptz not null default now(),
  unique (workspace_id, ad_account_id)
);

alter table public.workspace_ad_accounts enable row level security;

drop policy if exists workspace_ad_accounts_select on public.workspace_ad_accounts;
create policy workspace_ad_accounts_select on public.workspace_ad_accounts
  for select using (account_id = any(public.my_account_ids()));

-- 3. ad_campaigns: separar o que veio do sync do que foi digitado à mão
alter table public.ad_campaigns add column if not exists source text not null default 'manual';
alter table public.ad_campaigns add column if not exists external_campaign_id text;

alter table public.ad_campaigns drop constraint if exists ad_campaigns_source_check;
alter table public.ad_campaigns add constraint ad_campaigns_source_check
  check (source in ('manual','meta_sync'));

-- Torna o upsert do sync idempotente sem impor unicidade às linhas manuais.
create unique index if not exists uq_ad_campaigns_meta_sync
  on public.ad_campaigns (workspace_id, external_campaign_id, period_start)
  where source = 'meta_sync';

-- 4. bot_config: dados do Embedded Signup; App Secret por account sai de cena
alter table public.bot_config add column if not exists waba_id text;
alter table public.bot_config add column if not exists whatsapp_pin text;  -- cifrado

-- 5. Limpeza das conexões de teste do fluxo antigo (não há produção real;
--    todos reconectam pelo botão novo).
update public.bot_config
set meta_token = null,
    phone_number_id = null,
    whatsapp_number = null,
    is_active = false;

alter table public.bot_config drop column if exists meta_app_secret;
```

Confira o nome real do helper de RLS usado nas outras policies (`my_account_ids` ou equivalente) em `supabase/schema.sql` e use o mesmo — não invente.

- [ ] **Step 2: Atualizar `types/database.ts`**

Em `bot_config.Row`: remova `meta_app_secret`, adicione `waba_id: string | null` e `whatsapp_pin: string | null`.

Em `ad_campaigns.Row`, adicione:

```ts
          source: AdCampaignSource
          external_campaign_id: string | null
```

E, junto dos outros aliases de união do arquivo:

```ts
export type AdCampaignSource = 'manual' | 'meta_sync'
```

Adicione as duas tabelas novas seguindo o formato de `google_tokens` (Row, Insert como `Partial<Row> & { obrigatórios }`, Update, Relationships):

```ts
      meta_ads_connections: {
        Row: {
          id: string
          // Uma conexão do Facebook Ads por account (o mapeamento
          // unidade -> conta de anúncio fica em workspace_ad_accounts).
          account_id: string
          fb_user_id: string
          access_token: string
          token_expires_at: string | null
          scopes: string[]
          connected_by: string | null
          is_valid: boolean
          connected_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['meta_ads_connections']['Row']> & {
          account_id: string
          fb_user_id: string
          access_token: string
        }
        Update: Partial<Database['public']['Tables']['meta_ads_connections']['Row']>
        Relationships: [
          {
            foreignKeyName: 'meta_ads_connections_account_id_fkey'
            columns: ['account_id']
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
        ]
      }
      workspace_ad_accounts: {
        Row: {
          id: string
          workspace_id: string
          account_id: string
          ad_account_id: string
          ad_account_name: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['workspace_ad_accounts']['Row']> & {
          workspace_id: string
          account_id: string
          ad_account_id: string
        }
        Update: Partial<Database['public']['Tables']['workspace_ad_accounts']['Row']>
        Relationships: [
          {
            foreignKeyName: 'workspace_ad_accounts_workspace_id_fkey'
            columns: ['workspace_id']
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
        ]
      }
```

- [ ] **Step 3: Verificar que o TypeScript aponta o que quebrou**

Run: `npx tsc --noEmit`
Expected: erros **apenas** em `app/api/whatsapp/webhook/route.ts`, `app/api/bot/onboarding/verify-meta/route.ts`, `app/api/bot/onboarding/disconnect/route.ts` e `app/(dashboard)/configuracoes/bot/page.tsx` — todos por causa de `meta_app_secret`. Eles são consertados nas Tasks 5 e 6; anote a lista e siga.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_meta_integrations.sql types/database.ts
git commit -m "feat(meta): schema das integrações Meta (ads + embedded signup)"
```

---

### Task 2: Cliente Graph compartilhado

**Files:**
- Create: `lib/meta/graph.ts`
- Test: `tests/meta/graph.test.ts`

**Interfaces:**
- Produces:
  - `GRAPH_VERSION: string`, `graphUrl(path: string): string`
  - `class MetaApiError extends Error` com `code: number | null`, `subcode: number | null`, `status: number`, getter `isTokenExpired: boolean`
  - `graphFetch<T>(path: string, opts?: { token?: string; method?: 'GET' | 'POST' | 'DELETE'; params?: Record<string, string>; body?: Record<string, unknown> }): Promise<T>`

- [ ] **Step 1: Escrever os testes**

Crie `tests/meta/graph.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { graphFetch, MetaApiError, GRAPH_VERSION } from '@/lib/meta/graph'

describe('graphFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('monta a URL com a versão da Graph e envia o token como Bearer', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ display_phone_number: '+55 11 99999-0000' }), { status: 200 })
    )

    const data = await graphFetch<{ display_phone_number: string }>('/pn-1', {
      token: 'tok',
      params: { fields: 'display_phone_number' },
    })

    expect(data.display_phone_number).toBe('+55 11 99999-0000')
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe(
      `https://graph.facebook.com/${GRAPH_VERSION}/pn-1?fields=display_phone_number`
    )
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('transforma erro da Meta em MetaApiError com código', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid OAuth token', code: 190, error_subcode: 463 } }), {
        status: 401,
      })
    )

    const err = await graphFetch('/me', { token: 'velho' }).catch((e) => e)

    expect(err).toBeInstanceOf(MetaApiError)
    expect(err.code).toBe(190)
    expect(err.subcode).toBe(463)
    expect(err.status).toBe(401)
    expect(err.isTokenExpired).toBe(true)
    expect(err.message).toContain('Invalid OAuth token')
  })

  it('não marca como token expirado um erro comum', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Unsupported get request', code: 100 } }), { status: 400 })
    )

    const err = await graphFetch('/waba-1/subscribed_apps', { token: 'tok' }).catch((e) => e)

    expect(err.isTokenExpired).toBe(false)
  })

  it('manda body como form-urlencoded no POST', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))

    await graphFetch('/pn-1/register', {
      token: 'tok',
      method: 'POST',
      body: { messaging_product: 'whatsapp', pin: '123456' },
    })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.method).toBe('POST')
    expect(String(init?.body)).toBe('messaging_product=whatsapp&pin=123456')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/meta/graph.test.ts`
Expected: FAIL — `Cannot find module '@/lib/meta/graph'`.

- [ ] **Step 3: Implementar**

Crie `lib/meta/graph.ts`:

```ts
// Cliente único das chamadas à Graph API da Meta (WhatsApp e Ads).
// Centraliza a versão, o formato de erro e a detecção de token expirado —
// sem isso cada rota reinventa o tratamento e o erro 190 passa despercebido.

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v22.0'

export function graphUrl(path: string): string {
  return `https://graph.facebook.com/${GRAPH_VERSION}${path.startsWith('/') ? path : `/${path}`}`
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly status: number
  ) {
    super(message)
    this.name = 'MetaApiError'
  }

  /** 190 = token inválido/expirado/revogado: pedir reconexão, não repetir. */
  get isTokenExpired(): boolean {
    return this.code === 190
  }
}

export async function graphFetch<T>(
  path: string,
  opts: {
    token?: string
    method?: 'GET' | 'POST' | 'DELETE'
    params?: Record<string, string>
    body?: Record<string, unknown>
  } = {}
): Promise<T> {
  const url = new URL(graphUrl(path))
  for (const [key, value] of Object.entries(opts.params ?? {})) {
    url.searchParams.set(key, value)
  }

  const headers: Record<string, string> = {}
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`

  let body: string | undefined
  if (opts.body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    const form = new URLSearchParams()
    for (const [key, value] of Object.entries(opts.body)) {
      form.set(key, typeof value === 'string' ? value : JSON.stringify(value))
    }
    body = form.toString()
  }

  const res = await fetch(url.toString(), { method: opts.method ?? 'GET', headers, body })
  const json = await res.json().catch(() => null)

  if (!res.ok) {
    const error = json?.error
    throw new MetaApiError(
      error?.message ?? `Erro ${res.status} da Meta`,
      error?.code ?? null,
      error?.error_subcode ?? null,
      res.status
    )
  }

  return json as T
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/meta/graph.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/meta/graph.ts tests/meta/graph.test.ts
git commit -m "feat(meta): cliente compartilhado da Graph API"
```

---

### Task 3: Passos Meta do Embedded Signup

**Files:**
- Create: `lib/meta/embedded-signup.ts`
- Test: `tests/meta/embedded-signup-steps.test.ts`

**Interfaces:**
- Consumes: `graphFetch`, `MetaApiError` (Task 2)
- Produces:
  - `exchangeEmbeddedSignupCode(code: string): Promise<string>` — devolve o token do negócio
  - `subscribeAppToWaba(wabaId: string, token: string): Promise<void>`
  - `unsubscribeAppFromWaba(wabaId: string, token: string): Promise<void>`
  - `registerPhoneNumber(phoneNumberId: string, pin: string, token: string): Promise<void>`
  - `fetchPhoneNumberInfo(phoneNumberId: string, token: string): Promise<{ displayPhoneNumber: string | null; verifiedName: string | null }>`
  - `generatePin(): string` — 6 dígitos
  - `isEmbeddedSignupConfigured(): boolean`

- [ ] **Step 1: Escrever os testes**

Crie `tests/meta/embedded-signup-steps.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  exchangeEmbeddedSignupCode,
  subscribeAppToWaba,
  registerPhoneNumber,
  fetchPhoneNumberInfo,
  generatePin,
} from '@/lib/meta/embedded-signup'

const ok = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200 })

describe('passos do Embedded Signup', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubEnv('NEXT_PUBLIC_META_APP_ID', 'app-123')
    vi.stubEnv('META_APP_SECRET', 'segredo')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('troca o code pelo token do negócio', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ access_token: 'token-do-negocio' }))

    const token = await exchangeEmbeddedSignupCode('code-abc')

    expect(token).toBe('token-do-negocio')
    const url = String(vi.mocked(fetch).mock.calls[0][0])
    expect(url).toContain('/oauth/access_token')
    expect(url).toContain('client_id=app-123')
    expect(url).toContain('client_secret=segredo')
    expect(url).toContain('code=code-abc')
  })

  it('erra com mensagem em português quando a Meta recusa o código', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid verification code', code: 100 } }), { status: 400 })
    )

    await expect(exchangeEmbeddedSignupCode('ruim')).rejects.toThrow(
      /autorização do WhatsApp expirou|não foi possível concluir a autorização/i
    )
  })

  it('inscreve o App no WABA', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ success: true }))

    await subscribeAppToWaba('waba-1', 'tok')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/waba-1/subscribed_apps')
    expect(init?.method).toBe('POST')
  })

  it('registra o número com o PIN', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ success: true }))

    await registerPhoneNumber('pn-1', '123456', 'tok')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/pn-1/register')
    expect(String(init?.body)).toContain('messaging_product=whatsapp')
    expect(String(init?.body)).toContain('pin=123456')
  })

  it('lê número e nome verificado', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ display_phone_number: '+55 11 98888-0000', verified_name: 'Clínica X' }))

    const info = await fetchPhoneNumberInfo('pn-1', 'tok')

    expect(info).toEqual({ displayPhoneNumber: '+55 11 98888-0000', verifiedName: 'Clínica X' })
  })

  it('gera PIN de exatamente 6 dígitos', () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePin()).toMatch(/^\d{6}$/)
    }
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/meta/embedded-signup-steps.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

Crie `lib/meta/embedded-signup.ts`:

```ts
import crypto from 'crypto'
import { graphFetch, MetaApiError } from './graph'

// Os quatro passos que o Embedded Signup exige da Meta. Cada um erra com
// mensagem própria: um erro genérico aqui é indepurável — o usuário não
// distingue problema de número, de permissão ou de conta.

export function isEmbeddedSignupConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_META_APP_ID && process.env.META_ES_CONFIG_ID && process.env.META_APP_SECRET)
}

/** Troca o `code` do popup pelo token de system user do negócio (sem expiração). */
export async function exchangeEmbeddedSignupCode(code: string): Promise<string> {
  try {
    const data = await graphFetch<{ access_token: string }>('/oauth/access_token', {
      params: {
        client_id: process.env.NEXT_PUBLIC_META_APP_ID ?? '',
        client_secret: process.env.META_APP_SECRET ?? '',
        code,
      },
    })
    if (!data.access_token) throw new Error('sem access_token')
    return data.access_token
  } catch (err) {
    throw new Error(
      `Não foi possível concluir a autorização do WhatsApp (a autorização pode ter expirado — tente conectar de novo). Detalhe da Meta: ${
        err instanceof MetaApiError ? err.message : String(err)
      }`
    )
  }
}

/** Inscreve o App da MedScale no WABA do cliente — é o que faz o webhook receber mensagens. */
export async function subscribeAppToWaba(wabaId: string, token: string): Promise<void> {
  try {
    await graphFetch(`/${wabaId}/subscribed_apps`, { token, method: 'POST' })
  } catch (err) {
    throw new Error(
      `Não foi possível inscrever o App no seu WhatsApp Business. Detalhe da Meta: ${
        err instanceof MetaApiError ? err.message : String(err)
      }`
    )
  }
}

export async function unsubscribeAppFromWaba(wabaId: string, token: string): Promise<void> {
  await graphFetch(`/${wabaId}/subscribed_apps`, { token, method: 'DELETE' })
}

/** Registra o número na Cloud API. Sem isso o número conecta mas não envia. */
export async function registerPhoneNumber(phoneNumberId: string, pin: string, token: string): Promise<void> {
  try {
    await graphFetch(`/${phoneNumberId}/register`, {
      token,
      method: 'POST',
      body: { messaging_product: 'whatsapp', pin },
    })
  } catch (err) {
    throw new Error(
      `Não foi possível registrar o número na Meta (ele precisa estar verificado antes de conectar). Detalhe da Meta: ${
        err instanceof MetaApiError ? err.message : String(err)
      }`
    )
  }
}

export async function fetchPhoneNumberInfo(
  phoneNumberId: string,
  token: string
): Promise<{ displayPhoneNumber: string | null; verifiedName: string | null }> {
  const data = await graphFetch<{ display_phone_number?: string; verified_name?: string }>(`/${phoneNumberId}`, {
    token,
    params: { fields: 'display_phone_number,verified_name' },
  })
  return {
    displayPhoneNumber: data.display_phone_number ?? null,
    verifiedName: data.verified_name ?? null,
  }
}

/** PIN da verificação em duas etapas. Guardado cifrado: sem ele, reconectar o mesmo número trava. */
export function generatePin(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/meta/embedded-signup-steps.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/meta/embedded-signup.ts tests/meta/embedded-signup-steps.test.ts
git commit -m "feat(meta): passos do Embedded Signup contra a Graph API"
```

---

### Task 4: Rota do Embedded Signup

**Files:**
- Create: `app/api/whatsapp/embedded-signup/route.ts`
- Test: `tests/meta/embedded-signup-route.test.ts`

**Interfaces:**
- Consumes: tudo de `lib/meta/embedded-signup.ts` (Task 3); `requireWorkspaceSession`, `requireRole` de `lib/session/api`; `encryptToken`; `invalidateBotConfigCache`
- Produces: `POST /api/whatsapp/embedded-signup` recebendo `{ code, waba_id, phone_number_id }` e devolvendo `{ ok: true, whatsappNumber }` ou `{ error }`

- [ ] **Step 1: Escrever os testes**

Crie `tests/meta/embedded-signup-route.test.ts` (o padrão de mock segue `tests/webhook/signature.test.ts`):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  session: { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner', modules: [] },
  steps: [] as string[],
  failOn: null as string | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client,
  createAdminClient: () => g.supabase.client,
}))
vi.mock('@/lib/session/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session/api')>()
  return { ...actual, requireWorkspaceSession: async () => ({ session: g.session }) }
})
vi.mock('@/lib/crypto', () => ({ encryptToken: (t: string) => `enc:${t}`, decryptToken: (t: string) => t }))
vi.mock('@/lib/bot/config', () => ({ invalidateBotConfigCache: vi.fn() }))
vi.mock('@/lib/analytics/posthog-server', () => ({ trackBotWizardCompleted: vi.fn() }))

const step = async (name: string, value?: unknown) => {
  g.steps.push(name)
  if (g.failOn === name) throw new Error(`falhou em ${name}`)
  return value
}

vi.mock('@/lib/meta/embedded-signup', () => ({
  isEmbeddedSignupConfigured: () => true,
  exchangeEmbeddedSignupCode: () => step('exchange', 'token-negocio'),
  subscribeAppToWaba: () => step('subscribe'),
  registerPhoneNumber: () => step('register'),
  fetchPhoneNumberInfo: () => step('info', { displayPhoneNumber: '+55 11 98888-0000', verifiedName: 'Clínica X' }),
  generatePin: () => '123456',
}))

import { POST } from '@/app/api/whatsapp/embedded-signup/route'

const req = () =>
  new NextRequest('http://localhost/api/whatsapp/embedded-signup', {
    method: 'POST',
    body: JSON.stringify({ code: 'c1', waba_id: 'waba-1', phone_number_id: 'pn-1' }),
    headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => {
  g.steps = []
  g.failOn = null
  g.session = { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner', modules: [] }
  g.supabase = createSupabaseMock({
    bot_config: { upsert: { data: { id: 'bc1' }, error: null } },
  })
})

describe('POST /api/whatsapp/embedded-signup', () => {
  it('executa os quatro passos da Meta na ordem e salva a conexão ativa', async () => {
    const res = await POST(req())

    expect(res.status).toBe(200)
    expect(g.steps).toEqual(['exchange', 'subscribe', 'register', 'info'])

    const upsert = g.supabase.callsTo('bot_config', 'upsert')[0]
    expect(upsert.payload).toMatchObject({
      account_id: 'acc1',
      waba_id: 'waba-1',
      phone_number_id: 'pn-1',
      meta_token: 'enc:token-negocio',
      whatsapp_pin: 'enc:123456',
      whatsapp_number: '+55 11 98888-0000',
      is_active: true,
      number_source: 'own',
    })
  })

  it('falha na inscrição do App não persiste conexão nenhuma', async () => {
    g.failOn = 'subscribe'

    const res = await POST(req())

    expect(res.status).toBe(400)
    expect(g.steps).toEqual(['exchange', 'subscribe'])
    expect(g.supabase.callsTo('bot_config', 'upsert')).toHaveLength(0)
  })

  it('member recebe 403', async () => {
    g.session = { ...g.session, role: 'member' }

    const res = await POST(req())

    expect(res.status).toBe(403)
    expect(g.steps).toEqual([])
  })

  it('exige code, waba_id e phone_number_id', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/whatsapp/embedded-signup', {
        method: 'POST',
        body: JSON.stringify({ code: 'c1' }),
        headers: { 'Content-Type': 'application/json' },
      })
    )

    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/meta/embedded-signup-route.test.ts`
Expected: FAIL — rota inexistente.

- [ ] **Step 3: Implementar**

Crie `app/api/whatsapp/embedded-signup/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createClient } from '@/lib/supabase/server'
import { encryptToken } from '@/lib/crypto'
import { invalidateBotConfigCache } from '@/lib/bot/config'
import { requireWorkspaceSession, requireRole } from '@/lib/session/api'
import { trackBotWizardCompleted } from '@/lib/analytics/posthog-server'
import {
  exchangeEmbeddedSignupCode,
  subscribeAppToWaba,
  registerPhoneNumber,
  fetchPhoneNumberInfo,
  generatePin,
  isEmbeddedSignupConfigured,
} from '@/lib/meta/embedded-signup'

// Única porta de entrada para conectar o WhatsApp da Clara. Nada é gravado
// antes dos quatro passos da Meta darem certo: uma conexão pela metade é pior
// que nenhuma, porque o painel diz "conectado" e o bot não responde.
export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const roleCheck = requireRole(session, ['owner', 'admin'])
  if (roleCheck) return roleCheck

  if (!isEmbeddedSignupConfigured()) {
    return NextResponse.json({ error: 'Integração do WhatsApp ainda não liberada pela Meta.' }, { status: 503 })
  }

  const { code, waba_id, phone_number_id } = await req.json()
  if (!code || !waba_id || !phone_number_id) {
    return NextResponse.json({ error: 'code, waba_id e phone_number_id são obrigatórios' }, { status: 400 })
  }

  const pin = generatePin()

  let businessToken: string
  let info: { displayPhoneNumber: string | null; verifiedName: string | null }
  try {
    businessToken = await exchangeEmbeddedSignupCode(code)
    await subscribeAppToWaba(waba_id, businessToken)
    await registerPhoneNumber(phone_number_id, pin, businessToken)
    info = await fetchPhoneNumberInfo(phone_number_id, businessToken)
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'meta', flow: 'embedded_signup' } })
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Falha ao conectar com a Meta.' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.from('bot_config').upsert(
    {
      account_id: session.accountId,
      waba_id,
      phone_number_id,
      meta_token: encryptToken(businessToken),
      whatsapp_pin: encryptToken(pin),
      whatsapp_number: info.displayPhoneNumber,
      number_source: 'own',
      is_active: true,
    },
    { onConflict: 'account_id' }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  invalidateBotConfigCache(session.accountId)
  await trackBotWizardCompleted(session.userId, {
    workspace_id: session.workspaceId,
    account_id: session.accountId,
    number_source: 'own',
  })

  return NextResponse.json({ ok: true, whatsappNumber: info.displayPhoneNumber })
}
```

Se `requireRole` não existir com essa assinatura em `lib/session/api.ts`, use a mesma checagem manual de `role === 'member'` que as rotas de onboarding usam hoje — mas confira primeiro: `app/api/google/connect/route.ts` já a importa.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/meta/embedded-signup-route.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add app/api/whatsapp/embedded-signup/route.ts tests/meta/embedded-signup-route.test.ts
git commit -m "feat(whatsapp): rota do Embedded Signup"
```

---

### Task 5: Remover o onboarding antigo

**Files:**
- Delete: `components/configuracoes/bot/BotOnboarding.tsx`, `app/api/bot/onboarding/verify-meta/route.ts`, `app/api/bot/onboarding/provision/route.ts`
- Modify: `app/api/whatsapp/webhook/route.ts:44-82`, `app/api/bot/onboarding/disconnect/route.ts`, `components/configuracoes/bot/BotConfigForm.tsx:160-232`, `components/configuracoes/bot/BotStatusBadge.tsx`, `app/(dashboard)/configuracoes/bot/page.tsx:72`
- Test: `tests/webhook/signature.test.ts` (ajuste)

**Interfaces:**
- Consumes: `unsubscribeAppFromWaba` (Task 3)
- Produces: `bot_config` sem `meta_app_secret` em nenhum caminho de código; `BotStatusBadge({ isActive, whatsappNumber })`

- [ ] **Step 1: Ajustar o teste de assinatura do webhook primeiro**

Em `tests/webhook/signature.test.ts`, remova o caso que valida com o segredo por account (`WORKSPACE_SECRET`) e troque-o por um que garante o oposto — que um App de terceiro **não** é mais aceito:

```ts
  it('rejeita assinatura de um App que não é o da MedScale', async () => {
    const body = JSON.stringify(payloadDeMensagem)
    const signature = `sha256=${createHmac('sha256', 'app-secret-de-terceiro').update(body).digest('hex')}`

    const res = await POST(makeRequest(body, signature))

    expect(res.status).toBe(401)
  })
```

Mantenha os casos existentes de `META_APP_SECRET` e do número financeiro. Ajuste os mocks de `bot_config` que retornam `meta_app_secret` para não retornarem mais essa coluna.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/webhook/signature.test.ts`
Expected: FAIL — o webhook ainda aceita o segredo por account.

- [ ] **Step 3: Limpar o webhook**

Em `app/api/whatsapp/webhook/route.ts`: no `select` da linha 54, troque `'account_id, meta_app_secret, phone_number_id, meta_token'` por `'account_id, phone_number_id, meta_token'`; apague a linha `const accountSecret = ...` e a entrada `accountSecret` de `validSignature` e do `console.warn`; atualize o comentário do topo (linhas 11-15) para dizer que só existe o App único da MedScale, mais o segredo próprio do número financeiro.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/webhook/signature.test.ts`
Expected: PASS.

- [ ] **Step 5: Apagar o fluxo antigo e ajustar o disconnect**

```bash
git rm components/configuracoes/bot/BotOnboarding.tsx \
       app/api/bot/onboarding/verify-meta/route.ts \
       app/api/bot/onboarding/provision/route.ts
```

Em `app/api/bot/onboarding/disconnect/route.ts`, acrescente os imports `import * as Sentry from '@sentry/nextjs'`, `import { decryptToken } from '@/lib/crypto'` e `import { unsubscribeAppFromWaba } from '@/lib/meta/embedded-signup'`; então, antes do `update`, leia `waba_id`/`meta_token` e desinscreva o App:

```ts
  const { data: current } = await supabase
    .from('bot_config')
    .select('waba_id, meta_token')
    .eq('account_id', session.accountId)
    .maybeSingle()

  if (current?.waba_id && current.meta_token) {
    try {
      await unsubscribeAppFromWaba(current.waba_id, decryptToken(current.meta_token))
    } catch (err) {
      // Token já revogado do lado da Meta é caso comum — não faz sentido
      // prender o usuário a uma conexão que ele já quer fora.
      Sentry.captureException(err, { tags: { area: 'meta', flow: 'disconnect' } })
    }
  }
```

No `update`, remova `meta_app_secret: null`, acrescente `waba_id: null` e `whatsapp_pin: null`, e mantenha o resto.

- [ ] **Step 6: Limpar os componentes**

Em `BotConfigForm.tsx`: apague o card "Conexão WhatsApp" inteiro (linhas ~168-232), a const `needsOnboarding`, o estado `showConnectionEditor`, o import de `BotOnboarding` e a prop `hasMetaAppSecret`. Mantenha `handleDisconnect` **apenas** se ele ainda for usado — se não for, remova junto (o desconectar passa a viver no card de `/configuracoes`).

Em `BotStatusBadge.tsx`: troque a prop `onboardingStep: OnboardingStep` por `whatsappNumber: string | null`, e o mapa `STEP_LABEL` por dois estados — conectado (verde, com o número) e não configurado (cinza).

Em `app/(dashboard)/configuracoes/bot/page.tsx`: remova a prop `hasMetaAppSecret={...}` da chamada de `BotConfigForm`.

- [ ] **Step 7: Verificar o build de tipos e a suíte**

Run: `npx tsc --noEmit && npm test`
Expected: sem erros de tipo; suíte passando. Erros remanescentes devem ser só em `SettingsClient`/`configuracoes/page.tsx`, resolvidos na Task 6 — se aparecerem outros, conserte agora.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(whatsapp): remove onboarding manual e o App Secret por account"
```

---

### Task 6: Botão "Conectar WhatsApp" na tela de configurações

**Files:**
- Create: `components/configuracoes/WhatsAppConnectButton.tsx`, `components/configuracoes/MetaIntegrationsCard.tsx`
- Modify: `components/configuracoes/SettingsClient.tsx`, `app/(dashboard)/configuracoes/page.tsx`

**Interfaces:**
- Consumes: `POST /api/whatsapp/embedded-signup` (Task 4), `DELETE /api/bot/onboarding/disconnect`
- Produces: `<MetaIntegrationsCard whatsapp={{ connected, number, configured }} ads={...} />` — a parte `ads` entra na Task 9; nesta tarefa o card renderiza só o WhatsApp.

- [ ] **Step 1: Criar o botão**

Crie `components/configuracoes/WhatsAppConnectButton.tsx`. Pontos que não podem ser esquecidos: carregar o SDK só no clique, ouvir `message` **antes** de abrir o popup, e tratar `CANCEL` sem pintar erro vermelho.

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

declare global {
  interface Window {
    FB?: { init: (opts: Record<string, unknown>) => void; login: (cb: (r: { authResponse?: { code?: string } }) => void, opts: Record<string, unknown>) => void }
    fbAsyncInit?: () => void
  }
}

interface Props {
  isConnected: boolean
  whatsappNumber: string | null
  /** false quando faltam NEXT_PUBLIC_META_APP_ID / config do Embedded Signup */
  isConfigured: boolean
  appId: string
  configId: string
}

// Allowlist exata: `endsWith('facebook.com')` aceitaria `evilfacebook.com`, que
// qualquer um registra, e o forjador passaria waba_id/phone_number_id nossos.
const ORIGENS_META = ['https://www.facebook.com', 'https://web.facebook.com']

export function WhatsAppConnectButton({ isConnected, whatsappNumber, isConfigured, appId, configId }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionInfo = useRef<{ waba_id?: string; phone_number_id?: string }>({})

  // O popup do Embedded Signup devolve WABA e Phone Number ID por postMessage —
  // o callback do FB.login traz só o `code`. Precisamos dos dois lados.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!ORIGENS_META.includes(event.origin)) return
      try {
        const data = JSON.parse(event.data)
        if (data.type !== 'WA_EMBEDDED_SIGNUP') return
        if (data.event === 'FINISH') sessionInfo.current = data.data ?? {}
        if (data.event === 'CANCEL') setLoading(false)
        if (data.event === 'ERROR') {
          setError(data.data?.error_message ?? 'A Meta interrompeu a conexão.')
          setLoading(false)
        }
      } catch {
        // mensagens de outros produtos da Meta trafegam no mesmo canal
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const loadSdk = () =>
    new Promise<void>((resolve, reject) => {
      if (window.FB) return resolve()
      const script = document.createElement('script')
      script.src = 'https://connect.facebook.net/pt_BR/sdk.js'
      script.async = true
      script.onload = () => {
        window.FB?.init({ appId, autoLogAppEvents: true, xfbml: false, version: 'v22.0' })
        resolve()
      }
      script.onerror = () => reject(new Error('Não foi possível carregar o SDK do Facebook.'))
      document.body.appendChild(script)
    })

  const handleConnect = async () => {
    setLoading(true)
    setError(null)
    sessionInfo.current = {}
    try {
      await loadSdk()
      window.FB!.login(
        async (response) => {
          const code = response.authResponse?.code
          const { waba_id, phone_number_id } = sessionInfo.current
          if (!code || !waba_id || !phone_number_id) {
            setLoading(false)
            return // usuário fechou o popup — não é erro
          }
          const res = await fetch('/api/whatsapp/embedded-signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, waba_id, phone_number_id }),
          })
          const json = await res.json()
          if (!res.ok) {
            setError(json.error ?? 'Não foi possível concluir a conexão.')
            setLoading(false)
            return
          }
          window.location.href = '/configuracoes?whatsapp=connected'
        },
        {
          config_id: configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { sessionInfoVersion: '3' },
        }
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao iniciar a conexão.')
      setLoading(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('Desconectar o WhatsApp? A Clara para de responder os pacientes.')) return
    setLoading(true)
    await fetch('/api/bot/onboarding/disconnect', { method: 'DELETE' })
    window.location.reload()
  }

  if (isConnected) {
    return (
      <div className="flex items-center gap-3">
        <Badge className="border-none bg-green-50 text-green-700">
          ✓ Conectado{whatsappNumber ? ` — ${whatsappNumber}` : ''}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDisconnect}
          disabled={loading}
          className="border-red-200 text-red-500 hover:text-red-700"
        >
          Desconectar
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Button
        onClick={handleConnect}
        disabled={loading || !isConfigured}
        className="bg-[var(--cyan)] font-medium text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
      >
        {!isConfigured ? 'Integração em aprovação na Meta' : loading ? 'Conectando...' : 'Conectar WhatsApp'}
      </Button>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
}
```

Antes de escrever, leia o guia de scripts em `node_modules/next/dist/docs/` — se o projeto já tiver um padrão com `next/script`, use-o no lugar do `document.createElement`.

- [ ] **Step 2: Criar o card e ligá-lo à página**

Crie `components/configuracoes/MetaIntegrationsCard.tsx` com o mesmo invólucro visual dos outros cards (`rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]`), título "Integrações Meta", e dois blocos separados por `<Separator />`: "WhatsApp da Clara" (o botão acima) e "Anúncios do Facebook" (placeholder até a Task 9).

Em `SettingsClient.tsx`, dentro do bloco `canManageIntegrations`, renderize `<MetaIntegrationsCard ... />` **acima** do card do Google Agenda. No card "Configurações da Clara", troque o `Badge` de conexão por um texto neutro sobre personalidade/FAQ — o status agora vive num lugar só.

Em `app/(dashboard)/configuracoes/page.tsx`: acrescente `whatsapp` ao `searchParams` (`{ google?: string; whatsapp?: string; meta_ads?: string }`) com as tarjas verde/vermelha correspondentes, e passe para `SettingsClient` as props novas — `metaAppId: process.env.NEXT_PUBLIC_META_APP_ID ?? ''`, `metaConfigId: process.env.META_ES_CONFIG_ID ?? ''` e `whatsappConnected: Boolean(botConfig?.meta_token && botConfig?.phone_number_id)`.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm run lint`
Expected: limpo. (Rode o lint a partir da raiz do projeto, não de um worktree — ver `MEMORY.md`.)

- [ ] **Step 4: Conferir na tela**

Run: `npm run dev`, abra `/configuracoes` como owner.
Expected: card "Integrações Meta" com o botão do WhatsApp desabilitado e escrito "Integração em aprovação na Meta" (porque as env ainda não existem), sem nenhum resquício do wizard antigo em `/configuracoes/bot`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(configuracoes): card de integrações Meta com o botão do WhatsApp"
```

---

### Task 7: OAuth do Facebook Ads

**Files:**
- Create: `lib/meta/ads-oauth.ts`
- Test: `tests/meta/ads-oauth.test.ts`

**Interfaces:**
- Consumes: `graphFetch`, `MetaApiError` (Task 2); `encryptToken`/`decryptToken`
- Produces:
  - `ADS_SCOPES: string[]` (`['ads_read', 'business_management']`)
  - `getAdsAuthUrl(accountId: string): string`
  - `exchangeAdsCodeAndSave(code: string, accountId: string, connectedByUserId: string): Promise<void>`
  - `getValidAdsToken(accountId: string): Promise<string | null>` — devolve `null` quando não há conexão ou ela está marcada inválida
  - `markAdsConnectionInvalid(accountId: string): Promise<void>`
  - `isAdsConfigured(): boolean`

- [ ] **Step 1: Escrever os testes**

Crie `tests/meta/ads-oauth.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => g.supabase.client }))
vi.mock('@/lib/crypto', () => ({ encryptToken: (t: string) => `enc:${t}`, decryptToken: (t: string) => t.replace(/^enc:/, '') }))

import { getAdsAuthUrl, exchangeAdsCodeAndSave, getValidAdsToken } from '@/lib/meta/ads-oauth'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.stubEnv('NEXT_PUBLIC_META_APP_ID', 'app-123')
  vi.stubEnv('META_APP_SECRET', 'segredo')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.medscalebr.com')
  g.supabase = createSupabaseMock()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('getAdsAuthUrl', () => {
  it('pede ads_read e business_management e leva o accountId no state', () => {
    const url = new URL(getAdsAuthUrl('acc1'))

    expect(url.searchParams.get('client_id')).toBe('app-123')
    expect(url.searchParams.get('state')).toBe('acc1')
    expect(url.searchParams.get('scope')).toBe('ads_read,business_management')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.medscalebr.com/api/meta/ads/callback')
  })
})

describe('exchangeAdsCodeAndSave', () => {
  it('promove o token curto a longo e salva cifrado com validade', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'curto' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'longo', expires_in: 5184000 }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'fb-user-1' }), { status: 200 }))

    await exchangeAdsCodeAndSave('code-1', 'acc1', 'u1')

    const upsert = g.supabase.callsTo('meta_ads_connections', 'upsert')[0]
    expect(upsert.payload).toMatchObject({
      account_id: 'acc1',
      fb_user_id: 'fb-user-1',
      access_token: 'enc:longo',
      connected_by: 'u1',
      is_valid: true,
      scopes: ['ads_read', 'business_management'],
    })
    expect(new Date((upsert.payload as { token_expires_at: string }).token_expires_at).getTime()).toBeGreaterThan(
      Date.now()
    )
  })
})

describe('getValidAdsToken', () => {
  it('devolve o token decifrado quando a conexão é válida', async () => {
    g.supabase = createSupabaseMock({
      meta_ads_connections: {
        select: { data: { access_token: 'enc:longo', is_valid: true, token_expires_at: null }, error: null },
      },
    })

    await expect(getValidAdsToken('acc1')).resolves.toBe('longo')
  })

  it('devolve null quando a conexão foi marcada inválida', async () => {
    g.supabase = createSupabaseMock({
      meta_ads_connections: {
        select: { data: { access_token: 'enc:longo', is_valid: false, token_expires_at: null }, error: null },
      },
    })

    await expect(getValidAdsToken('acc1')).resolves.toBeNull()
  })

  it('devolve null quando não há conexão', async () => {
    g.supabase = createSupabaseMock({ meta_ads_connections: { select: { data: null, error: null } } })

    await expect(getValidAdsToken('acc1')).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/meta/ads-oauth.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

Crie `lib/meta/ads-oauth.ts`:

```ts
import { createAdminClient } from '@/lib/supabase/server'
import { encryptToken, decryptToken } from '@/lib/crypto'
import { graphFetch, GRAPH_VERSION } from './graph'

// OAuth do Facebook para leitura de métricas de anúncio. Segue o padrão do
// Google (lib/google/auth.ts): conexão única por account, state = accountId,
// token cifrado no banco.

export const ADS_SCOPES = ['ads_read', 'business_management'] as const

export function isAdsConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_META_APP_ID && process.env.META_APP_SECRET)
}

function redirectUri(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/meta/ads/callback`
}

export function getAdsAuthUrl(accountId: string): string {
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`)
  url.searchParams.set('client_id', process.env.NEXT_PUBLIC_META_APP_ID ?? '')
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('scope', ADS_SCOPES.join(','))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', accountId)
  return url.toString()
}

export async function exchangeAdsCodeAndSave(
  code: string,
  accountId: string,
  connectedByUserId: string
): Promise<void> {
  const short = await graphFetch<{ access_token: string }>('/oauth/access_token', {
    params: {
      client_id: process.env.NEXT_PUBLIC_META_APP_ID ?? '',
      client_secret: process.env.META_APP_SECRET ?? '',
      redirect_uri: redirectUri(),
      code,
    },
  })

  // Token curto dura horas; o longo dura ~60 dias e é o que viabiliza o cron.
  const long = await graphFetch<{ access_token: string; expires_in?: number }>('/oauth/access_token', {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: process.env.NEXT_PUBLIC_META_APP_ID ?? '',
      client_secret: process.env.META_APP_SECRET ?? '',
      fb_exchange_token: short.access_token,
    },
  })

  const me = await graphFetch<{ id: string }>('/me', { token: long.access_token, params: { fields: 'id' } })

  const supabase = createAdminClient()
  const { error } = await supabase.from('meta_ads_connections').upsert(
    {
      account_id: accountId,
      fb_user_id: me.id,
      access_token: encryptToken(long.access_token),
      token_expires_at: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null,
      scopes: [...ADS_SCOPES],
      connected_by: connectedByUserId,
      is_valid: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id' }
  )
  if (error) throw new Error(error.message)
}

export async function getValidAdsToken(accountId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('meta_ads_connections')
    .select('access_token, is_valid, token_expires_at')
    .eq('account_id', accountId)
    .maybeSingle()

  if (!data || !data.is_valid) return null
  if (data.token_expires_at && new Date(data.token_expires_at).getTime() < Date.now()) return null
  return decryptToken(data.access_token)
}

/** Chamado quando a Meta responde 190: a UI passa a pedir reconexão. */
export async function markAdsConnectionInvalid(accountId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from('meta_ads_connections')
    .update({ is_valid: false, updated_at: new Date().toISOString() })
    .eq('account_id', accountId)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/meta/ads-oauth.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/meta/ads-oauth.ts tests/meta/ads-oauth.test.ts
git commit -m "feat(meta): OAuth do Facebook Ads com token longo"
```

---

### Task 8: Rotas de conexão do Facebook Ads

**Files:**
- Create: `app/api/meta/ads/connect/route.ts`, `app/api/meta/ads/callback/route.ts`, `app/api/meta/ads/disconnect/route.ts`
- Test: `tests/meta/ads-callback.test.ts`

**Interfaces:**
- Consumes: `getAdsAuthUrl`, `exchangeAdsCodeAndSave` (Task 7)
- Produces: `GET /api/meta/ads/connect` (302), `GET /api/meta/ads/callback` (302 para `/configuracoes?meta_ads=connected|error`), `DELETE /api/meta/ads/disconnect`

**Emenda (review da Task 7) — nonce anti-CSRF, obrigatório:**

O `state` do OAuth é o `accountId` puro. Checar só "a sessão é membro do
`accountId` do `state`" **não** fecha o buraco: o atacante consente no Facebook
dele, pega um `code` válido, monta
`/api/meta/ads/callback?code=<code do atacante>&state=<accountId da vítima>` e
faz a vítima logada abrir o link. A sessão da vítima é legítima para aquele
`accountId`, a checagem passa, e o token do **atacante** fica gravado na conta
da vítima — login-CSRF clássico. (O mesmo buraco existe hoje em
`app/api/google/callback/route.ts`; precedente não é absolvição.)

Portanto, além da checagem de sessão/membership:

- `GET /api/meta/ads/connect` gera um valor aleatório imprevisível de uso único
  (`crypto.randomUUID()` serve) e o grava em cookie `httpOnly`, `secure`,
  `sameSite: 'lax'`, `path: '/api/meta/ads'`, com vida curta (10 min), antes de
  redirecionar para `getAdsAuthUrl`.
- `GET /api/meta/ads/callback` lê o cookie, compara com o valor esperado e
  **apaga o cookie** antes de qualquer troca de código. Se estiver ausente ou
  divergente, redireciona para `/configuracoes?meta_ads=error` **sem** chamar
  `exchangeAdsCodeAndSave`.
- O teste do callback ganha um caso: sessão válida + `accountId` válido +
  `code` válido, mas cookie ausente/divergente ⇒ `exchangeAdsCodeAndSave`
  **não** é chamado e a resposta é o 302 de erro.

- [ ] **Step 1: Escrever o teste do callback**

Crie `tests/meta/ads-callback.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  exchanged: [] as unknown[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client,
  createAdminClient: () => g.supabase.client,
}))
vi.mock('@/lib/meta/ads-oauth', () => ({
  exchangeAdsCodeAndSave: (...args: unknown[]) => {
    g.exchanged.push(args)
    return Promise.resolve()
  },
}))

import { GET } from '@/app/api/meta/ads/callback/route'

const call = (qs: string) => GET(new NextRequest(`http://localhost/api/meta/ads/callback${qs}`))

beforeEach(() => {
  g.exchanged = []
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.medscalebr.com')
})

describe('GET /api/meta/ads/callback', () => {
  it('salva a conexão quando o usuário é membro ativo da account do state', async () => {
    g.supabase = createSupabaseMock({ memberships: { select: { data: { account_id: 'acc1' }, error: null } } })
    g.supabase.client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })

    const res = await call('?code=c1&state=acc1')

    expect(res.headers.get('location')).toBe('https://app.medscalebr.com/configuracoes?meta_ads=connected')
    expect(g.exchanged).toEqual([['c1', 'acc1', 'u1']])
  })

  it('recusa state de account da qual o usuário não é membro', async () => {
    g.supabase = createSupabaseMock({ memberships: { select: { data: null, error: null } } })
    g.supabase.client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })

    const res = await call('?code=c1&state=acc-de-outro')

    expect(res.headers.get('location')).toBe('https://app.medscalebr.com/configuracoes?meta_ads=error')
    expect(g.exchanged).toEqual([])
  })

  it('manda para o login quando não há sessão', async () => {
    g.supabase = createSupabaseMock()
    g.supabase.client.auth.getUser.mockResolvedValue({ data: { user: null } })

    const res = await call('?code=c1&state=acc1')

    expect(res.headers.get('location')).toBe('https://app.medscalebr.com/login')
  })

  it('erro devolvido pela Meta vira redirect de erro', async () => {
    g.supabase = createSupabaseMock()

    const res = await call('?error=access_denied')

    expect(res.headers.get('location')).toBe('https://app.medscalebr.com/configuracoes?meta_ads=error')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/meta/ads-callback.test.ts`
Expected: FAIL — rota inexistente.

- [ ] **Step 3: Implementar as três rotas**

`app/api/meta/ads/connect/route.ts` — cópia estrutural de `app/api/google/connect/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getAdsAuthUrl, isAdsConfigured } from '@/lib/meta/ads-oauth'
import { requireWorkspaceSession, requireRole } from '@/lib/session/api'

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const roleCheck = requireRole(session, ['owner', 'admin'])
  if (roleCheck) return roleCheck

  if (!isAdsConfigured()) {
    return NextResponse.json({ error: 'Integração com o Facebook ainda não configurada.' }, { status: 503 })
  }

  return NextResponse.redirect(getAdsAuthUrl(session.accountId))
}
```

`app/api/meta/ads/callback/route.ts` — mesma defesa de `state` do callback do Google (`app/api/google/callback/route.ts:22-40`): exige usuário logado e membership ativa em `state` antes de chamar `exchangeAdsCodeAndSave(code, state, user.id)`; redireciona para `?meta_ads=connected` ou `?meta_ads=error`; sem sessão, para `/login`.

`app/api/meta/ads/disconnect/route.ts` — owner/admin; apaga a linha de `meta_ads_connections` e os `workspace_ad_accounts` da account; devolve `{ ok: true }`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/meta/ads-callback.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add app/api/meta/ads tests/meta/ads-callback.test.ts
git commit -m "feat(meta): rotas de conexão do Facebook Ads"
```

---

### Task 9: Mapeamento unidade → conta de anúncio

**Files:**
- Create: `app/api/meta/ads/accounts/route.ts`, `components/configuracoes/AdAccountMap.tsx`, `components/configuracoes/FacebookConnectButton.tsx`
- Modify: `components/configuracoes/MetaIntegrationsCard.tsx`, `components/configuracoes/SettingsClient.tsx`, `app/(dashboard)/configuracoes/page.tsx`

**Interfaces:**
- Consumes: `getValidAdsToken`, `markAdsConnectionInvalid` (Task 7); `graphFetch`, `MetaApiError` (Task 2)
- Produces:
  - `GET /api/meta/ads/accounts` → `{ adAccounts: { id: string; name: string }[] }` (`id` no formato `act_<n>`)
  - `PUT /api/meta/ads/accounts` recebendo `{ workspace_id, ad_account_id | null, ad_account_name }`
  - `<AdAccountMap workspaces={{ id, name, adAccountId }[]} />`

- [ ] **Step 1: Implementar a rota de contas**

Crie `app/api/meta/ads/accounts/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireRole } from '@/lib/session/api'
import { getValidAdsToken, markAdsConnectionInvalid } from '@/lib/meta/ads-oauth'
import { graphFetch, MetaApiError } from '@/lib/meta/graph'

const NO_CONNECTION = 'Conecte sua conta do Facebook primeiro.'
const EXPIRED = 'Sua conexão com o Facebook expirou. Reconecte nas configurações.'

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const roleCheck = requireRole(session, ['owner', 'admin'])
  if (roleCheck) return roleCheck

  const token = await getValidAdsToken(session.accountId)
  if (!token) return NextResponse.json({ error: NO_CONNECTION }, { status: 409 })

  try {
    const data = await graphFetch<{ data: { account_id: string; name: string }[] }>('/me/adaccounts', {
      token,
      params: { fields: 'account_id,name', limit: '200' },
    })
    return NextResponse.json({
      adAccounts: (data.data ?? []).map((a) => ({ id: `act_${a.account_id}`, name: a.name })),
    })
  } catch (err) {
    if (err instanceof MetaApiError && err.isTokenExpired) {
      await markAdsConnectionInvalid(session.accountId)
      return NextResponse.json({ error: EXPIRED }, { status: 409 })
    }
    return NextResponse.json(
      { error: `Não foi possível listar suas contas de anúncio: ${err instanceof Error ? err.message : err}` },
      { status: 502 }
    )
  }
}

export async function PUT(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const roleCheck = requireRole(session, ['owner', 'admin'])
  if (roleCheck) return roleCheck

  const { workspace_id, ad_account_id, ad_account_name } = await req.json()
  if (!workspace_id) return NextResponse.json({ error: 'workspace_id é obrigatório' }, { status: 400 })

  const supabase = await createClient()

  // A unidade precisa ser da account da sessão — sem isso o usuário poderia
  // mapear a conta de anúncio dele numa unidade de outra clínica.
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id')
    .eq('id', workspace_id)
    .eq('account_id', session.accountId)
    .maybeSingle()

  if (!workspace) return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })

  // Uma conta de anúncio por unidade na UI: limpa o vínculo anterior antes.
  await supabase.from('workspace_ad_accounts').delete().eq('workspace_id', workspace_id)

  if (!ad_account_id) return NextResponse.json({ ok: true, adAccountId: null })

  const { error } = await supabase.from('workspace_ad_accounts').insert({
    workspace_id,
    account_id: session.accountId,
    ad_account_id,
    ad_account_name: ad_account_name ?? null,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, adAccountId: ad_account_id })
}
```

- [ ] **Step 2: Criar os componentes de UI**

`FacebookConnectButton.tsx`: espelho do `GoogleConnectButton`, com três estados — não conectado (botão azul `#1877F2` "Login com Facebook"), conectado (badge verde "✓ Conectado" + "N de M unidades mapeadas" + botão Desconectar chamando `/api/meta/ads/disconnect`) e inválido (badge âmbar "Conexão expirada" + botão "Reconectar com Facebook" apontando para `/api/meta/ads/connect`).

`AdAccountMap.tsx`: mesma estrutura de `WorkspaceCalendarMap.tsx` — `useEffect` carrega `/api/meta/ads/accounts`, uma linha por unidade com `Select` das contas, `PUT` por linha ao trocar, estados `savingId`/`rowError` por linha. Um item "Nenhuma" no topo para desvincular.

Em `MetaIntegrationsCard.tsx`, substitua o placeholder da Task 6 pelo `FacebookConnectButton` e, quando conectado, pelo `AdAccountMap` abaixo de um `<Separator />`.

- [ ] **Step 3: Carregar os dados na página**

Em `app/(dashboard)/configuracoes/page.tsx`, acrescente ao `Promise.all`:

```ts
    supabase
      .from('meta_ads_connections')
      .select('fb_user_id, is_valid, token_expires_at')
      .eq('account_id', session.accountId)
      .maybeSingle(),
    supabase
      .from('workspace_ad_accounts')
      .select('workspace_id, ad_account_id, ad_account_name')
      .eq('account_id', session.accountId),
```

e passe para `SettingsClient` um objeto `metaAds={{ connected, isValid, mappedCount, workspaces: [...] }}`, onde `workspaces` reusa a lista já carregada de unidades, acrescentando `adAccountId` de cada vínculo. Trate `?meta_ads=connected|error` com as mesmas tarjas.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: limpo, suíte passando.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(configuracoes): login com Facebook e mapeamento unidade -> conta de anúncio"
```

---

### Task 10: Sync de insights para `ad_campaigns`

**Files:**
- Create: `lib/meta/ads-sync.ts`
- Modify: `tests/helpers/supabase-mock.ts` (gravar as opções do `upsert` — ver Step 0)
- Test: `tests/meta/ads-sync.test.ts`

**Interfaces:**
- Consumes: `getValidAdsToken`, `markAdsConnectionInvalid` (Task 7); `graphFetch`, `MetaApiError` (Task 2)
- Produces:
  - `LEAD_ACTION_TYPES: string[]`
  - `extractLeads(actions?: { action_type: string; value: string }[]): number`
  - `syncAdsForAccount(accountId: string, opts?: { days?: number }): Promise<{ synced: number; skipped: 'no_token' | 'token_expired' | null }>`
  - `SYNC_WINDOW_DAYS = 7`

- [ ] **Step 0: Fazer o mock do Supabase gravar as opções do `upsert`**

Hoje `tests/helpers/supabase-mock.ts:132` é `upsert: (payload: unknown) => makeBuilder(table, 'upsert', payload)` — o segundo argumento (`{ onConflict }`) é **descartado**. Sem ele, o teste de idempotência não tem como provar que o conflito declarado é o do índice parcial. Mudança aditiva, não quebra suíte existente:

```ts
// em RecordedCall
  /** opções de insert/update/upsert, ex: { onConflict: 'a,b' } */
  options?: unknown
```

```ts
// na fábrica do builder
  function makeBuilder(table: string, op: RecordedCall['op'], payload?: unknown, options?: unknown) {
    const call: RecordedCall = { table, op, payload, options, filters: [] }
```

```ts
// no objeto devolvido por from()
        insert: (payload: unknown, options?: unknown) => makeBuilder(table, 'insert', payload, options),
        update: (payload: unknown, options?: unknown) => makeBuilder(table, 'update', payload, options),
        upsert: (payload: unknown, options?: unknown) => makeBuilder(table, 'upsert', payload, options),
```

Run: `npm test` — a suíte inteira deve continuar passando antes de você seguir.

- [ ] **Step 1: Escrever os testes**

Crie `tests/meta/ads-sync.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  token: 'tok' as string | null,
  invalidated: [] as string[],
}))

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => g.supabase.client }))
vi.mock('@/lib/meta/ads-oauth', () => ({
  getValidAdsToken: () => Promise.resolve(g.token),
  markAdsConnectionInvalid: (id: string) => {
    g.invalidated.push(id)
    return Promise.resolve()
  },
}))

import { syncAdsForAccount, extractLeads } from '@/lib/meta/ads-sync'

const insights = (rows: unknown[]) => new Response(JSON.stringify({ data: rows }), { status: 200 })

beforeEach(() => {
  g.token = 'tok'
  g.invalidated = []
  vi.stubGlobal('fetch', vi.fn())
  g.supabase = createSupabaseMock({
    workspace_ad_accounts: {
      select: { data: [{ workspace_id: 'w1', ad_account_id: 'act_1', account_id: 'acc1' }], error: null },
    },
    ad_campaigns: { upsert: { data: null, error: null } },
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractLeads', () => {
  it('soma os tipos de ação que representam lead', () => {
    expect(
      extractLeads([
        { action_type: 'lead', value: '3' },
        { action_type: 'onsite_conversion.lead_grouped', value: '2' },
        { action_type: 'link_click', value: '99' },
      ])
    ).toBe(5)
  })

  it('devolve 0 sem ações', () => {
    expect(extractLeads(undefined)).toBe(0)
  })
})

describe('syncAdsForAccount', () => {
  it('grava uma linha por campanha por dia com source meta_sync', async () => {
    vi.mocked(fetch).mockResolvedValue(
      insights([
        {
          campaign_id: 'c-1',
          campaign_name: 'Implantes - SP',
          date_start: '2026-09-10',
          date_stop: '2026-09-10',
          spend: '150.50',
          impressions: '2000',
          clicks: '80',
          actions: [{ action_type: 'lead', value: '4' }],
        },
      ])
    )

    const result = await syncAdsForAccount('acc1')

    expect(result).toEqual({ synced: 1, skipped: null })
    const upsert = g.supabase.callsTo('ad_campaigns', 'upsert')[0]
    expect(upsert.payload).toMatchObject([
      {
        workspace_id: 'w1',
        account_id: 'acc1',
        channel: 'facebook',
        source: 'meta_sync',
        external_campaign_id: 'c-1',
        campaign_name: 'Implantes - SP',
        period_start: '2026-09-10',
        period_end: '2026-09-10',
        spend: 150.5,
        impressions: 2000,
        clicks: 80,
        leads: 4,
      },
    ])
  })

  it('é idempotente: roda duas vezes com onConflict e não duplica', async () => {
    vi.mocked(fetch).mockResolvedValue(
      insights([
        {
          campaign_id: 'c-1',
          campaign_name: 'Implantes - SP',
          date_start: '2026-09-10',
          date_stop: '2026-09-10',
          spend: '150.50',
          impressions: '2000',
          clicks: '80',
        },
      ])
    )

    await syncAdsForAccount('acc1')
    await syncAdsForAccount('acc1')

    const calls = g.supabase.callsTo('ad_campaigns', 'upsert')
    expect(calls).toHaveLength(2)
    // O upsert precisa declarar o conflito no índice parcial do sync, senão
    // a segunda rodada insere linha nova em vez de atualizar.
    expect(calls.every((c) => (c.options as { onConflict?: string })?.onConflict === 'workspace_id,external_campaign_id,period_start')).toBe(true)
  })

  it('nunca escreve em linhas manuais (só upsert com source meta_sync)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      insights([
        { campaign_id: 'c-1', campaign_name: 'X', date_start: '2026-09-10', date_stop: '2026-09-10', spend: '1' },
      ])
    )

    await syncAdsForAccount('acc1')

    expect(g.supabase.callsTo('ad_campaigns', 'update')).toHaveLength(0)
    expect(g.supabase.callsTo('ad_campaigns', 'delete')).toHaveLength(0)
    const payload = g.supabase.callsTo('ad_campaigns', 'upsert')[0].payload as Array<{ source: string }>
    expect(payload.every((row) => row.source === 'meta_sync')).toBe(true)
  })

  it('sem token, não chama a Meta', async () => {
    g.token = null

    const result = await syncAdsForAccount('acc1')

    expect(result).toEqual({ synced: 0, skipped: 'no_token' })
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('token expirado marca a conexão como inválida', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'expired', code: 190 } }), { status: 401 })
    )

    const result = await syncAdsForAccount('acc1')

    expect(result.skipped).toBe('token_expired')
    expect(g.invalidated).toEqual(['acc1'])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/meta/ads-sync.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

Crie `lib/meta/ads-sync.ts`:

```ts
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { getValidAdsToken, markAdsConnectionInvalid } from './ads-oauth'
import { graphFetch, MetaApiError } from './graph'

// A Meta reescreve números retroativamente por atribuição, então re-sincronizar
// a última semana é o que mantém o histórico honesto. O upsert é idempotente
// (índice parcial uq_ad_campaigns_meta_sync), logo reprocessar é barato.
export const SYNC_WINDOW_DAYS = 7

export const LEAD_ACTION_TYPES = [
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
]

interface InsightRow {
  campaign_id: string
  campaign_name?: string
  date_start: string
  date_stop: string
  spend?: string
  impressions?: string
  clicks?: string
  actions?: { action_type: string; value: string }[]
}

export function extractLeads(actions?: { action_type: string; value: string }[]): number {
  if (!actions) return 0
  return actions
    .filter((a) => LEAD_ACTION_TYPES.includes(a.action_type))
    .reduce((sum, a) => sum + Number(a.value ?? 0), 0)
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export async function syncAdsForAccount(
  accountId: string,
  opts: { days?: number } = {}
): Promise<{ synced: number; skipped: 'no_token' | 'token_expired' | null }> {
  const token = await getValidAdsToken(accountId)
  if (!token) return { synced: 0, skipped: 'no_token' }

  const supabase = createAdminClient()
  const { data: mappings } = await supabase
    .from('workspace_ad_accounts')
    .select('workspace_id, ad_account_id, account_id')
    .eq('account_id', accountId)

  if (!mappings?.length) return { synced: 0, skipped: null }

  const days = opts.days ?? SYNC_WINDOW_DAYS
  const timeRange = JSON.stringify({ since: isoDaysAgo(days), until: isoDaysAgo(0) })
  let synced = 0

  for (const mapping of mappings) {
    let rows: InsightRow[]
    try {
      const data = await graphFetch<{ data: InsightRow[] }>(`/${mapping.ad_account_id}/insights`, {
        token,
        params: {
          level: 'campaign',
          time_increment: '1',
          time_range: timeRange,
          fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions',
          limit: '500',
        },
      })
      rows = data.data ?? []
    } catch (err) {
      if (err instanceof MetaApiError && err.isTokenExpired) {
        await markAdsConnectionInvalid(accountId)
        return { synced, skipped: 'token_expired' }
      }
      // Uma conta de anúncio quebrada não pode derrubar as outras.
      Sentry.captureException(err, { tags: { area: 'meta', flow: 'ads_sync' }, extra: { adAccount: mapping.ad_account_id } })
      continue
    }

    if (!rows.length) continue

    const payload = rows.map((row) => ({
      workspace_id: mapping.workspace_id,
      account_id: accountId,
      channel: 'facebook' as const,
      source: 'meta_sync' as const,
      external_campaign_id: row.campaign_id,
      campaign_name: row.campaign_name ?? null,
      period_start: row.date_start,
      period_end: row.date_stop,
      spend: Number(row.spend ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      leads: extractLeads(row.actions),
    }))

    const { error } = await supabase
      .from('ad_campaigns')
      .upsert(payload, { onConflict: 'workspace_id,external_campaign_id,period_start' })

    if (error) {
      Sentry.captureException(new Error(error.message), { tags: { area: 'meta', flow: 'ads_sync' } })
      continue
    }
    synced += payload.length
  }

  return { synced, skipped: null }
}
```

O `onConflict` vai como segundo argumento do `.upsert()`, que é exatamente o que o Step 0 fez o mock gravar.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/meta/ads-sync.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/meta/ads-sync.ts tests/meta/ads-sync.test.ts
git commit -m "feat(meta): sync idempotente de insights para ad_campaigns"
```

---

### Task 11: Disparo do sync (sob demanda e cron)

**Files:**
- Create: `app/api/meta/ads/sync/route.ts`, `app/api/cron/meta-ads-sync/route.ts`
- Modify: `supabase/cron.sql`, `components/trafego/CampaignsClient.tsx`

**Interfaces:**
- Consumes: `syncAdsForAccount` (Task 10); `requireCronAuth` de `lib/cron-auth`
- Produces: `POST /api/meta/ads/sync` → `{ synced, skipped }`; `POST /api/cron/meta-ads-sync` → `{ accounts, synced }`

- [ ] **Step 1: Rota sob demanda**

Crie `app/api/meta/ads/sync/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceSession, requireRole } from '@/lib/session/api'
import { syncAdsForAccount } from '@/lib/meta/ads-sync'

export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const roleCheck = requireRole(session, ['owner', 'admin'])
  if (roleCheck) return roleCheck

  const { synced, skipped } = await syncAdsForAccount(session.accountId)

  if (skipped === 'no_token') {
    return NextResponse.json({ error: 'Conecte sua conta do Facebook primeiro.' }, { status: 409 })
  }
  if (skipped === 'token_expired') {
    return NextResponse.json(
      { error: 'Sua conexão com o Facebook expirou. Reconecte nas configurações.' },
      { status: 409 }
    )
  }

  return NextResponse.json({ ok: true, synced })
}
```

- [ ] **Step 2: Rota de cron**

`app/api/cron/meta-ads-sync/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/server'
import { syncAdsForAccount } from '@/lib/meta/ads-sync'

// Disparado pelo Supabase pg_cron (ver supabase/cron.sql) uma vez por dia.
// Uma account com token expirado é pulada e marcada; as demais seguem.
export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const supabase = createAdminClient()
  const { data: connections } = await supabase
    .from('meta_ads_connections')
    .select('account_id')
    .eq('is_valid', true)

  let synced = 0
  for (const conn of connections ?? []) {
    const result = await syncAdsForAccount(conn.account_id)
    synced += result.synced
  }

  return NextResponse.json({ accounts: connections?.length ?? 0, synced })
}
```

- [ ] **Step 3: Agendar no pg_cron**

Em `supabase/cron.sql`, acrescente antes da seção "3. VERIFICAÇÃO", no formato dos jobs existentes:

```sql
select cron.schedule(
  'meta-ads-sync',
  '30 6 * * *',
  $$
    select net.http_post(
      url     := 'https://app.medscalebr.com/api/cron/meta-ads-sync',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || public.cron_secret()
      ),
      body    := '{}'::jsonb
    );
  $$
);
```

- [ ] **Step 4: Botão "Atualizar agora" em `/trafego`**

Em `components/trafego/CampaignsClient.tsx`, ao lado de "Nova campanha", adicione um botão secundário que chama `POST /api/meta/ads/sync`, mostra "Atualizando..." enquanto roda, recarrega a lista ao terminar e exibe o erro devolvido quando houver. Na tabela, acrescente um selo discreto "sincronizado" nas linhas com `source === 'meta_sync'`, para a equipe não tentar editar à mão o que o sync vai sobrescrever.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npm test`
Expected: limpo, suíte passando.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(trafego): sync do Facebook por cron diário e sob demanda"
```

---

### Task 12: Configuração de ambiente e fechamento

**Files:**
- Modify: `.env.local.example`, `docs/superpowers/specs/2026-09-16-integracoes-meta-design.md`

- [ ] **Step 1: Documentar as variáveis**

Em `.env.local.example`, na seção "Meta / WhatsApp Cloud API":

```
# App Meta da MedScale (Tech Provider). NEXT_PUBLIC_META_APP_ID é exposto ao
# browser pelo SDK do Embedded Signup — é público por natureza.
NEXT_PUBLIC_META_APP_ID=
# ID da configuração de Embedded Signup criada no painel do App.
META_ES_CONFIG_ID=
# Versão da Graph API usada pelo código novo (default v22.0).
META_GRAPH_VERSION=
```

- [ ] **Step 2: Marcar o spec como implementado**

No cabeçalho do spec, troque `Status: design aprovado (aguardando revisão do spec)` por `Status: implementado (plano: docs/superpowers/plans/2026-09-16-integracoes-meta.md)`.

- [ ] **Step 3: Rodar a verificação completa**

Run: `npm run lint && npm test && npm run build`
Expected: os três limpos. Se `npm run build` estourar memória, confirme que está rodando na raiz e não dentro de um worktree (ver `MEMORY.md`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(meta): variáveis de ambiente das integrações Meta"
```

---

## Checklist de aceitação manual

Depois que a Meta liberar o Acesso Avançado (ou com o usuário logado como testador do App):

1. `/configuracoes` como owner mostra o card "Integrações Meta" com os dois botões.
2. "Conectar WhatsApp" abre o popup da Meta; ao concluir, a página volta com a tarja verde e o badge mostra o número.
3. Uma mensagem enviada ao número cai no webhook e a Clara responde — prova de que o `subscribed_apps` funcionou.
4. "Desconectar" limpa o badge e a Clara para de responder.
5. "Login com Facebook" conecta, lista as contas de anúncio e salva o mapeamento por unidade.
6. "Atualizar agora" em `/trafego` traz as campanhas do Facebook dos últimos 7 dias; rodar de novo não duplica nenhuma linha; as campanhas digitadas à mão continuam lá, intactas.
7. `/configuracoes/bot` não tem mais nenhum campo de token, App Secret ou Phone Number ID.
