# Configuração da Clara: dados da clínica nas páginas próprias

**Data:** 2026-10-02
**Status:** aprovado em conversa, aguardando revisão do spec

## Objetivo

A tela `/configuracoes/bot` mistura comportamento da Clara com dados da clínica
(serviços, convênios, dados de cada unidade), e parte desses dados já existe em
outro lugar (catálogo de procedimentos, cadastro de operadoras). Cada dado passa
a ter **uma fonte de verdade**, editada na página dele, e a Clara lê de lá. A
tela da Clara fica só com o comportamento dela.

| Dado | Fonte de verdade | Onde edita |
|---|---|---|
| Procedimentos e preços | `procedure_catalog` (por unidade) | `/configuracoes/servicos` |
| Formas de pagamento, observações de preço, preparo de exames | `bot_config.payment_methods / pricing_info / exam_preparation` | `/configuracoes/servicos` |
| Convênios aceitos | `health_insurers` (ativos) | `/configuracoes/convenios` |
| Aceita particular | `bot_config.accepts_private` | `/configuracoes/convenios` |
| Endereço, horário presencial, como chegar, contatos, handoff, horário humano | `workspaces` + `handoff_hours` | `/locais/[id]` |
| Especialidade, mensagens, tom, políticas, limites, FAQ, handoff, push | `bot_config` | `/configuracoes/bot` |

## Não-objetivos / premissas

- **Sem migração de dados.** O sistema ainda não tem clientes reais; dados
  antigos em `bot_config.procedures`, `bot_config.insurance_plans` e
  `workspaces.consultation_price_from` são simplesmente abandonados (colunas
  ficam no banco, sem leitura nem escrita no app).
- Nenhuma mudança no nome da Clara, conexão WhatsApp/Meta ou onboarding.

## 1. Serviços — `/configuracoes/servicos`

- Página nova, owner/admin, **sem depender de módulo** (hoje o catálogo exige
  owner + módulo `revenue_cycle`).
- Seção **Catálogo por unidade**: o CRUD de `procedure_catalog` (nome, código,
  preço, duração, ativo) é extraído de `RevenueSettingsClient` para um
  componente próprio (`components/configuracoes/servicos/ProcedureCatalog.tsx`)
  usado aqui. Seletor de unidade quando houver mais de uma.
- Seção **Pagamento e preparo** (vale para a conta): formas de pagamento
  (`TagInput`), observações de preço (texto) e preparo de exames (texto).
  Salva via `PATCH /api/bot/config`, que já aceita esses campos.
- `/api/procedures` e `/api/procedures/[id]`: escrita passa de `owner` para
  `owner`/`admin`.
- `/configuracoes/receita` fica só com as preferências do fechamento diário e
  ganha um link "Catálogo de procedimentos → Serviços".
- Hub `/configuracoes`: card novo "Serviços" (owner/admin); texto do card
  Receita deixa de citar o catálogo.

## 2. Convênios — `/configuracoes/convenios`

- Página liberada para owner/admin **sem exigir o módulo `billing`**.
- Topo: switch **"Aceita consultas particulares"** (`bot_config.accepts_private`,
  via `PATCH /api/bot/config`).
- Lista/form de operadoras (`InsurersSettings` / `InsurerForm`):
  - sem `billing`: só **nome** e **ativo**;
  - com `billing`: aparecem e passam a ser exigidos os campos TISS de hoje
    (ANS, código do prestador, versão, guia padrão, lotes) e a seção de
    dados do prestador por unidade.
- **Migration** (`supabase/migration_convenios_sem_tiss.sql`, idempotente, e
  refletida em `schema.sql`/`billing.sql`):
  - `ans_registry` e `provider_code` passam a aceitar `null`; o check de 6
    dígitos continua valendo quando preenchido;
  - `unique (account_id, ans_registry)` vira índice único parcial
    `where ans_registry is not null`.
- `types/database.ts`: `ans_registry` e `provider_code` viram `string | null`.
- API `/api/billing/insurers` (+ `[id]`): rotas de cadastro de operadora
  liberadas sem o módulo `billing`. `parseInsurerInput` recebe se a conta tem
  `billing`: com `billing`, ANS e código do prestador continuam obrigatórios;
  sem `billing`, são ignorados. As demais rotas de `/api/billing/*` continuam
  exigindo o módulo.
- Faturamento: toda leitura de operadora para guia/lote (`lib/billing/guides.ts`,
  `lib/billing/batches.ts`, `lib/billing/appointments.ts`,
  `app/api/cron/tiss-batches`, seletores em `/faturamento`, `/agenda` e
  `/pacientes/[id]`) considera só operadoras com `ans_registry` e
  `provider_code` preenchidos. Gerar guia/lote para uma operadora incompleta
  retorna erro claro ("Complete o registro ANS e o código do prestador desta
  operadora em Convênios.").

## 3. Unidade — `/locais/[id]`

- Página nova. Os cards de `/locais` viram links para ela (o botão "tornar
  padrão" continua no card).
- Campos: nome, CEP (com o autopreenchimento ViaCEP que já existe no modal),
  endereço, cidade, UF, horário presencial (texto), como chegar/estacionamento,
  contatos, número de handoff, e o `HandoffHoursSettings` da unidade.
- owner/admin editam; member vê em modo leitura. Salva em
  `PATCH /api/workspaces/[id]` (já existe; confirmar que aceita `name`,
  `city`, `state`, `zip_code` além dos campos da Clara).
- `consultation_price_from` sai da UI e do `PATCH`.
- Unidade de outra account ou inexistente → `notFound()`.

## 4. Clara — `/configuracoes/bot` e prompt

**Tela:** fica especialidade, boas-vindas, tom de voz, políticas, limites, FAQ,
handoff (mensagens + instruções) e push. Sai a seção "Serviços e convênios" e
"Dados por unidade"; `WorkspaceBotFields.tsx` é removido. Entra um card
**"Dados que a Clara usa"** com links e contagens: "N serviços → Serviços",
"N convênios → Convênios", "N unidades → Locais". O `BotPreview` passa a
receber a lista de serviços (nomes do catálogo) e convênios (nomes ativos)
carregados pela página. Textos do cabeçalho e do card no hub atualizados.

**Prompt / agente:**
- `BotConfig.procedures` e `BotConfig.insurancePlans` saem de `getBotConfig`.
  Convênios passam a vir de uma consulta a `health_insurers`
  (`account_id`, `is_active = true`, ordem por nome) feita no agente e passada
  ao `buildDynamicSystemPrompt` (`insurancePlans: string[]`).
- "Procedimentos realizados" no prompt deriva do catálogo (nomes únicos de
  todas as unidades); vazio → "consultas gerais", como hoje.
- `UnitContext.consultationPriceFrom` sai; some o bloco "Consulta particular a
  partir de" e o `priceText` passa a: catálogo presente → preços estão na
  tabela de procedimentos; sem catálogo → "a equipe informa os valores".
- `/api/bot/config` `EDITABLE_FIELDS`: remove `procedures` e `insurance_plans`.

## 5. Testes

- `prompt-builder`: convênios vindos do input (com/sem particular), procedimentos
  derivados do catálogo, ausência do preço por unidade, texto sem catálogo.
- `parseInsurerInput`: sem `billing` aceita só nome; com `billing` exige ANS e
  código do prestador.
- Faturamento: operadora sem ANS/código é recusada na geração de guia/lote.
- `/api/procedures`: admin consegue criar/editar; member não.
- Atualizar testes existentes que montam `BotConfig`/`UnitContext` com os
  campos removidos.

## Riscos

- `health_insurers` é lido em vários pontos do faturamento; esquecer um deles
  deixaria uma operadora sem ANS chegar ao XML TISS. Mitigação: o filtro fica
  num helper único em `lib/billing/` usado por todos, mais a recusa explícita
  na montagem do lote/guia.
- A migration precisa ser aplicada em dev e prod antes do deploy do app.
