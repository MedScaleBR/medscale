# Integrações Meta: Embedded Signup do WhatsApp e Login com Facebook (Ads)

Data: 2026-09-16
Status: implementado (plano: docs/superpowers/plans/2026-09-16-integracoes-meta.md)

Escopo: dois botões em `/configuracoes` — **"Conectar WhatsApp"**, que passa a ser a
**única** forma de conectar o número da Clara (via Embedded Signup da Meta), e
**"Login com Facebook"**, que conecta a conta de anúncios e alimenta `/trafego`
automaticamente. O fluxo antigo de conexão do WhatsApp (token colado à mão e
provisionamento pela equipe MedScale) é removido.

## Problema

Hoje conectar o WhatsApp exige que o médico crie o próprio App na Meta for Developers,
configure webhook, gere um System User Token sem expiração e cole três segredos
(`phone_number_id`, `meta_token`, `meta_app_secret`) em
`components/configuracoes/bot/BotOnboarding.tsx`. Cada passo é um ponto de desistência,
e o resultado é uma conexão que a MedScale não controla nem consegue depurar. A
alternativa existente — "quero um número novo", em `/api/bot/onboarding/provision` — é
trabalho manual da equipe, com 1-2 dias de espera.

Em paralelo, `/trafego` mostra campanhas de anúncio **digitadas à mão** em `ad_campaigns`
(`app/api/campaigns/route.ts`): gasto, impressões, cliques e leads. Ninguém mantém isso
atualizado por muito tempo.

O Embedded Signup resolve o primeiro problema (o cliente autoriza em um popup, com o App
da MedScale como Tech Provider) e o Login com Facebook resolve o segundo.

## Decisões tomadas no brainstorm

| # | Tema | Decisão |
|---|------|---------|
| 1 | Status do App Meta | O App já existe (o do `META_APP_SECRET` atual). Verificação de negócio **em andamento**; Acesso Avançado ainda não concedido. O código nasce pronto e gated por env |
| 2 | Conexões antigas | Não há clientes reais em produção. As credenciais antigas são **zeradas** por migration; nenhuma account ou usuário é apagado |
| 3 | Métricas de campanha | Sync automático do Facebook gravando em `ad_campaigns` (cron diário + "Atualizar agora"), **convivendo** com o cadastro manual, que continua para Google e demais canais |
| 4 | Nível das integrações | Login **por account** (igual ao Google) + mapeamento **unidade → conta de anúncio**, no espírito do `WorkspaceCalendarMap` |
| 5 | Arquitetura | Duas verticais separadas com um cliente Graph compartilhado. `bot_config` continua dono da credencial do WhatsApp; Ads ganha tabela própria |

## Modelo de dados

Migration nova: `supabase/migration_meta_integrations.sql`.

### `meta_ads_connections` (nova)

Uma linha por account, espelhando `google_tokens`:

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid pk | |
| `account_id` | uuid, **único**, FK `accounts` | conexão única por account |
| `fb_user_id` | text | |
| `access_token` | text | cifrado com `encryptToken` (`lib/crypto.ts`) |
| `token_expires_at` | timestamptz | token longo dura ~60 dias |
| `scopes` | text[] | |
| `connected_by` | uuid FK `auth.users` | quem autorizou |
| `connected_at` / `updated_at` | timestamptz | |

RLS no mesmo molde de `google_tokens` (membro ativo da account lê; escrita pelo service role).

### `workspace_ad_accounts` (nova)

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid pk | |
| `workspace_id` | uuid FK `workspaces` | |
| `account_id` | uuid FK `accounts` | para RLS e para o cron varrer por account |
| `ad_account_id` | text | formato `act_<id>` |
| `ad_account_name` | text | rótulo exibido |
| `created_at` | timestamptz | |

Único em `(workspace_id, ad_account_id)`. Uma unidade pode ter mais de uma conta de
anúncio; a mesma conta de anúncio pode servir duas unidades (a soma fica correta porque a
gravação é por unidade).

### `ad_campaigns` (alterada)

- `source` — `'manual' | 'meta_sync'`, default `'manual'`. Linhas existentes continuam manuais.
- `external_campaign_id` — text, nullable. ID da campanha na Meta.
- Índice único parcial: `(workspace_id, external_campaign_id, period_start) WHERE source = 'meta_sync'`.

O índice parcial é o coração da convivência: torna o upsert do sync idempotente sem impor
chave nenhuma às linhas digitadas à mão, que hoje não têm unicidade e não podem ganhar uma
sem quebrar o cadastro manual.

### `bot_config` (alterada)

- **`waba_id`** (novo, text) — o Embedded Signup devolve WABA e Phone Number ID juntos, e o
  WABA é necessário para inscrever o App e para desinscrever no disconnect.
- **`whatsapp_pin`** (novo, text cifrado) — PIN de 6 dígitos gerado por nós no registro do
  número. Sem guardá-lo, reconectar o mesmo número depois trava na verificação em duas
  etapas da Meta.
- **`meta_app_secret` é removida.** O App passa a ser o da MedScale; `META_APP_SECRET` do
  ambiente valida a assinatura de todos os webhooks.
- **Limpeza:** `UPDATE bot_config SET meta_token = NULL, phone_number_id = NULL,
  whatsapp_number = NULL, is_active = false` — as conexões de teste antigas somem e todos
  reconectam pelo botão novo.

`number_source` **permanece**. Não é resíduo de onboarding: `lib/costs/record.ts:137` a usa
para decidir de quem é a conta da Meta (`'medscale'` = custo da MedScale, `'own'` = custo da
clínica). No Embedded Signup o WABA é do cliente e o meio de pagamento é dele, então toda
conexão nova grava `'own'` e o painel de custos segue correto. Se a MedScale um dia bancar a
conversa como Solution Partner, essa premissa muda — é decisão de negócio, fora deste spec.

## Remoções

| Arquivo | Destino |
|---|---|
| `components/configuracoes/bot/BotOnboarding.tsx` | apagado (os dois caminhos antigos) |
| `app/api/bot/onboarding/verify-meta/route.ts` | apagado |
| `app/api/bot/onboarding/provision/route.ts` | apagado |
| `app/api/bot/onboarding/disconnect/route.ts` | **mantido**, e passa a desinscrever o App do WABA antes de limpar as credenciais |
| Bloco "Conexão WhatsApp" em `BotConfigForm.tsx` (incl. props `hasMetaAppSecret`, estado `showConnectionEditor`) | removido; a página fica só com personalidade, FAQ, preços e handoff |
| Uso de `onboarding_step` no `BotStatusBadge` | simplificado: conectado = `meta_token` e `phone_number_id` preenchidos |
| Leitura de `meta_app_secret` em `app/api/whatsapp/webhook/route.ts:54-69` | removida; ficam `META_APP_SECRET` e o segredo do número financeiro |

`onboarding_step`, `provisioning_request` e o valor `'medscale'` de `number_source`
permanecem no schema (sem uso novo) para não mexer em constraints e no histórico de custos;
o código para de escrevê-los, exceto `number_source: 'own'`.

## Fluxo 1 — Conectar WhatsApp (Embedded Signup)

### Cliente

`components/configuracoes/WhatsAppConnectButton.tsx` carrega o SDK JS do Facebook sob demanda
no clique (a mecânica exata segue o guia de scripts em `node_modules/next/dist/docs/`, que
deve ser lido antes da implementação — regra do AGENTS.md) e chama:

```
FB.login(callback, {
  config_id: META_ES_CONFIG_ID,
  response_type: 'code',
  override_default_response_type: true,
  extras: { sessionInfoVersion: '3' },
})
```

Um listener de `message` captura o evento `WA_EMBEDDED_SIGNUP`, de onde vêm `waba_id` e
`phone_number_id`; o callback do `FB.login` traz o `code`. Evento `CANCEL` (usuário fechou o
popup) devolve a UI ao estado inicial sem mensagem de erro; `ERROR` mostra o motivo da Meta.

### Servidor — `POST /api/whatsapp/embedded-signup`

Autorização: `requireWorkspaceSession` + `requireRole(['owner', 'admin'])`, como as demais
rotas de integração. Entrada: `{ code, waba_id, phone_number_id }`.

1. **Troca do código** — `GET /oauth/access_token` com App ID + `META_APP_SECRET`. Devolve o
   token de system user do negócio, sem expiração.
2. **Inscrição do App** — `POST /{waba_id}/subscribed_apps`. É isso que faz as mensagens
   chegarem ao webhook único; sem esse passo a conexão parece pronta e o bot fica mudo.
3. **Registro do número** — `POST /{phone_number_id}/register` com `messaging_product=whatsapp`
   e um PIN de 6 dígitos gerado aqui, guardado cifrado em `bot_config.whatsapp_pin`.
4. **Leitura do número** — `GET /{phone_number_id}?fields=display_phone_number,verified_name`,
   só para o rótulo exibido.
5. **Persistência** — upsert em `bot_config` (`waba_id`, `phone_number_id`, `meta_token`
   cifrado, `whatsapp_number`, `is_active: true`, `number_source: 'own'`), seguido de
   `invalidateBotConfigCache(accountId)` e `trackBotWizardCompleted`.

Falha em qualquer passo **não** grava `is_active: true`. Uma conexão pela metade é pior que
nenhuma: o painel diz "conectado" e o bot não responde. Cada passo tem mensagem própria em
português ("não foi possível inscrever o App no seu WhatsApp Business", "o número precisa ser
verificado na Meta antes de conectar"), porque um erro genérico aqui é indepurável — o
usuário não sabe se o problema é o número, a permissão ou a conta.

### Desconectar

`DELETE /api/bot/onboarding/disconnect` ganha um passo antes do update: `DELETE
/{waba_id}/subscribed_apps`. Se a chamada falhar (token já revogado do lado da Meta, por
exemplo), registra no Sentry e segue com a limpeza local — não faz sentido prender o usuário
a uma conexão que ele já quer fora.

## Fluxo 2 — Login com Facebook (Ads)

### Conexão

Sem SDK JS: segue o padrão do Google, já implementado e revisado.

- `GET /api/meta/ads/connect` — owner/admin; redireciona ao diálogo OAuth com
  `state = accountId` e escopos `ads_read` + `business_management` (o segundo é o que permite
  listar as contas de anúncio).
- `GET /api/meta/ads/callback` — valida que o usuário está logado **e** é membro ativo da
  account do `state` antes de aceitá-lo (mesma defesa comentada em
  `app/api/google/callback/route.ts:22-24`; `state` sozinho é reescrevível na URL). Troca o
  `code` por token curto e depois por token longo (`grant_type=fb_exchange_token`), grava
  cifrado em `meta_ads_connections` com `token_expires_at`, e redireciona para
  `/configuracoes?meta_ads=connected` (ou `=error`).

### Mapeamento

`GET /api/meta/ads/accounts` chama `GET /me/adaccounts?fields=account_id,name` e alimenta
`components/configuracoes/AdAccountMap.tsx` — irmão do `WorkspaceCalendarMap`: uma linha por
unidade ativa, um select com as contas de anúncio. `PUT /api/meta/ads/accounts` grava em
`workspace_ad_accounts`.

### Sync

`lib/meta/ads-sync.ts`, para cada mapeamento da account:

```
GET /act_<id>/insights
  ?level=campaign
  &time_increment=1
  &fields=campaign_name,spend,impressions,clicks,actions
  &time_range={since,until}
```

Um registro por campanha por dia → upsert em `ad_campaigns` com `channel: 'facebook'`,
`source: 'meta_sync'`, `external_campaign_id`, `period_start = period_end = o dia`. `leads`
sai de `actions`, somando os tipos de lead (formulário nativo e conversão no site).

A janela é sempre os **últimos 7 dias**, não apenas ontem: a Meta reescreve números
retroativamente por atribuição, e re-sincronizar a semana é o que mantém o histórico honesto.
Como o upsert é idempotente, reprocessar é barato.

Disparo:

- `POST /api/cron/meta-ads-sync` com `requireCronAuth`, agendado em `supabase/cron.sql`
  (padrão do `waitlist`), de madrugada.
- Botão "Atualizar agora" em `/trafego` → `POST /api/meta/ads/sync` para a account ativa.

### Token vencido

Erro `190` da Graph API marca a conexão como inválida em vez de estourar: o cron pula a
account, registra no Sentry, e `/configuracoes` troca o botão para "Reconectar com Facebook"
em amarelo. Sem isso, a falha aparece só como um `/trafego` que parou de atualizar, sem
ninguém notar.

## UI

Em `components/configuracoes/SettingsClient.tsx`, dentro do bloco `canManageIntegrations`,
entra um card **"Integrações Meta"** acima do Google Agenda, com os dois botões lado a lado:

- **Conectar WhatsApp** — `Badge` verde "Conectado — +55 11 …" quando há token e número, com
  "Desconectar" discreto ao lado (visual do `GoogleConnectButton`).
- **Login com Facebook** — badge com o perfil conectado e "N de M unidades mapeadas"; abaixo,
  o `AdAccountMap` quando conectado.

O card "Configurações da Clara" continua linkando para `/configuracoes/bot`, mas o status de
conexão passa a viver num lugar só: o card novo. Retorno dos fluxos usa o padrão de
`searchParams` já em uso na página (`?meta_ads=connected|error`, `?whatsapp=connected|error`)
com as mesmas tarjas verde/vermelha do topo.

Enquanto faltarem as variáveis de ambiente, o botão do WhatsApp aparece **desabilitado** com
"Integração em aprovação na Meta". É assim que a entrega convive com a verificação de negócio
ainda em andamento: até o Acesso Avançado sair, o fluxo funciona apenas para quem estiver
listado como admin ou testador do App.

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_META_APP_ID` | App ID no `FB.init` e no diálogo OAuth |
| `META_ES_CONFIG_ID` | configuração do Embedded Signup |
| `META_GRAPH_VERSION` | default no código; o atual está fixo em `v19.0` e o Embedded Signup pede versão mais nova |
| `META_APP_SECRET` | já existe; passa a ser o único segredo de validação de webhook |

Documentar as novas em `.env.local.example`.

## Testes

Vitest, na organização de `tests/`:

- `tests/meta/oauth.test.ts` — troca de `code`, promoção para token longo, erro `190`
  mapeado para "reconectar".
- `tests/meta/embedded-signup.test.ts` — caminho feliz chamando os cinco passos na ordem;
  falha no `subscribed_apps` **não** persiste conexão ativa; `member` recebe 403.
- `tests/meta/ads-sync.test.ts` — insights → linhas de `ad_campaigns`; extração de `leads` do
  `actions`; **idempotência** (rodar duas vezes o mesmo dia não duplica) e **linha manual
  preservada** após o sync. São os dois testes que justificam o índice parcial.
- `tests/meta/ads-callback.test.ts` — `state` de account da qual o usuário não é membro →
  redirect de erro.
- Ajuste em `tests/webhook/` para a remoção do segredo por account.

## Fora de escopo

- Google Ads via API (o cadastro manual continua atendendo esse canal).
- Métricas de campanha no dashboard principal.
- Atribuição de lead → paciente.
- Cobrança de conversa pela MedScale como Solution Partner.

Cada um merece spec próprio.
