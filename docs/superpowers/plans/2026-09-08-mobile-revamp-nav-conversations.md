# Repaginada mobile — tab bar + caixa de conversas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o dashboard MedScale usável no celular: navegação primária por tab bar inferior fixa, Topbar enxuta, caixa de conversas com um painel por vez, e primitivos compartilhados (viewport/safe-area, zoom de input, padding, alvos de toque, tabelas → cartões).

**Architecture:** Uma tab bar inferior `md:hidden` nova é montada no layout do dashboard; a lógica de "quais abas" sai para um módulo puro `lib/nav/tabs.ts` (testável em node). A gaveta lateral existente (`Sheet`) passa a ser aberta pela aba "Mais" e ganha um corpo compartilhado. `BotInboxClient` mostra lista **ou** detalhe no `< md` (detalhe como overlay `fixed inset-0 z-50`), mantendo o grid de dois painéis **intacto** no `md+`. Três tabelas pesadas ganham uma camada de cartões `md:hidden`.

**Tech Stack:** Next.js 16.3 (App Router, RSC), React 19, Tailwind v4, `@base-ui/react` (Sheet/Dialog/Dropdown), lucide-react, Vitest (env `node`).

**Spec:** `docs/superpowers/specs/2026-09-08-mobile-revamp-nav-conversations-design.md`

## Global Constraints

- **Breakpoint mobile:** `< md` (768 px, default do Tailwind). Tudo que é "mobile" usa `md:hidden` / `hidden md:...` / `md:` overrides. **O layout do desktop (`md+`) não pode mudar de comportamento em nenhuma tela.**
- **Sem nova infra de teste.** O repo roda Vitest em `environment: 'node'`, sem `@testing-library/react`, e **não testa componentes React** (só lógica pura e handlers). Não adicione jsdom/RTL. Lógica testável vai para módulos `.ts` puros e é feita por TDD; tarefas de UI/CSS são verificadas por `npm run lint` + `npx tsc --noEmit` + checklist visual em viewport de 375 px.
- **Gates de cada tarefa (rodar da raiz do repo):**
  - `npm test` — suíte Vitest inteira (deve continuar verde; baseline atual: verde).
  - `npx tsc --noEmit` — typecheck (baseline atual: exit 0).
  - `npm run lint` — ESLint (`eslint-config-next`).
- **Commits frequentes:** um commit por tarefa concluída, mensagem em pt-BR no estilo do repo (`feat(mobile): …`, `refactor(nav): …`, `fix(mobile): …`). Terminar a mensagem com:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
- **Não abrir PR.** Só commitar na branch atual (`dev`). O usuário abre o PR.
- **Cores/tokens:** usar as CSS vars existentes (`--navy`, `--navy-dark`, `--cyan`, `--cyan-10`, `--navy-06`, `--w10`, `--w40`, `--w60`, `--w70`). Não introduzir cores cruas novas.
- **Rótulos dos módulos:** copiar **exatamente** de `MODULE_NAV` em `components/layout/NavLinks.tsx` (ex.: `Meu painel`, `Minha agenda`, `Conversas`, `Meus pacientes`, `Configuração`).
- **Safe area:** conteúdo preso ao fundo usa `env(safe-area-inset-bottom)`.
- Badge de atenção na aba Conversas: **fora da v1** — não implementar.

---

## Estrutura de arquivos

**Criar:**
- `lib/nav/tabs.ts` — dados de rota/rótulo por módulo + funções puras: `isModuleVisible`, `pickPrimaryTabs`, `moduleTitleFromPath`. Sem React. (Tarefa 1)
- `tests/nav/tabs.test.ts` — testes das funções puras. (Tarefa 1)
- `lib/auth/use-logout.ts` — hook client que encapsula o logout (Supabase signOut + `posthog.reset()` + redirect). (Tarefa 3)
- `components/layout/MobileDrawerContent.tsx` — corpo da gaveta (switchers + `NavLinks` + bloco conta/papel + linha "Sair"). (Tarefa 3)
- `components/layout/MobileTabBar.tsx` — a tab bar inferior fixa + a aba "Mais" que abre a gaveta. (Tarefa 4)

**Modificar:**
- `components/layout/NavLinks.tsx` — passa a importar dados/regra de `lib/nav/tabs.ts` (DRY); comportamento idêntico. (Tarefa 1)
- `app/layout.tsx` — `export const viewport`. (Tarefa 2)
- `app/globals.css` — utilitários de safe-area + backstop de 16 px para inputs no mobile. (Tarefa 2)
- `components/ui/sheet.tsx` — backdrop mais forte, sem blur; X com área de 44 px. (Tarefa 3)
- `components/layout/Topbar.tsx` — mobile: título da tela + avatar; esconde nome/e-mail; remove `<MobileNav>`. (Tarefa 5)
- `app/(dashboard)/layout.tsx` — renderiza `<MobileTabBar>`; ajusta padding do `<main>`. (Tarefa 5)
- `components/bot/BotInboxClient.tsx` — estado `mobilePane`; lista-só / overlay do detalhe no `< md`. (Tarefa 6)
- `components/bot/ConversationDetail.tsx` — prop `onBack?`; chevron voltar + ações no `⋯` no mobile; barra de status empilha. (Tarefa 6)
- `components/bot/ConversationList.tsx` — `<input>` de busca `text-base`; linha do checkbox com alvo de 44 px. (Tarefa 6)
- `components/finance/FinanceEntryTable.tsx` — camada de cartões `md:hidden`. (Tarefa 7)
- `components/pacientes/PatientsClient.tsx` — camada de cartões `md:hidden`. (Tarefa 8)
- `components/receita/RevenueClient.tsx` — camada de cartões `md:hidden` nas duas tabelas. (Tarefa 9)

**Deletar:**
- `components/layout/MobileNav.tsx` — substituído por `MobileTabBar` + `MobileDrawerContent`. (Tarefa 5)

---

## Task 1: Módulo puro de navegação `lib/nav/tabs.ts` + refactor de NavLinks

**Files:**
- Create: `lib/nav/tabs.ts`
- Test: `tests/nav/tabs.test.ts`
- Modify: `components/layout/NavLinks.tsx`

**Interfaces:**
- Consumes: `ModuleSlug` de `@/lib/session/context`; `MembershipRole` de `@/types/database`.
- Produces:
  - `MODULE_ROUTES: Record<ModuleSlug, { href: string; label: string }>`
  - `OWNER_ONLY_MODULES: ModuleSlug[]`, `ADMIN_MIN_MODULES: ModuleSlug[]`
  - `PRIMARY_TAB_ORDER: ModuleSlug[]`, `MAX_PRIMARY_TABS: number`
  - `isModuleVisible(slug: ModuleSlug, userModules: ModuleSlug[], role: MembershipRole): boolean`
  - `pickPrimaryTabs(userModules: ModuleSlug[], role: MembershipRole): ModuleSlug[]`
  - `moduleTitleFromPath(pathname: string): string`

- [ ] **Step 1: Write the failing test**

Create `tests/nav/tabs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  isModuleVisible,
  pickPrimaryTabs,
  moduleTitleFromPath,
  MODULE_ROUTES,
} from '@/lib/nav/tabs'
import type { ModuleSlug } from '@/lib/session/context'

const ALL: ModuleSlug[] = [
  'dashboard', 'agenda', 'conversations', 'locations', 'schedule',
  'waitlist', 'campaigns', 'patients', 'settings', 'transcriptions',
  'finance', 'revenue_cycle',
]

describe('isModuleVisible', () => {
  it('esconde módulo fora de userModules', () => {
    expect(isModuleVisible('agenda', ['dashboard'], 'owner')).toBe(false)
  })
  it('finance só para owner', () => {
    expect(isModuleVisible('finance', ['finance'], 'owner')).toBe(true)
    expect(isModuleVisible('finance', ['finance'], 'admin')).toBe(false)
    expect(isModuleVisible('finance', ['finance'], 'member')).toBe(false)
  })
  it('revenue_cycle nega member, libera admin/owner', () => {
    expect(isModuleVisible('revenue_cycle', ['revenue_cycle'], 'member')).toBe(false)
    expect(isModuleVisible('revenue_cycle', ['revenue_cycle'], 'admin')).toBe(true)
    expect(isModuleVisible('revenue_cycle', ['revenue_cycle'], 'owner')).toBe(true)
  })
})

describe('pickPrimaryTabs', () => {
  it('as 4 primárias na ordem fixa quando todas visíveis', () => {
    expect(pickPrimaryTabs(ALL, 'owner')).toEqual([
      'dashboard', 'agenda', 'conversations', 'patients',
    ])
  })
  it('pula as não visíveis sem completar com outras', () => {
    expect(pickPrimaryTabs(['dashboard', 'patients'], 'owner')).toEqual([
      'dashboard', 'patients',
    ])
  })
  it('nunca passa de 4', () => {
    expect(pickPrimaryTabs(ALL, 'owner').length).toBeLessThanOrEqual(4)
  })
})

describe('moduleTitleFromPath', () => {
  it('rota exata do módulo', () => {
    expect(moduleTitleFromPath('/dashboard')).toBe('Meu painel')
    expect(moduleTitleFromPath('/bot')).toBe('Conversas')
  })
  it('subrota casa pelo prefixo mais longo', () => {
    expect(moduleTitleFromPath('/pacientes/123')).toBe('Meus pacientes')
    expect(moduleTitleFromPath('/configuracoes/bot')).toBe('Configuração')
  })
  it('rota desconhecida devolve string vazia', () => {
    expect(moduleTitleFromPath('/nao-existe')).toBe('')
  })
})

describe('MODULE_ROUTES', () => {
  it('cobre os mesmos slugs e rótulos de NavLinks', () => {
    expect(MODULE_ROUTES.dashboard).toEqual({ href: '/dashboard', label: 'Meu painel' })
    expect(MODULE_ROUTES.conversations).toEqual({ href: '/bot', label: 'Conversas' })
    expect(MODULE_ROUTES.revenue_cycle).toEqual({ href: '/ciclo-receita', label: 'Ciclo de receita' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/nav/tabs.test.ts`
Expected: FAIL — `Cannot find module '@/lib/nav/tabs'`.

- [ ] **Step 3: Create `lib/nav/tabs.ts`**

```ts
import type { MembershipRole } from '@/types/database'
import type { ModuleSlug } from '@/lib/session/context'

// Rota real + rótulo curto de cada módulo. Extraído de MODULE_NAV
// (components/layout/NavLinks.tsx) para ser importável sem React — a tab bar
// mobile e os testes usam isto direto. NavLinks.tsx remonta MODULE_NAV
// juntando o ícone a cada entrada daqui.
export const MODULE_ROUTES: Record<ModuleSlug, { href: string; label: string }> = {
  dashboard: { href: '/dashboard', label: 'Meu painel' },
  agenda: { href: '/agenda', label: 'Minha agenda' },
  conversations: { href: '/bot', label: 'Conversas' },
  locations: { href: '/locais', label: 'Meus locais' },
  schedule: { href: '/expediente', label: 'Meu expediente' },
  waitlist: { href: '/lista-espera', label: 'Lista de espera' },
  campaigns: { href: '/trafego', label: 'Atribuição' },
  patients: { href: '/pacientes', label: 'Meus pacientes' },
  settings: { href: '/configuracoes', label: 'Configuração' },
  transcriptions: { href: '/transcricoes', label: 'Transcrições' },
  finance: { href: '/finance', label: 'Financeiro' },
  revenue_cycle: { href: '/ciclo-receita', label: 'Ciclo de receita' },
}

// Só o owner vê estes módulos, mesmo ativos no account.
export const OWNER_ONLY_MODULES: ModuleSlug[] = ['finance']

// Exigem no mínimo papel admin.
export const ADMIN_MIN_MODULES: ModuleSlug[] = ['revenue_cycle']

// Mesma regra do antigo NavLinks.isVisible.
export function isModuleVisible(
  slug: ModuleSlug,
  userModules: ModuleSlug[],
  role: MembershipRole,
): boolean {
  return (
    userModules.includes(slug) &&
    (role === 'owner' || !OWNER_ONLY_MODULES.includes(slug)) &&
    (role !== 'member' || !ADMIN_MIN_MODULES.includes(slug))
  )
}

// Prioridade das abas primárias da tab bar mobile: as N primeiras visíveis
// entram; o resto fica sob "Mais".
export const PRIMARY_TAB_ORDER: ModuleSlug[] = [
  'dashboard',
  'agenda',
  'conversations',
  'patients',
]

export const MAX_PRIMARY_TABS = 4

export function pickPrimaryTabs(
  userModules: ModuleSlug[],
  role: MembershipRole,
): ModuleSlug[] {
  return PRIMARY_TAB_ORDER
    .filter((slug) => isModuleVisible(slug, userModules, role))
    .slice(0, MAX_PRIMARY_TABS)
}

// Título da tela para a Topbar mobile: casa o pathname com o href de módulo
// mais longo que o prefixa. '' quando nada casa.
export function moduleTitleFromPath(pathname: string): string {
  let best: { href: string; label: string } | null = null
  for (const entry of Object.values(MODULE_ROUTES)) {
    const hit = pathname === entry.href || pathname.startsWith(entry.href + '/')
    if (hit && (!best || entry.href.length > best.href.length)) best = entry
  }
  return best?.label ?? ''
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/nav/tabs.test.ts`
Expected: PASS (todos os `describe` verdes).

- [ ] **Step 5: Refactor `NavLinks.tsx` to consume the module (DRY, no behavior change)**

In `components/layout/NavLinks.tsx`:

1. Add import at the top (after the existing type imports):

```ts
import { MODULE_ROUTES, OWNER_ONLY_MODULES, ADMIN_MIN_MODULES, isModuleVisible } from '@/lib/nav/tabs'
```

2. Replace the `MODULE_NAV` object literal (currently `lines 33-47`) with a build from `MODULE_ROUTES` + icons:

```ts
const MODULE_ICONS: Record<ModuleSlug, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  agenda: CalendarDays,
  conversations: MessageCircle,
  locations: MapPin,
  schedule: Clock,
  waitlist: Hourglass,
  campaigns: TrendingUp,
  patients: Users,
  settings: Settings,
  transcriptions: FileAudio,
  finance: Wallet,
  revenue_cycle: Receipt,
}

export const MODULE_NAV: Record<ModuleSlug, NavItem> = Object.fromEntries(
  (Object.keys(MODULE_ROUTES) as ModuleSlug[]).map((slug) => [
    slug,
    { ...MODULE_ROUTES[slug], icon: MODULE_ICONS[slug] },
  ]),
) as Record<ModuleSlug, NavItem>
```

3. Delete the now-duplicated local `const OWNER_ONLY_MODULES` and `const ADMIN_MIN_MODULES` (currently `lines 73` and `78`) — they come from the import now. Keep `OVERRIDABLE_MODULES`, `NAV_GROUPS`, `NAV_ORDER` exactly as they are.

4. Replace the local `isVisible` (currently `lines 102-105`) with a call to the shared function:

```ts
const isVisible = (slug: ModuleSlug) => isModuleVisible(slug, userModules, role)
```

- [ ] **Step 6: Verify no behavior change**

Run: `npx tsc --noEmit` → exit 0.
Run: `npm run lint` → no new errors.
Run: `npm test` → whole suite green.

- [ ] **Step 7: Commit**

```bash
git add lib/nav/tabs.ts tests/nav/tabs.test.ts components/layout/NavLinks.tsx
git commit -m "$(cat <<'EOF'
refactor(nav): lógica de módulos visíveis e rotas sai para lib/nav/tabs.ts

Módulo puro (sem React) com MODULE_ROUTES, isModuleVisible, pickPrimaryTabs
e moduleTitleFromPath — reusável pela tab bar mobile e testável em node.
NavLinks.tsx passa a consumir tudo daí; comportamento idêntico.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Viewport export + primitivos de CSS global

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: classes utilitárias `.pb-safe` e `.h-dvh` (usadas por tarefas 5 e 6); meta viewport com `viewport-fit=cover` e `interactiveWidget=resizes-content`.

- [ ] **Step 1: Add the `viewport` export to `app/layout.tsx`**

At the top of `app/layout.tsx`, extend the `next` import and add the export next to `metadata`:

```ts
import type { Metadata, Viewport } from "next";
```

```ts
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#0F1E45",
};
```

(Keep the existing `metadata` export as is. Both `metadata` and `viewport` object exports are allowed in the same file — only `viewport` + `generateViewport` together are not.)

- [ ] **Step 2: Add CSS primitives to `app/globals.css`**

Append to the end of `app/globals.css`:

```css
@layer utilities {
  /* Preenche a área segura inferior (indicador de home) somando a um valor base. */
  .pb-safe {
    padding-bottom: env(safe-area-inset-bottom);
  }
  .pb-safe-14 {
    padding-bottom: calc(3.5rem + env(safe-area-inset-bottom));
  }
  /* Altura da viewport que acompanha as barras dinâmicas do navegador móvel. */
  .h-dvh {
    height: 100dvh;
  }
}

@layer base {
  /* Rede de segurança: no mobile, campos com fonte < 16px fazem o iOS dar
     zoom ao focar. Os componentes ui/input e ui/textarea já usam text-base
     no mobile; isto cobre <input>/<select>/<textarea> crus. */
  @media (max-width: 767px) {
    input,
    select,
    textarea {
      font-size: 16px;
    }
  }
}
```

- [ ] **Step 3: Verify build + lint**

Run: `npx tsc --noEmit` → exit 0.
Run: `npm run lint` → clean.
Run: `npm test` → green (nothing touched logic).

- [ ] **Step 4: Manual check**

Start dev server (`npm run dev`), open `http://localhost:3000/login` at 375 px. Confirm: page still renders, no layout shift, no console error about the viewport export.

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx app/globals.css
git commit -m "$(cat <<'EOF'
feat(mobile): viewport-fit=cover + interactiveWidget e utilitários de safe-area

viewport export com viewport-fit=cover (notch), interactiveWidget
resizes-content (teclado empurra conteúdo, não o oculta) e themeColor navy.
CSS: .pb-safe/.pb-safe-14/.h-dvh e backstop de font-size 16px em campos crus
no mobile (evita zoom do iOS ao focar).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `useLogout` + `MobileDrawerContent` + ajustes do `Sheet`

**Files:**
- Create: `lib/auth/use-logout.ts`
- Create: `components/layout/MobileDrawerContent.tsx`
- Modify: `components/ui/sheet.tsx`

**Interfaces:**
- Consumes: `NavLinks` (`components/layout/NavLinks.tsx`), `AccountSwitcher`, `WorkspaceSwitcher` (`components/layout/`), `ActiveSession`/`AccountSummary` de `@/lib/session/context`.
- Produces:
  - `useLogout(): () => Promise<void>` de `@/lib/auth/use-logout`
  - `MobileDrawerContent` (default-less named export): `function MobileDrawerContent(props: { session: ActiveSession; accounts: AccountSummary[]; onNavigate: () => void }): JSX.Element` — o **corpo** de um `<SheetContent side="left">` (não inclui o `<SheetContent>` em si).

- [ ] **Step 1: Create `lib/auth/use-logout.ts`**

Extract the logout flow currently inlined in `components/layout/Topbar.tsx:30-36`:

```ts
'use client'

import { useRouter } from 'next/navigation'
import posthog from 'posthog-js'
import { createClient } from '@/lib/supabase/client'

// Logout compartilhado: usado pelo menu do avatar (Topbar) e pela linha
// "Sair" da gaveta mobile (MobileDrawerContent).
export function useLogout() {
  const router = useRouter()
  return async () => {
    const supabase = createClient()
    if (posthog.__loaded) posthog.reset()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }
}
```

- [ ] **Step 2: Create `components/layout/MobileDrawerContent.tsx`**

Body lifted from `components/layout/MobileNav.tsx:33-54` (the inside of `<SheetContent>`), plus a "Sair" row:

```tsx
'use client'

import Image from 'next/image'
import { LogOut } from 'lucide-react'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { AccountSwitcher } from './AccountSwitcher'
import { NavLinks } from './NavLinks'
import { useLogout } from '@/lib/auth/use-logout'
import type { ActiveSession, AccountSummary } from '@/lib/session/context'

interface MobileDrawerContentProps {
  session: ActiveSession
  accounts: AccountSummary[]
  onNavigate: () => void
}

export function MobileDrawerContent({ session, accounts, onNavigate }: MobileDrawerContentProps) {
  const { userModules, allWorkspaces, workspaceId, accountId, accountName, role } = session
  const logout = useLogout()

  return (
    <>
      <div className="flex h-16 items-center gap-2 px-6">
        <div className="flex h-8 items-center justify-center rounded-lg bg-white px-1.5">
          <Image src="/logo-icon.png" alt="MedScale" width={138} height={96} className="h-[18px] w-auto" priority />
        </div>
        <span className="text-base font-semibold">MedScale</span>
      </div>

      {accounts.length > 1 && <AccountSwitcher accounts={accounts} activeId={accountId} />}
      {allWorkspaces.length > 1 && <WorkspaceSwitcher workspaces={allWorkspaces} activeId={workspaceId} />}

      <NavLinks
        userModules={userModules}
        role={role}
        className="flex-1 space-y-1 overflow-y-auto px-3 py-4"
        onNavigate={onNavigate}
      />

      <div className="border-t border-[var(--w10)] px-3 py-3">
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-[var(--w70)] transition-colors hover:bg-[var(--w10)] hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
        <div className="mt-2 px-3">
          <p className="truncate text-xs font-medium text-white/80">{accountName}</p>
          <p className="text-xs capitalize text-[var(--w60)]">{role}</p>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 3: Strengthen the `Sheet` backdrop and enlarge the close target**

In `components/ui/sheet.tsx`:

1. `SheetOverlay` (`line 30-33`) — change the className string:
   - from `"fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs"`
   - to `"fixed inset-0 z-50 bg-black/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0"`

2. `SheetContent` close button (`lines 62-77`) — change `size="icon-sm"` to `size="icon"` and add padding for a 44 px hit area:

```tsx
{showCloseButton && (
  <SheetPrimitive.Close
    data-slot="sheet-close"
    render={
      <Button
        variant="ghost"
        className="absolute top-2.5 right-2.5 size-11"
        size="icon"
      />
    }
  >
    <XIcon />
    <span className="sr-only">Close</span>
  </SheetPrimitive.Close>
)}
```

- [ ] **Step 4: Verify build + lint**

Run: `npx tsc --noEmit` → exit 0 (nothing imports `MobileDrawerContent`/`useLogout` yet — that's fine, they must still typecheck standalone).
Run: `npm run lint` → clean.
Run: `npm test` → green.

- [ ] **Step 5: Manual check**

Dev server, 375 px, any authenticated page (or `/login` for the Sheet-less check — skip if no auth). If auth is available: open the current hamburger drawer; confirm the backdrop is now clearly dark and the X is comfortably tappable. (Full wiring comes in Task 5; the old `MobileNav` still renders here.)

- [ ] **Step 6: Commit**

```bash
git add lib/auth/use-logout.ts components/layout/MobileDrawerContent.tsx components/ui/sheet.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): corpo da gaveta compartilhado + hook de logout + backdrop do Sheet

MobileDrawerContent extrai o corpo do SheetContent de MobileNav e adiciona a
linha "Sair" (antes só no menu do avatar). useLogout centraliza signOut +
posthog.reset + redirect. Sheet: backdrop bg-black/40 sem blur, botão de
fechar com área de 44px.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `MobileTabBar`

**Files:**
- Create: `components/layout/MobileTabBar.tsx`

**Interfaces:**
- Consumes: `pickPrimaryTabs`, `isModuleVisible` de `@/lib/nav/tabs`; `MODULE_NAV` de `@/components/layout/NavLinks`; `MobileDrawerContent` (Task 3); `Sheet`, `SheetContent`, `SheetTrigger`, `SheetTitle`, `SheetDescription` de `@/components/ui/sheet`; `ActiveSession`/`AccountSummary` de `@/lib/session/context`; `usePathname` de `next/navigation`.
- Produces: `function MobileTabBar(props: { session: ActiveSession; accounts: AccountSummary[] }): JSX.Element` — elemento `nav` `fixed inset-x-0 bottom-0 z-40 md:hidden`. Consumed by `app/(dashboard)/layout.tsx` in Task 5.

- [ ] **Step 1: Create `components/layout/MobileTabBar.tsx`**

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { pickPrimaryTabs } from '@/lib/nav/tabs'
import { MODULE_NAV } from '@/components/layout/NavLinks'
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { MobileDrawerContent } from './MobileDrawerContent'
import type { ActiveSession, AccountSummary } from '@/lib/session/context'

interface MobileTabBarProps {
  session: ActiveSession
  accounts: AccountSummary[]
}

export function MobileTabBar({ session, accounts }: MobileTabBarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pathname = usePathname()
  const tabs = pickPrimaryTabs(session.userModules, session.role)

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-[var(--navy-06)] bg-white/90 backdrop-blur md:hidden">
      <ul className="flex items-stretch">
        {tabs.map((slug) => {
          const item = MODULE_NAV[slug]
          const Icon = item.icon
          const active = isActive(item.href)
          return (
            <li key={slug} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors',
                  active ? 'text-[var(--cyan-dark)]' : 'text-gray-400',
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="max-w-full truncate px-1">{item.label}</span>
              </Link>
            </li>
          )
        })}

        <li className="flex-1">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger
              className={cn(
                'flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-gray-400 transition-colors',
                drawerOpen && 'text-[var(--cyan-dark)]',
              )}
            >
              <Menu className="h-5 w-5" />
              <span>Mais</span>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="flex w-3/4 flex-col border-[var(--w10)] bg-[var(--navy-dark)] p-0 text-white"
            >
              <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
              <SheetDescription className="sr-only">Acesse as funcionalidades do sistema</SheetDescription>
              <MobileDrawerContent
                session={session}
                accounts={accounts}
                onNavigate={() => setDrawerOpen(false)}
              />
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  )
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npx tsc --noEmit` → exit 0.
Run: `npm run lint` → clean.
Run: `npm test` → green.

- [ ] **Step 3: Commit**

```bash
git add components/layout/MobileTabBar.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): MobileTabBar — tab bar inferior fixa (4 abas + Mais)

Abas primárias via pickPrimaryTabs (filtradas por módulo/papel), ícones
reusados de MODULE_NAV, aba ativa por pathname. "Mais" abre a gaveta
(MobileDrawerContent). md:hidden, fixed bottom, z-40, área segura inferior.
Ainda não montada no layout — próxima tarefa.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Montar no layout + Topbar mobile + deletar `MobileNav`

**Files:**
- Modify: `app/(dashboard)/layout.tsx`
- Modify: `components/layout/Topbar.tsx`
- Delete: `components/layout/MobileNav.tsx`

**Interfaces:**
- Consumes: `MobileTabBar` (Task 4); `moduleTitleFromPath` de `@/lib/nav/tabs` (Task 1).
- Produces: nada para tarefas seguintes (Task 6 é independente).

- [ ] **Step 1: Render `MobileTabBar` and fix `<main>` padding in `app/(dashboard)/layout.tsx`**

1. Add import:

```ts
import { MobileTabBar } from '@/components/layout/MobileTabBar'
```

2. Replace the inner column block (`lines 41-50`) so the tab bar is a sibling of `<main>` and `<main>` clears it on mobile:

```tsx
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            userName={profile?.full_name ?? user.email ?? 'Usuário'}
            userEmail={user.email ?? ''}
            avatarUrl={user.user_metadata?.avatar_url}
            session={session}
            accounts={accounts}
          />
          <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 pb-safe-14 md:p-6 md:pb-6">
            {children}
          </main>
        </div>
        <MobileTabBar session={session} accounts={accounts} />
```

(`MobileTabBar` is `position: fixed`, so its DOM position only needs to be inside `SessionProvider`. Placing it after the flex row keeps the tree readable.)

- [ ] **Step 2: Slim the Topbar on mobile in `components/layout/Topbar.tsx`**

1. Replace the `MobileNav` import with the title helper + `usePathname`:

```ts
import { usePathname } from 'next/navigation'
import { moduleTitleFromPath } from '@/lib/nav/tabs'
```
(remove `import { MobileNav } from './MobileNav'`)

2. Inside the component, derive the title:

```ts
const pathname = usePathname()
const screenTitle = moduleTitleFromPath(pathname)
```

3. Replace the `<header>` body (`lines 46-47`, the `<MobileNav ... />` line) so mobile shows the screen title instead of the hamburger, and hide the name/email text on mobile:

```tsx
  return (
    <header className="flex h-14 items-center border-b border-[var(--navy-06)] bg-white px-4 md:h-16 md:px-6">
      <span className="text-base font-semibold text-[var(--navy)] md:hidden">{screenTitle}</span>
      <DropdownMenu>
        <DropdownMenuTrigger className="ml-auto flex items-center gap-3 rounded-lg px-2 py-1.5 outline-none hover:bg-[var(--navy-06)]">
          <div className="hidden text-right md:block">
            <p className="text-sm font-medium text-gray-900">{userName}</p>
            <p className="text-xs text-gray-400">{userEmail}</p>
          </div>
          <Avatar className="h-9 w-9">
            <AvatarImage src={avatarUrl ?? undefined} />
            <AvatarFallback className="bg-[var(--cyan-10)] text-[var(--cyan-dark)]">
              {initials}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        {/* DropdownMenuContent unchanged */}
```

Leave `DropdownMenuContent` (Configurações / Sair) exactly as is. Leave the desktop `md:` sizing intact (`md:h-16 md:px-6`).

4. `session` and `accounts` props are still declared on `TopbarProps` but no longer used by `Topbar` itself. Keep them in the interface and the call site (the layout still passes them) — remove only the unused destructuring if ESLint complains; otherwise leave. If `no-unused-vars` fires, prefix with `_` or drop them from the destructure (not from the interface — changing the public prop shape is out of scope).

- [ ] **Step 3: Delete `components/layout/MobileNav.tsx`**

```bash
git rm components/layout/MobileNav.tsx
```

- [ ] **Step 4: Verify nothing else imports `MobileNav`**

Run: `grep -rn "MobileNav" --include="*.ts" --include="*.tsx" app components lib` → **no matches** (Topbar was the only importer).
Run: `npx tsc --noEmit` → exit 0.
Run: `npm run lint` → clean.
Run: `npm test` → green.

- [ ] **Step 5: Manual check (needs auth — see spec "Verificação")**

Dev server, 375 px, on `/dashboard`:
- Bottom tab bar visible with **Meu painel · Minha agenda · Conversas · Meus pacientes · Mais**; active tab in cyan.
- Topbar shows "Meu painel" on the left, avatar on the right, **no email**.
- Tap "Mais" → drawer slides in with dark backdrop, has the other modules + "Sair".
- Navigate to `/finance` → Topbar title becomes "Financeiro"; page content not hidden behind the tab bar (scroll to the bottom, last row fully visible).
- Resize to `md+` → tab bar gone, sidebar back, Topbar shows name+email. **Desktop unchanged.**

- [ ] **Step 6: Commit**

```bash
git add app/(dashboard)/layout.tsx components/layout/Topbar.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): monta MobileTabBar no layout, Topbar enxuta e remove MobileNav

Layout do dashboard renderiza a tab bar; <main> vira p-4 + pb-safe-14 no
mobile (não cobre conteúdo), p-6 no desktop inalterado. Topbar mobile: h-14,
título da tela à esquerda (moduleTitleFromPath), avatar à direita, sem
nome/e-mail. MobileNav.tsx deletado — a gaveta agora vem da aba "Mais".

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Caixa de conversas no mobile — um painel por vez

**Files:**
- Modify: `components/bot/BotInboxClient.tsx`
- Modify: `components/bot/ConversationDetail.tsx`
- Modify: `components/bot/ConversationList.tsx`

**Interfaces:**
- Consumes: `.h-dvh` / `.pb-safe` utilities (Task 2).
- Produces: nenhanced `ConversationDetail` prop `onBack?: () => void` — when passed, renders a mobile back chevron and collapses the header actions into a `⋯` menu. No downstream consumers.

- [ ] **Step 1: `BotInboxClient.tsx` — add `mobilePane` state and mobile rendering**

1. Add `useState` import is already there. Add state after `selectedId`:

```ts
const [mobilePane, setMobilePane] = useState<'list' | 'detail'>('list')
```

2. Change the list `onSelect` to also switch panes on mobile. Replace the single `onSelect={setSelectedId}` usage: define a handler:

```ts
const handleSelect = (id: string) => {
  setSelectedId(id)
  setMobilePane('detail')
}
```

3. Replace the returned JSX (`lines 103-130`) with a version that keeps the desktop grid and adds a mobile-only single-pane layout:

```tsx
  return (
    <div className="grid h-[calc(100vh-160px)] grid-cols-1 gap-0 overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)] md:grid-cols-[340px_1fr]">
      {/* LISTA — sempre no desktop; no mobile só quando mobilePane === 'list' */}
      <div
        className={cn(
          'min-h-0 overflow-hidden border-r border-[var(--navy-06)]',
          mobilePane === 'detail' && 'hidden md:block',
        )}
      >
        <ConversationList conversations={conversations} selectedId={selectedId} onSelect={handleSelect} />
      </div>

      {/* DETALHE — painel no desktop; overlay full-screen no mobile */}
      <div
        className={cn(
          'min-h-0 overflow-hidden',
          mobilePane === 'list'
            ? 'hidden md:block'
            : 'fixed inset-0 z-50 bg-white md:static md:z-auto',
        )}
      >
        {selected ? (
          <ConversationDetail
            conversationId={selected.id}
            patientPhone={selected.patient_phone}
            patientName={selected.patient_name}
            status={selected.status}
            botPaused={selected.bot_paused}
            archivedAt={selected.archived_at}
            messages={selected.messages}
            onSend={handleSend}
            onResolve={handleResolve}
            onReactivateBot={handleReactivateBot}
            onToggleArchived={handleToggleArchived}
            onBack={() => setMobilePane('list')}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Selecione uma conversa
          </div>
        )}
      </div>
    </div>
  )
```

4. Add the `cn` import at the top:

```ts
import { cn } from '@/lib/utils'
```

5. In the deep-link `useEffect` (`lines 24-31`), also switch to the detail pane when a `?c=` target resolves:

```ts
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get('c')
    if (target && conversations.some((c) => c.id === target)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(target)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMobilePane('detail')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

- [ ] **Step 2: `ConversationDetail.tsx` — `onBack` prop, mobile back chevron, actions in `⋯`**

1. Extend the interface (`lines 18-30`):

```ts
  onToggleArchived: (archived: boolean) => Promise<void>
  onBack?: () => void
```

2. Add imports:

```ts
import { Archive, ArchiveRestore, ChevronLeft, Lock, MoreVertical, Send } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
```

3. Add `onBack` to the destructured props.

4. Replace the header block (`lines 124-149`) — add the chevron (mobile only) and split the actions into inline buttons (`hidden md:flex`) + a `⋯` menu (`md:hidden`):

```tsx
      <div className="flex items-center gap-2 border-b border-[var(--navy-06)] px-4 py-3 md:gap-3 md:px-5">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Voltar para a lista"
            className="-ml-1.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-[var(--navy-06)] md:hidden"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <InitialsAvatar label={title} seed={conversationId} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--navy)]">{title}</p>
          <p className="truncate text-xs text-gray-400">
            {patientPhone || 'Sandbox'} · {messages.length} {messages.length === 1 ? 'mensagem' : 'mensagens'}
          </p>
        </div>

        {/* Ações inline no desktop */}
        <div className="ml-auto hidden shrink-0 items-center gap-2 md:flex">
          {status !== 'resolved' && (
            <Button variant="outline" size="sm" onClick={onResolve}>
              Marcar como resolvida
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleArchived}
            disabled={archiving}
            className="gap-1.5"
          >
            {archivedAt ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
            {archivedAt ? 'Desarquivar' : 'Arquivar'}
          </Button>
        </div>

        {/* Ações no menu ⋯ no mobile */}
        <div className="ml-auto shrink-0 md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Ações da conversa"
              className="flex size-11 items-center justify-center rounded-lg text-gray-500 hover:bg-[var(--navy-06)]"
            >
              <MoreVertical className="h-5 w-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {status !== 'resolved' && (
                <DropdownMenuItem onClick={onResolve}>Marcar como resolvida</DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={handleToggleArchived} disabled={archiving}>
                {archivedAt ? 'Desarquivar' : 'Arquivar'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
```

5. Make the status/hint bar stack on mobile — replace `lines 190-212` container classes and button:

```tsx
      <div className="flex flex-col gap-1.5 border-t border-[var(--navy-06)] px-4 py-2.5 text-xs text-gray-500 md:flex-row md:flex-wrap md:items-center md:gap-x-2 md:gap-y-1 md:px-5">
        <span
          className={cn(
            'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 font-medium',
            PILL[info.tone],
          )}
        >
          <Lock className="h-3 w-3" />
          {info.label}
        </span>
        <span>{info.hint}</span>
        {botPaused && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleReactivate}
            disabled={reactivating}
            className="mt-1 w-full shrink-0 border-amber-300 bg-white text-amber-700 hover:bg-amber-100 md:mt-0 md:ml-auto md:w-auto"
          >
            {reactivating ? 'Reativando...' : 'Reativar bot'}
          </Button>
        )}
      </div>
```

6. The root wrapper (`line 123`) — give the mobile overlay a real height and keep desktop untouched:

```tsx
    <div key={conversationId} className="flex h-dvh flex-col bg-white md:h-full">
```

- [ ] **Step 3: `ConversationList.tsx` — kill input zoom + enlarge the checkbox row**

1. Search `<input>` (`line 70-75`) — change `text-sm` to `text-base`:

```tsx
            className="w-full rounded-full border border-[var(--navy-06)] bg-[var(--navy-06)]/40 py-2 pr-3 pl-9 text-base text-gray-900 placeholder:text-gray-400 focus:border-[var(--cyan)] focus:bg-white focus:ring-2 focus:ring-[var(--cyan-20)] focus:outline-none md:text-sm"
```

2. The "Mostrar arquivadas" label (`lines 77-85`) — bump the vertical target:

```tsx
        <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-2 text-xs text-gray-500">
```

- [ ] **Step 4: Verify build + lint**

Run: `npx tsc --noEmit` → exit 0.
Run: `npm run lint` → clean (watch for unused `MoreVertical`/`ChevronLeft` — both are used above).
Run: `npm test` → green.

- [ ] **Step 5: Manual check (needs auth)**

Dev server, 375 px, `/bot`:
- Only the **list** shows, full height, above the bottom tab bar.
- Tap a conversation → it opens **full-screen** (covers the tab bar), with a back chevron at the top-left.
- Header: avatar + name + a `⋯` menu (no clipped buttons). `⋯` → "Marcar como resolvida" / "Arquivar".
- "Bot pausado" bar: pill on its own line, hint below, "Reativar bot" full-width.
- Tap the back chevron → returns to the list, tab bar visible again.
- Focus the search field → **no page zoom**.
- Open the composer, focus the textarea → the field stays visible above the keyboard (best-effort; `interactiveWidget` from Task 2).
- `md+`: two-pane layout **exactly as before** — selecting a conversation updates the right pane, no overlay, inline action buttons.

- [ ] **Step 6: Commit**

```bash
git add components/bot/BotInboxClient.tsx components/bot/ConversationDetail.tsx components/bot/ConversationList.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): caixa de conversas mostra um painel por vez no celular

BotInboxClient ganha mobilePane ('list' | 'detail'): no < md a lista ocupa a
tela e a conversa abre como overlay fixed inset-0 z-50 (cobre a tab bar);
grid de dois painéis do md+ intacto. ConversationDetail: chevron de voltar +
ações no menu ⋯ no mobile, barra de status empilhada, h-dvh no overlay.
Busca da lista vira text-base (sem zoom do iOS).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `FinanceEntryTable` — camada de cartões no mobile

**Files:**
- Modify: `components/finance/FinanceEntryTable.tsx`

**Interfaces:**
- Consumes: nada novo.
- Produces: nada para tarefas seguintes.

- [ ] **Step 1: Wrap the existing table as desktop-only and add a mobile card list**

In `components/finance/FinanceEntryTable.tsx`, the non-empty branch currently is:

```tsx
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            ...
          </table>
        </div>
```

Replace that `<div className="overflow-x-auto">…</div>` with **two siblings** — the table hidden below `md`, and a card list hidden at `md+`:

```tsx
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px] text-sm">
              {/* thead + tbody UNCHANGED */}
            </table>
          </div>

          <ul className="divide-y divide-[var(--navy-06)] md:hidden">
            {rows.map((e) => {
              const n = names(tree, e)
              const isIncome = e.direction === 'in'
              const isMirror = !!e.revenue_entry_id
              return (
                <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-gray-900">
                        {e.description ?? n.cat}
                      </span>
                      <span
                        className={`shrink-0 text-sm font-medium ${
                          isIncome ? 'text-green-600' : 'text-gray-900'
                        }`}
                      >
                        {isIncome ? '+' : ''}
                        {formatBRL(e.amount)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
                      <span>{new Date(e.entry_date + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
                      <span aria-hidden>·</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 ${
                          isIncome ? 'bg-green-100 text-green-700' : 'bg-[var(--navy-06)] text-gray-500'
                        }`}
                      >
                        {isIncome ? 'Receita' : 'Despesa'}
                      </span>
                      <span aria-hidden>·</span>
                      <span className={n.uncategorized ? 'text-amber-600' : undefined}>{n.cat}</span>
                      {n.sub !== '—' && (
                        <>
                          <span aria-hidden>·</span>
                          <span>{n.sub}</span>
                        </>
                      )}
                      {kind === 'pj' && (
                        <>
                          <span aria-hidden>·</span>
                          <span>
                            {e.workspace_id ? (unitNames[e.workspace_id] ?? 'Unidade') : 'Consolidado'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {isMirror ? (
                    <span className="shrink-0 pt-0.5 text-[11px] text-gray-400">Ciclo</span>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger className="-mr-1.5 flex size-11 shrink-0 items-center justify-center rounded hover:bg-[var(--navy-06)]">
                        <MoreVertical className="h-4 w-4 text-gray-400" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(e)}>Editar</DropdownMenuItem>
                        <DropdownMenuItem className="text-red-600" onClick={() => onDelete(e)}>
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              )
            })}
          </ul>
        </>
```

Keep `thead`/`tbody` inside the desktop `<table>` byte-for-byte as they are now.

- [ ] **Step 2: Verify build + lint**

Run: `npx tsc --noEmit` → exit 0.
Run: `npm run lint` → clean.
Run: `npm test` → green.

- [ ] **Step 3: Manual check (needs auth)**

Dev server, 375 px, `/finance` (owner). Confirm: no horizontal scroll on the entries list; each entry is a card with description + amount on the top line, meta chips below, a 44 px `⋯` (Editar/Excluir) except on "Ciclo" rows. `md+`: the table is back, unchanged.

- [ ] **Step 4: Commit**

```bash
git add components/finance/FinanceEntryTable.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): FinanceEntryTable vira lista de cartões no < md

Tabela fica hidden md:block; no mobile cada lançamento é um cartão
(descrição + valor, chips de data/tipo/categoria/unidade, menu ⋯ de 44px).
Sem scroll horizontal. Desktop inalterado.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `PatientsClient` — camada de cartões no mobile

**Files:**
- Modify: `components/pacientes/PatientsClient.tsx`

**Interfaces:**
- Consumes: nada novo.
- Produces: nada para tarefas seguintes.

- [ ] **Step 1: Desktop-only table + mobile card list**

In `components/pacientes/PatientsClient.tsx`, the non-empty branch is currently:

```tsx
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            ...
          </table>
          </div>
```

Replace with two siblings:

```tsx
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[560px] text-sm">
                {/* thead + tbody UNCHANGED */}
              </table>
            </div>

            <ul className="divide-y divide-[var(--navy-06)] md:hidden">
              {filtered.map((p) => (
                <li key={p.id} className="px-4 py-3">
                  <Link
                    href={`/pacientes/${p.id}`}
                    className="block text-sm font-medium text-gray-900"
                  >
                    {p.full_name}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
                    <span>{p.phone}</span>
                    {p.email && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="truncate">{p.email}</span>
                      </>
                    )}
                  </div>
                  {p.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {p.tags.map((t) => (
                        <Badge key={t} className="border-none bg-[var(--navy-06)] text-[var(--navy)]">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
```

Keep the desktop `<table>`'s `thead`/`tbody` exactly as they are.

- [ ] **Step 2: Verify build + lint**

Run: `npx tsc --noEmit` → exit 0.
Run: `npm run lint` → clean.
Run: `npm test` → green.

- [ ] **Step 3: Manual check (needs auth)**

Dev server, 375 px, `/pacientes`. Confirm: no horizontal scroll; each patient is a tappable card (name links to `/pacientes/[id]`), phone/email meta below, tags as badges. `md+`: table unchanged.

- [ ] **Step 4: Commit**

```bash
git add components/pacientes/PatientsClient.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): lista de pacientes vira cartões no < md

Tabela hidden md:block; no mobile cada paciente é um cartão com nome
(link para o prontuário), telefone/e-mail e tags. Sem scroll horizontal.
Desktop inalterado.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `RevenueClient` — camada de cartões nas duas tabelas

**Files:**
- Modify: `components/receita/RevenueClient.tsx`

**Interfaces:**
- Consumes: nada novo.
- Produces: nada para tarefas seguintes.

- [ ] **Step 1: Entries table (`~line 260`) → desktop-only + mobile cards**

Replace the `<div className="overflow-x-auto"> <table className="w-full min-w-[640px] text-sm"> … </table> </div>` (the entries table) with:

```tsx
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[640px] text-sm">
                {/* thead + tbody UNCHANGED */}
              </table>
            </div>

            <ul className="divide-y divide-[var(--navy-06)] md:hidden">
              {initialEntries.map((e) => (
                <li key={e.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">{patientName(e)}</span>
                    <span className="shrink-0 text-sm font-medium text-gray-900">
                      {formatBRL(Number(e.amount))}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
                    <span>{formatDate(e.entry_date)}</span>
                    {e.procedure_name && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{e.procedure_name}</span>
                      </>
                    )}
                    {e.payment_method && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{PAYMENT_METHOD_LABELS[e.payment_method]}</span>
                      </>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <Badge className={`border-none ${PAYMENT_STATUS_LABELS[e.payment_status].style}`}>
                      {PAYMENT_STATUS_LABELS[e.payment_status].label}
                    </Badge>
                    {(e.payment_status === 'pending' || e.payment_status === 'realized') && (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setConfirming(e)
                          setConfirmMethod('pix')
                        }}
                        className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
                      >
                        Confirmar pagamento
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
```

- [ ] **Step 2: Health-plan consultations table (`~line 336`) → desktop-only + mobile cards**

Replace that `<div className="overflow-x-auto"> <table className="w-full min-w-[420px] text-sm"> … </table> </div>` with:

```tsx
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[420px] text-sm">
                {/* thead + tbody UNCHANGED */}
              </table>
            </div>

            <ul className="divide-y divide-[var(--navy-06)] md:hidden">
              {filteredConsultations.map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">{c.patient_name}</span>
                    <span className="shrink-0 text-xs text-gray-500">{c.health_plan}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">{formatDateTime(c.scheduled_at)}</p>
                </li>
              ))}
            </ul>
          </>
```

- [ ] **Step 3: Verify build + lint**

Run: `npx tsc --noEmit` → exit 0.
Run: `npm run lint` → clean.
Run: `npm test` → green.

- [ ] **Step 4: Manual check (needs auth)**

Dev server, 375 px, `/receita`. Confirm: both lists are cards, no horizontal scroll; entries card shows patient + amount, meta line, status badge + "Confirmar pagamento" when applicable; health-plan card shows patient + plan + datetime. `md+`: both tables unchanged.

- [ ] **Step 5: Commit**

```bash
git add components/receita/RevenueClient.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): tabelas de /receita viram cartões no < md

Entradas e "consultas por plano de saúde": tabela hidden md:block, cartões
no mobile (paciente + valor + meta + status/ação). Sem scroll horizontal.
Desktop inalterado.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage**

| Spec (decisão / seção) | Tarefa |
|---|---|
| 1 tab bar + gaveta, sidebar desktop intacta | 4, 5 |
| 2 nº de abas (4 + Mais) | 1 (`MAX_PRIMARY_TABS`), 4 |
| 3 abas primárias e ordem + `isVisible` reusado | 1 (`PRIMARY_TAB_ORDER`, `pickPrimaryTabs`), 4 |
| 4 ícone + rótulo | 4 (`MODULE_NAV[slug].icon` + `item.label`) |
| 5 estado selecionado (cyan / cinza, `startsWith`) | 4 (`isActive`) |
| 6 abas persistentes, nunca desabilitadas | 4 (só renderiza visíveis; "Mais" incondicional) |
| 7 "Mais" abre a gaveta; corpo compartilhado + "Sair" | 3 (`MobileDrawerContent`), 4 |
| 8 sem badge | — (explicitamente não implementado) |
| 9 Topbar mobile: título + avatar, sem nome/e-mail, sem hambúrguer | 5 |
| 10 gaveta: backdrop forte, X 44px, linhas 44px, "Sair" | 3 |
| 11 conversas: `mobilePane`, lista-só / overlay `fixed inset-0 z-50` | 6 |
| 12 conversas: `h-[100dvh]` mobile / `md:` intacto, `interactiveWidget` | 2 (`interactiveWidget`, `.h-dvh`), 6 |
| 13 conversas: chevron voltar + ações no `⋯` no mobile | 6 |
| 14 conversas: barra de status empilha | 6 |
| 15 conversas: busca `text-base`; checkbox 44px | 6 |
| 16 viewport export | 2 |
| 17 CSS base: safe-area + 16px backstop | 2 |
| 18 `<main>` `p-4 md:p-6` + `pb-safe-14` | 5 |
| 19 tabela → cartões em Finance / Patients / Revenue (2 tabelas) | 7, 8, 9 |
| 20 alvos de toque: `MoreVertical`, X da gaveta → 44px | 3 (X), 6 (`⋯` do detalhe), 7 (`⋯` do cartão) |
| Testes (Testing) | 1 (`tabs.test.ts`); UI = lint + tsc + checklist (ver Global Constraints) |
| Verificação ao vivo | passos "Manual check" + spec §Verificação |
| Alternativa B | registrada na spec, não implementada |

Sem lacunas. Decisão 8 é cobertura por omissão intencional.

**2. Placeholder scan** — os comentários `{/* thead + tbody UNCHANGED */}` em Tarefas 7–9 apontam para markup existente e imutável no mesmo arquivo que o executor está editando (não é "similar to Task N" nem código a inventar) — aceitável. Nenhum "TBD"/"add error handling"/passo sem código.

**3. Type consistency**
- `isModuleVisible(slug, userModules, role)` / `pickPrimaryTabs(userModules, role)` / `moduleTitleFromPath(pathname)` — mesmas assinaturas na Tarefa 1 (definição), Tarefa 4 (`pickPrimaryTabs`), Tarefa 5 (`moduleTitleFromPath`).
- `MODULE_NAV` continua `Record<ModuleSlug, NavItem>` com `NavItem = { label; href; icon }` — Tarefa 1 mantém o shape (só muda a construção); Tarefa 4 usa `item.icon` e `item.label`.
- `MobileDrawerContent` props `{ session, accounts, onNavigate }` — idênticas entre Tarefa 3 (definição) e Tarefa 4 (uso).
- `ConversationDetail` nova prop `onBack?: () => void` — Tarefa 6 define e passa; nenhum outro chamador existe.
- `useLogout(): () => Promise<void>` — Tarefa 3 define; Tarefa 3 usa em `MobileDrawerContent`. (Topbar continua com seu logout inline — não trocamos para não ampliar o diff da Tarefa 5; sem inconsistência de tipo.)
- Utilitários `.pb-safe`, `.pb-safe-14`, `.h-dvh` — criados na Tarefa 2, usados nas Tarefas 4/5/6 com os mesmos nomes.

Nenhuma inconsistência encontrada.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-08-mobile-revamp-nav-conversations.md`.**

Duas opções de execução:

1. **Subagent-Driven (recomendado)** — dispatch de um subagente novo por tarefa, revisão entre tarefas, iteração rápida.
2. **Inline** — executo as tarefas nesta sessão via `executing-plans`, com checkpoints para revisão.

Qual abordagem?
