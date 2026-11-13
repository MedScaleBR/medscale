# Custos: aba "Por cliente" e filtro de período personalizado

Data: 2026-11-12 · Painel: `/admin/costs` (interno, só admin MedScale)

## Por que

Hoje o painel de custos é uma visão do sistema inteiro. Quando o usuário quer
entender **um cliente específico** — quanto ele custa por funcionalidade,
quanto usa de cada uma, como o gasto anda dia a dia, quanto sai cada conversa
e cada resposta da Clara, e o que cada unidade dele consome — não há onde
olhar. O "Custo por cliente" atual mostra só um total, uma barra e uma linha
de unidades.

Sucesso: abrir o painel, clicar no cliente e entender em segundos onde está o
custo dele, inclusive num dia específico ou num intervalo escolhido.

## Escopo

1. O painel ganha duas abas no topo: **Geral** e **Por cliente**.
2. Um novo filtro de período, compartilhado pelas duas abas.
3. A aba **Por cliente**, em página única rolando (layout "A" escolhido nos
   esboços).

### Não-objetivos

- Mudar o conteúdo da aba Geral (cards, alertas, cache da Clara, ranking de
  clientes continuam como estão). Ela só passa a respeitar o novo filtro.
- Mudar a página do cliente em `/admin/accounts/[id]`.
- Mudar como os custos são registrados (`cost_events`). Nenhuma migration.

### Anti-objetivos

- Ler conteúdo de mensagem de paciente. Contagens sim, texto nunca (LGPD — a
  mesma regra que o `cost_events.metadata` já segue).
- Número de "custo por mensagem" que misture mensagens que não custaram Claude
  (ver "Métricas").

## Abas e URL

- Abas no topo de `/admin/costs`: `Geral` | `Por cliente`. Estado na URL para
  ser compartilhável e sobreviver a reload:
  - `?tab=cliente&account=<uuid>` (ausente = Geral).
  - Ao abrir "Por cliente" sem `account`, seleciona o cliente mais caro do
    período.
- Trocar de aba preserva o período.

## Filtro de período (as duas abas)

Aparência aprovada no esboço `datas-v1`:

- Botões `7 dias` · `30 dias` · `90 dias` e um botão de calendário que mostra
  a escolha atual (`📅 11/11` ou `📅 03/11 – 11/11`).
- O calendário abre um popover com:
  - Atalhos à esquerda: Hoje, Ontem, Esta semana, Este mês, Mês passado.
  - Dois meses lado a lado com navegação ‹ ›.
  - Um clique + Aplicar = **um dia só**. Dois cliques = **intervalo** (início e
    fim destacados em navy, miolo em ciano claro).
  - Rodapé com resumo (`3 nov – 11 nov · 9 dias`), Limpar e Aplicar.
  - Dias futuros desabilitados; hoje com contorno ciano.
- URL: `?days=7|30|90` (como hoje) **ou** `?from=YYYY-MM-DD&to=YYYY-MM-DD`
  (um dia = `from` igual a `to`). `from/to` vence `days` quando os dois vêm.
- Datas são dias de **São Paulo**: `from` começa 00:00 BRT, `to` termina
  23:59:59.999 BRT. (Os `days=N` continuam "últimos N×24h", como hoje.)
- Datas inválidas, invertidas ou no futuro: cair no padrão de 30 dias.
- "vs. período anterior" no card de total da aba Geral: para `from/to`, o
  período anterior é o intervalo de mesmo tamanho imediatamente antes.

## Aba "Por cliente"

### 1. Faixa de clientes

Inspirada numa barra de abas de navegador (referência do usuário): faixa
horizontal, fundo navy escuro, cada cliente é um "chip" com círculo colorido
com a inicial, nome e custo no período. O selecionado fica destacado
(fundo mais claro, texto branco). Ordem: do mais caro ao mais barato no
período. Rolagem horizontal quando não cabe. Clientes sem custo no período
não aparecem. Cor do círculo derivada de forma estável do id do cliente.

### 2. Resumo (4 cards)

- **Total** do cliente no período.
- **Por conversa** — ver "Métricas".
- **Por resposta da Clara** — ver "Métricas". (Rótulo na tela: "Por mensagem
  da Clara".)
- **Média por dia** — total ÷ número de dias do período.

### 3. Por funcionalidade (tabela)

Uma linha por funcionalidade com custo > 0 no período, ordenada por custo:
nome · uso · custo · % do total do cliente.

| Funcionalidade | Fonte do custo | Uso mostrado |
|---|---|---|
| Clara (agendamento) | `claude_agendamento` | N conversas · N respostas |
| Clara — áudio | `whisper` sem `related_id` | N áudios · N min |
| Transcrição de consulta | `whisper` com `related_id` | N consultas · N min |
| Prontuário (SOAP) | `claude_soap` | N prontuários |
| Simulador da Clara | `claude_simulador` | N respostas |
| Agente financeiro | `claude_financeiro` | N chamadas |
| WhatsApp (Meta) | `whatsapp_conversation` | N janelas de 24h |

A separação do Whisper reusa `whisperSourceOf` de `lib/costs/aggregate.ts`
(commit 52f6b20).

### 4. Por dia (gráfico)

Barras empilhadas por dia com as 3 cores da casa (Claude navy, Whisper
ciano, WhatsApp navy translúcido) — as mesmas de `GROUP_BAR`. Tooltip com o
valor de cada grupo e o total do dia. Dias sem custo aparecem como barra
vazia (eixo contínuo). Quando o período é **um dia só**, o gráfico passa a
ser **por hora** (0–23h, BRT).

### 5. Por unidade

Um bloco por unidade do cliente (com custo no período), do mais caro ao mais
barato: nome, total, e a mesma tabela de funcionalidade (uso · custo) restrita
àquela unidade. "Sem unidade" aparece por último com a explicação curta:
"Clara antes de o paciente escolher a unidade".

## Métricas

Tudo sai de `cost_events` (uma linha por chamada cobrada). **Não** usar
`messages.role='assistant'` para contar mensagens da Clara: em prod, nos
últimos 30 dias, havia 1.854 mensagens `assistant` contra 495 chamadas ao
Claude — a tabela mistura respostas da Clara com mensagens da secretária pelo
celular e templates automáticos.

- **Resposta da Clara** = 1 linha `claude_agendamento`. (O detector de loop
  em `aggregate.ts` já trata cada linha como uma resposta.)
- **Conversa** = `related_id` distinto entre `claude_agendamento` e
  `whatsapp_conversation`.
- **Por resposta da Clara** = custo `claude_agendamento` ÷ nº de respostas.
  Decisão do usuário: só o custo do Claude, só as mensagens da Clara.
- **Por conversa** = custo da Clara (`claude_agendamento` + Whisper da Clara +
  `whatsapp_conversation`) ÷ nº de conversas. Transcrição, SOAP, simulador e
  financeiro ficam fora para que uma clínica que grava muita consulta não
  pareça cara por conversa — o mesmo critério de
  `detectExpensiveAccountAlerts`.
- Uso do Whisper em minutos = soma de `quantity` (segundos) ÷ 60.
- Divisão por zero mostra "—".

## Dados e implementação

- A consulta da aba "Por cliente" filtra `cost_events` por `account_id` e pelo
  período, e precisa de `provider, cost_brl, workspace_id, related_id,
  quantity, created_at, workspaces(name)`. Mesma paginação
  (`fetchAllPages`) e teto `MAX_EVENTS` do painel atual, com o mesmo aviso de
  "valores subestimados" quando truncar.
- A faixa de clientes precisa do total por cliente no período — o mesmo dado
  que a aba Geral já calcula.
- A agregação (funcionalidades, uso, métricas, série por dia/hora, unidades)
  fica numa função pura testável, no padrão de `lib/costs/aggregate.ts` /
  `buildCostOverview`. Testes Vitest cobrindo: separação das
  funcionalidades, métricas e divisão por zero, agrupamento por dia em fuso de
  São Paulo (evento 23:30 BRT cai no dia certo), modo por hora, unidade nula.
- `getCostOverview` passa a aceitar um intervalo `{ since, until }` em vez de
  só `days`; `normalizeCostDays` ganha um irmão que interpreta `from/to`.
  O resto do /admin que usa `getCostOverview`/`getCostTotals` continua
  funcionando sem mudança de comportamento.
- Bibliotecas já no projeto: `recharts` (gráfico), `date-fns` (datas). O
  calendário é um componente próprio estilizado com os tokens da casa —
  `react-day-picker` não está instalado e não precisa entrar.
- Acesso: nada muda — RLS de `cost_events` (só `is_medscale_admin`) e o
  layout de `/admin`.

## Decisões tomadas sem perguntar (revisáveis)

- A seção "Cache da Clara" da aba Geral também passa a respeitar o período
  (hoje recebe `days`; passa a receber o intervalo).
- "Esta semana" começa no domingo, igual à primeira coluna do calendário.
  "Este mês"/"Mês passado" são meses de calendário em BRT.
- Intervalo personalizado limitado a 366 dias; acima disso o calendário não
  deixa aplicar (protege o teto `MAX_EVENTS`).
- Cliente na URL sem custo no período: a faixa mostra os demais e a área
  abaixo exibe "Nenhum custo deste cliente no período" (não troca sozinho).
- Na tabela por unidade, conversas e uso contam pelo `workspace_id` de cada
  linha de custo. Uma conversa que começou "sem unidade" e depois ganhou
  unidade pode aparecer nos dois blocos — os custos não se duplicam, só a
  contagem de conversas.
- O dashboard inicial do `/admin` (custo 30 dias) não muda.

## Fica a critério de quem implementar

- Componentização exata, nomes de arquivos e se a aba Por cliente é um
  componente servidor com pedaços cliente (faixa e calendário são cliente).
- Detalhes visuais finos dentro dos tokens da casa e do esboço aprovado.
- Comportamento responsivo em telas estreitas (a página é usada no desktop).
