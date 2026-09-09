# Repaginada mobile — navegação (tab bar) + caixa de conversas

Data: 2026-09-08
Status: design aprovado (aguardando revisão do spec)

## Problema

O app do dashboard foi desenhado para desktop e degrada mal no celular. Dois
pontos citados pelo usuário, mais um conjunto de problemas de base encontrados
na leitura do código:

### Navegação ("a navbar não funciona com o dedo")

- `components/layout/Topbar.tsx` — a barra de topo no mobile gasta a largura
  toda com **nome + e-mail** do usuário em tamanho cheio (`Topbar.tsx:50-53`),
  nunca mostra **em que tela você está**, e o único gatilho de navegação é o
  hambúrguer `h-9 w-9` (36 px, abaixo do mínimo de 44 px) encostado no canto
  superior esquerdo contra `px-6` (`MobileNav.tsx:23`).
- **Não há navegação inferior.** Toda troca de tela = alcançar o canto
  superior esquerdo → abrir a gaveta → varrer uma lista de 7 grupos → tocar.
  Uso com uma mão é ruim.
- `components/ui/sheet.tsx:31` — o backdrop da gaveta é `bg-black/10` (quase
  invisível) + `backdrop-blur` (trava no mobile). A borda da gaveta se
  confunde com a página.
- O botão de fechar (X) da gaveta é `icon-sm` (`size-7` = 28 px),
  `absolute top-3 right-3`, sobre a linha do logo (`sheet.tsx:62-77`).
- **Sair** existe só no dropdown minúsculo da Topbar (`Topbar.tsx:61-72`) —
  ausente da gaveta.
- `app/(dashboard)/layout.tsx:49` — todo conteúdo recebe `p-6` (24 px) em
  todos os lados; ~13 % da largura de uma tela de 375 px.

### Caixa de conversas (`/bot`, tela citada como exemplo)

- `components/bot/BotInboxClient.tsx:104` — o master-detail **nunca colapsa**.
  `grid-cols-1` empilha a *lista* de conversas e o *detalhe* da conversa —
  cada um com seu próprio scroll — dentro de uma caixa
  `h-[calc(100vh-160px)] overflow-hidden`. Resultado: a sobreposição que
  aparece no print do usuário.
- **Sem alternância lista ↔ conversa e sem botão voltar** no mobile — não dá
  para ver uma conversa em tela cheia.
- `h-[calc(100vh-160px)]` usa `vh` (não `dvh`) + o número mágico `160` afinado
  para a topbar do desktop — erra quando a barra do navegador móvel
  aparece/some, e o campo de resposta é empurrado para fora quando o teclado
  abre.
- `components/bot/ConversationDetail.tsx:124-149` — o cabeçalho do detalhe
  empacota avatar + nome + **"Marcar como resolvida"** + **"Arquivar"** numa
  linha só; corta em tela estreita.
- `ConversationDetail.tsx:190-212` — a barra de status/dica ("Bot pausado" +
  frase + "Reativar bot") quebra num empilhamento bagunçado.
- `components/bot/ConversationList.tsx:74` — o `<input>` de busca é `text-sm`
  (14 px) → **o iOS dá zoom na página ao focar**.

### Primitivos compartilhados (destravam todas as telas)

- `app/layout.tsx` — sem `export const viewport` com `viewportFit: 'cover'` /
  `interactiveWidget`; conteúdo colide com o indicador de home em aparelhos
  com notch, e o teclado não redimensiona o conteúdo.
- Tabelas de dados viram **scroll horizontal** (`min-w-[…]` dentro de
  `overflow-x-auto`) com 6-8 colunas espremidas:
  `components/finance/FinanceEntryTable.tsx:42` (`min-w-[640px]`),
  `components/pacientes/PatientsClient.tsx:80` (`min-w-[560px]`),
  `components/receita/RevenueClient.tsx:261` e `:337`.
- Gatilhos de menu de linha são alvos de ~24 px
  (`FinanceEntryTable.tsx:90`, `MoreVertical` com `p-1`).
- `components/ui/button.tsx` — o maior `size` é `h-9` (36 px); todos abaixo de
  44 px. (Não vamos mexer na escala global — só nos controles móveis
  críticos.)
- `components/ui/input.tsx` e `textarea.tsx` **já** trazem
  `text-base md:text-sm` (16 px no mobile) — o risco de zoom é só nos
  `<input>` crus.

### Objetivo

1. Navegação primária no mobile por **tab bar inferior fixa** (4 abas + "Mais"),
   seguindo as Human Interface Guidelines da Apple para tab bars.
2. Topbar enxuta no mobile: título da tela + menu do avatar.
3. Caixa de conversas usável no celular: **um painel por vez**, conversa em
   tela cheia com botão voltar, ações que não cortam, campo de resposta acima
   do teclado.
4. Primitivos compartilhados que corrigem safe-area, zoom de input, padding e
   alvos de toque, + o padrão **tabela → cartões** aplicado às três tabelas
   mais pesadas.

### Fora de escopo

- Páginas públicas de marketing e de login (têm problemas mobile próprios).
- Polimento mobile página a página de: widgets do dashboard, calendário da
  agenda, transcrições, configurações, admin.
- Conversa com URL própria / deep-link (`/bot/[id]`) — ver "Alternativa B".
- Badge de atenção na aba Conversas — **cortado da v1** por decisão do usuário
  ("não se preocupe com conversas antigas").
- Dark mode.

## Decisões

| # | Tema | Decisão |
|---|------|---------|
| 1 | Padrão de navegação | Tab bar inferior fixa `md:hidden` + gaveta (`Sheet`) para o resto, aberta pela aba "Mais". Sidebar do desktop **inalterada**. |
| 2 | Nº de abas | 4 primárias + "Mais" (HIG: ≤5 no iPhone, o mínimo necessário, uma entrada "More" para o resto). |
| 3 | Abas primárias e ordem | **Meu painel · Minha agenda · Conversas · Meus pacientes**, cada uma filtrada pela mesma lógica `isVisible(slug)` de `NavLinks`. Menos de 4 visíveis → mostra as que houver; "Mais" sempre presente. |
| 4 | Conteúdo da aba | Ícone (reusa `MODULE_NAV[slug].icon`) **+ rótulo curto** (HIG: nunca só ícone). |
| 5 | Estado selecionado | Ícone + rótulo em `--cyan`; não selecionado em cinza (`--w40`/`text-gray-400` equivalente no fundo claro). Ativo: `pathname === href || pathname.startsWith(href + '/')`. |
| 6 | Persistência das abas | Abas **persistentes e nunca desabilitadas** (HIG). Módulo que a conta não tem simplesmente não é uma das 4 — fica sob "Mais". |
| 7 | "Mais" | Abre a gaveta `Sheet` existente. O **conteúdo** da gaveta (switchers de conta/workspace, `NavLinks`, bloco conta/papel, **+ "Sair"** novo) sai de `MobileNav` para um componente compartilhado `MobileDrawerContent`, renderizado tanto pela aba "Mais" quanto (transitoriamente) por `MobileNav`. |
| 8 | Badge de atenção | **Não** na v1. |
| 9 | Topbar mobile | `h-14`. Esquerda = **título da tela** (lookup reverso em `MODULE_NAV` por `pathname`). Direita = menu do avatar (Configurações, Sair). Esconde nome+e-mail (`hidden md:block`). **Remove o hambúrguer no mobile** — "Mais" é a única entrada da gaveta. Desktop inalterado. |
| 10 | Gaveta | Backdrop `bg-black/40`, sem blur. X com área de toque de 44 px (`p-2.5`). Linhas de nav `py-3` (44 px). Linha "Sair" no rodapé, ao lado do bloco conta/papel. |
| 11 | Conversas: layout mobile | `BotInboxClient` ganha estado `mobilePane: 'list' \| 'detail'`. `< md`: renderiza **só** a lista; selecionar uma conversa monta `ConversationDetail` como **overlay `fixed inset-0 z-50`** (cobre a tab bar naturalmente — sem context; casa com o padrão HIG de esconder a barra numa tela de detalhe empurrada). `>= md`: grid de dois painéis atual, **inalterado**. |
| 12 | Conversas: altura | Caminho mobile usa `h-[100dvh]`; `md:` mantém `h-[calc(100vh-160px)]`. `interactiveWidget: 'resizes-content'` no viewport para o campo de resposta ficar acima do teclado. |
| 13 | Conversas: cabeçalho do detalhe | **Chevron de voltar** no início do cabeçalho (`md:hidden`) que faz `mobilePane='list'`. As duas ações ("Marcar como resolvida", "Arquivar/Desarquivar") colapsam num `DropdownMenu` `⋯` no mobile; ficam inline no `md+`. |
| 14 | Conversas: barra de status | Empilha no mobile — pill, depois a dica, depois "Reativar bot" botão largura cheia. |
| 15 | Conversas: busca | `<input>` de busca vira `text-base` (mata o zoom do iOS); a linha do checkbox "Mostrar arquivadas" vira alvo de 44 px. |
| 16 | Viewport | `app/layout.tsx`: `export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', interactiveWidget: 'resizes-content', themeColor: '#0F1E45' }`. |
| 17 | CSS base | `app/globals.css`: utilitários de safe-area; `@layer base` com `input, textarea, select { font-size: 16px }` sob `< md` como rede de segurança. |
| 18 | Padding do `main` | `app/(dashboard)/layout.tsx`: `<main>` vira `p-4 md:p-6` + `pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-6` para a tab bar nunca cobrir conteúdo. |
| 19 | Tabela → cartões | Padrão: `<div className="md:hidden">` com lista de cartões ao lado do `<table>` atual embrulhado em `hidden md:block`. Aplicado a **`FinanceEntryTable`, tabela de `PatientsClient`, tabelas de `RevenueClient`** (confirmado como o conjunto certo). Cada cartão = linha principal + fatos-chave + o `⋯` da linha em alvo de 44 px. Demais tabelas do app ficam para depois. |
| 20 | Alvos de toque | Subir só os ícones-botão móveis críticos (`MoreVertical`, X da gaveta) para 44 px via `p-2.5`. **Sem** mexer na escala global do `Button`. |

## Arquitetura

### Componentes novos

- **`components/layout/MobileTabBar.tsx`** (client) — a tab bar inferior.
  Props: `session` (para `userModules`, via o mesmo shape que `Sidebar`
  recebe) e `accounts`. Renderiza `nav` fixo; monta as 4 abas a partir de uma
  constante `PRIMARY_TAB_ORDER: ModuleSlug[] = ['dashboard','agenda','conversations','patients']`
  filtrada por `isVisible`; a 5ª célula é o gatilho "Mais". Reusa o
  `Sheet`/`MobileDrawerContent` para a gaveta. `md:hidden`.
- **`components/layout/MobileDrawerContent.tsx`** (client) — extrai o corpo
  atual do `SheetContent` de `MobileNav.tsx` (logo, `AccountSwitcher`,
  `WorkspaceSwitcher`, `NavLinks`, bloco conta/papel) e **adiciona** a linha
  "Sair" (reusa `handleLogout` — mover para um hook `useLogout()` em
  `lib/auth/` ou passar como prop; decisão de implementação, sem impacto no
  design). Recebe `onNavigate` para fechar a gaveta.

### Componentes alterados

- **`components/layout/Topbar.tsx`** — no mobile: título da tela + avatar;
  sem nome/e-mail; sem `<MobileNav>`. Deriva o título de um helper
  `moduleTitleFromPath(pathname)` em `components/layout/NavLinks.tsx`
  (exporta um `Map` reverso de `href → label` a partir de `MODULE_NAV`, com
  match por prefixo). Desktop: inalterado.
- **`components/layout/MobileNav.tsx`** — vira uma casca fina: só o `Sheet`
  cujo corpo é `<MobileDrawerContent>`. O `SheetTrigger` próprio some (a
  abertura vem da aba "Mais"). Pode ser removido de vez se nada além da tab
  bar precisar dele — verificar no plano.
- **`components/layout/Sidebar.tsx`** — inalterado (continua `hidden md:flex`).
- **`app/(dashboard)/layout.tsx`** — renderiza `<MobileTabBar>` como irmão de
  `<main>`; ajusta padding do `<main>` (decisão 18).
- **`app/layout.tsx`** — `export const viewport` (decisão 16).
- **`app/globals.css`** — safe-area + backstop de 16 px (decisão 17).
- **`components/bot/BotInboxClient.tsx`** — estado `mobilePane`; render
  condicional lista-só / overlay do detalhe no `< md`; grid intacto no `md+`.
  Handlers (`handleSend` etc.) inalterados. Ao selecionar no mobile:
  `setSelectedId(id); setMobilePane('detail')`. Voltar: `setMobilePane('list')`
  (mantém `selectedId` para o `md+` não perder seleção).
- **`components/bot/ConversationDetail.tsx`** — prop opcional
  `onBack?: () => void`; quando presente, renderiza o chevron `md:hidden` no
  cabeçalho e colapsa as ações no `⋯` (`md:hidden` no menu, `hidden md:flex`
  nos botões inline). Barra de status empilha no mobile (só classes
  responsivas).
- **`components/bot/ConversationList.tsx`** — `<input>` `text-base`; linha do
  checkbox com `py-2` + área de 44 px.
- **`components/ui/sheet.tsx`** — backdrop `bg-black/40`, remove
  `supports-backdrop-filter:backdrop-blur-xs`; X com `p-2.5`.
- **`components/finance/FinanceEntryTable.tsx`**,
  **`components/pacientes/PatientsClient.tsx`**,
  **`components/receita/RevenueClient.tsx`** — camada de cartões `md:hidden` +
  `hidden md:block` na tabela existente (decisão 19).

### Fluxo de dados

Nenhuma mudança de dados. `MobileTabBar` e `MobileDrawerContent` consomem o
mesmo `session`/`accounts` já resolvidos em `app/(dashboard)/layout.tsx` e
passados hoje para `Sidebar`/`Topbar`. Sem novas rotas, sem novas queries
(o badge, que exigiria uma, foi cortado).

### Isolamento

- `MobileTabBar` — o que faz: renderiza a navegação primária inferior no
  mobile. Como se usa: `<MobileTabBar session={session} accounts={accounts} />`
  no layout. Depende de: `MODULE_NAV`, `NAV`-helpers de `NavLinks.tsx`,
  `Sheet`, `MobileDrawerContent`, `usePathname`.
- `MobileDrawerContent` — o que faz: corpo da gaveta (navegação secundária +
  switchers + sair). Como se usa: dentro de um `<SheetContent>`. Depende de:
  `NavLinks`, `AccountSwitcher`, `WorkspaceSwitcher`, `useLogout`.
- `moduleTitleFromPath` — o que faz: `pathname → rótulo do módulo` para o
  título da Topbar mobile. Pura, testável isolada.
- `BotInboxClient` (mudança) — a lógica nova é só de apresentação
  (`mobilePane`); os contratos com `ConversationList`/`ConversationDetail`
  ganham um `onBack` opcional e nada mais.

## Tratamento de erros / casos de borda

- **Menos de 4 módulos primários visíveis** — a tab bar mostra 1-3 abas + "Mais".
  Nunca renderiza uma aba para módulo não visível. "Mais" é incondicional
  (sempre há settings + switchers lá).
- **`patients`/`conversations`/`agenda` desativados** — caem em "Mais" via
  `NavLinks` normal; a tab bar simplesmente não os inclui.
- **Rota sem módulo correspondente** (ex.: `/configuracoes/bot`,
  `/pacientes/[id]`) — `moduleTitleFromPath` faz match por prefixo do `href`
  mais longo; fallback para string vazia (Topbar não quebra).
- **Overlay do detalhe + navegação por tab bar** — a tab bar é `z-40`, o
  overlay do detalhe é `z-50`: tocar numa aba com uma conversa aberta é
  possível só depois de voltar. Aceitável (é uma tela de detalhe empurrada).
  O botão físico "voltar" do Android fecha a página inteira, não o overlay —
  limitação conhecida da Alternativa A (a B resolveria); não bloqueia.
- **Teclado no campo de resposta** — `100dvh` + `interactiveWidget:
  'resizes-content'` cobrem o caso comum. Handling completo de
  `VirtualKeyboard`/`env(keyboard-inset-*)` fica fora de escopo; se ainda
  ficar ruim no iOS, é follow-up.
- **Safe-area sem notch** — `env(safe-area-inset-bottom)` resolve para `0`;
  sem regressão em aparelhos sem indicador de home.
- **Rotação para paisagem no telefone** — `md:` (768 px) ainda não bate na
  maioria dos telefones em paisagem; segue no layout mobile. Aceitável.

## Testes

Vitest (sem infra de browser):

- `moduleTitleFromPath` — `/dashboard` → "Meu painel"; `/pacientes/123` →
  "Meus pacientes"; `/configuracoes/bot` → "Configuração"; rota desconhecida
  → `''`.
- `MobileTabBar` — dado `userModules` completo, renderiza as 4 abas na ordem
  de `PRIMARY_TAB_ORDER` + "Mais"; com `conversations` ausente, renderiza 3 +
  "Mais"; "Mais" sempre presente; aba ativa marcada por `pathname`.
- `BotInboxClient` — no mobile (mockando o matchMedia/`md`), selecionar uma
  conversa põe `mobilePane='detail'`; `onBack` volta para `'list'` sem perder
  `selectedId`; no desktop o comportamento de dois painéis é o de hoje.
- Camada de cartões das 3 tabelas — renderiza um cartão por linha com os
  mesmos dados-chave da `<tr>`; o `⋯` dispara os mesmos `onEdit`/`onDelete`.

## Verificação (mobile ao vivo)

Precisa de sessão autenticada no navegador da ferramenta. O seed
(`supabase/seed.sql`, amarrado a `eduardobordev@gmail.com` no projeto Supabase
de dev na nuvem) dá dados, não login. Opções, à escolha do usuário:

1. Usuário fornece e-mail + senha de uma conta descartável nesse projeto — a
   verificação em viewport de 375 px é feita aqui, com checklist.
2. Usuário roda `next dev` e confere cada mudança no próprio celular / DevTools
   com o checklist que acompanha a entrega.

## Alternativa B (registrada, não escolhida)

Route-split da caixa (`/bot` lista, `/bot/[id]` detalhe): páginas reais,
histórico real, esconder a tab bar por rota é trivial, botão "voltar" do
Android funciona. Custo: refator relevante dos updates otimistas cruzados de
`BotInboxClient` (lista + detalhe num client component só), split de dados no
servidor, mexe no comportamento do desktop. Risco alto demais para esta leva —
melhor como mudança futura se quiser conversas com deep-link.
