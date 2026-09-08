# Agente financeiro — compreensão de linguagem natural + PF/PJ automático

Data: 2026-09-08
Status: design aprovado (aguardando revisão do spec)

## Problema

O agente financeiro do WhatsApp (`lib/finance/`) parece "robotizado / só
comando" em três frentes:

1. **PF/PJ é sempre um chute.** `interpret.ts` força o modelo a escolher `pf`
   ou `pj` pelo "contexto clínico", e `toIntent` cai em `pf` quando o modelo
   devolve `null`. Não existe caminho de "pergunta ao owner". Resultado:
   "gastei 2600 no aluguel" entra como PF sem confirmar, mesmo quando poderia
   ser a sala do consultório.
2. **Um lançamento por mensagem.** "gastei 35 no ifood e 50 no uber" cai em
   `desconhecido` por causa da regra "o registro é de um por vez".
3. **Dead-ends secos.** Mensagem sem valor claro ("acho que foi uns 30 e pouco
   no almoço") vira `desconhecido`; a resposta é "Não consegui entender. Você
   pode me dizer algo como…", que soa como erro de parser.

Objetivo: o agente entende texto livre melhor e trava menos, **mantendo o tom
sério de agente financeiro** — não é para virar um chatbot de conversa fiada.

### Não faz parte deste escopo

- **Contexto de consulta encadeada** ("e mês passado?" logo depois de uma
  consulta). É a de menor frequência e precisa de um conceito separado de
  contexto guardado. Fica para uma fase posterior; o design deixa a costura
  pronta (ver "Fase posterior" no fim).
- Liberar conversa fora de escopo. O guard-rail continua: fora de
  lançamento/consulta/pagamento, o agente responde com `unknown` (copy nova,
  ver Decisão 6) ou `smalltalk` (saudação), sem mudança de comportamento.
- Qualquer mudança de schema. `finance_sessions.pending_entry` é `jsonb` e
  comporta o formato novo.

## Decisões

| # | Tema | Decisão |
|---|------|---------|
| 1 | Como decidir PF/PJ | Julgamento do modelo no prompt do `interpret.ts`. Sem lista de merchants no código. O modelo devolve `pf`, `pj` ou `null` (= ambíguo, **pergunta**). |
| 2 | Semântica de `tipo: null` | Passa a significar "genuinamente ambíguo — perguntar". A regra de tiebreak por "contexto clínico" e o default `null → 'pf'` do `toIntent` são **removidos**. |
| 3 | Vários lançamentos | O tool `registrar_intencao` devolve `lancamentos[]` (1..N). `FinanceIntent` `entry` vira `{ kind: 'entry'; entries: EntryDraft[] }`. `parseCommand` embrulha o hit único como `entries: [one]`. |
| 4 | Valor ausente | Se o modelo não consegue fixar um número mas há descrição, devolve `valor: null` para aquele item (em vez de a mensagem virar `desconhecido`). Número aproximado ("uns 30") é aceito como está. |
| 5 | Fluxo de pergunta | Um único `pending_entry.kind = 'entry_batch'` com `awaiting: 'type' \| 'amount' \| 'unit'`. Substitui o `choose_workspace` atual. `handlePendingPaymentConfirm` fica **intocado**. |
| 6 | Copy dos dead-ends | Séria, mas aponta o próximo passo. Sem chamada de LLM (continua determinística). |
| 7 | Modelo de interpretação | Continua `claude-opus-5` para o `interpretMessage` (mesma chamada, saída um pouco maior). `categorizeEntry` continua `claude-sonnet-4-5`, chamado uma vez por draft sem categoria. |

## `lib/finance/interpret.ts` + `types.ts`

### Tool `registrar_intencao` — campos por lançamento viram array

Para **lançamento**, os campos que descrevem um gasto/receita — `tipo`,
`descricao`, `valor`, `categoria`, `subcategoria`, `unidade`, `direcao` —
movem para dentro de cada item de `lancamentos[]`. Os campos do topo
(`tipo`, `categoria`, `subcategoria`, `unidade`, `direcao`, `mes`) **ficam**
e continuam sendo o que `consulta` lê — o caminho de consulta não muda.
`paciente`, `horario`, `forma_pagamento` (confirmar_pagamento) também ficam
no topo.

```jsonc
{
  "intencao": "lancamento" | "consulta" | "confirmar_pagamento" | "desfazer" | "ajuda" | "conversa" | "desconhecido",
  "lancamentos": [
    {
      "tipo": "pf" | "pj" | null,          // null = ambíguo, o agente pergunta
      "descricao": "string | null",
      "valor": "number | null",            // null = o agente pergunta o valor
      "categoria": "string | null",
      "subcategoria": "string | null",
      "unidade": "string | null",
      "direcao": "entrada" | "saida" | null
    }
  ],
  "mes": "string | null",
  "paciente": "string | null",
  "horario": "string | null",
  "forma_pagamento": "pix | cartao_credito | cartao_debito | dinheiro | transferencia | outro | null"
}
```

- `strict: true` continua. Cada objeto de `lancamentos` tem seu próprio
  `required` (as 7 chaves) e `additionalProperties: false`. `lancamentos`
  entra em `required` no topo (array vazio é válido no schema; o `toIntent`
  trata array vazio + `intencao: 'lancamento'` como `unknown`).
- Fora de `intencao: 'lancamento'`, o modelo devolve `lancamentos: []` e usa
  os campos de filtro do topo, exatamente como hoje. `toIntent` para
  `consulta` e `confirmar_pagamento` **não muda** — lê do topo. Só o ramo
  `lancamento` do `toIntent` passa a iterar `lancamentos[]`. Isso mantém o
  caminho de consulta (o mais sensível a regressão) intocado.
- Duplicação de `tipo`/`categoria`/`subcategoria`/`unidade`/`direcao` entre o
  topo e os itens é aceitável: o prompt diz explicitamente "lançamento → só
  em `lancamentos[]`; consulta → só no topo", e são objetos de intenção
  diferentes.

### Prompt do sistema — buckets de PF/PJ

Substitui a regra atual ("Na dúvida entre pf e pj num lançamento, escolha pelo
contexto clínico…") por:

```
Classifique cada lançamento em tipo:
- pf  — gasto/receita pessoal do médico. Ex.: iFood, mercado, streaming,
        farmácia, escola dos filhos, viagem, salário/pró-labore, aluguel
        que ELE recebe, investimentos.
- pj  — da clínica. Ex.: "escritório", sala/consultório, equipamento médico,
        material de consultório, secretária/funcionário, sistema/CRM da
        clínica, imposto da clínica, receita de consulta/procedimento.
- null — genuinamente ambíguo: dá para ser pessoal ou da clínica e a
        mensagem não decide. Ex.: aluguel, energia, água, internet, telefone,
        carro, contador, seguro — quando não há nada no texto que aponte para
        um lado. NÃO chute; devolva null e o agente pergunta.
```

Regras que ficam: separar receita/despesa por `direcao`; nunca inventar valor
(agora → `valor: null` no item, não `desconhecido` na mensagem inteira);
`confirmar_pagamento` continua sobre paciente, não sobre gasto do médico.

Regra que muda: "Se a mensagem misturar vários gastos/receitas de uma vez, use
desconhecido" → **removida**. Vários gastos = vários itens em `lancamentos`.
`desconhecido` fica só para mensagem sem nenhum lançamento identificável.

### `types.ts`

```ts
export interface EntryDraft {
  type: FinanceEntryType | null      // null = perguntar PF/PJ
  direction: 'in' | 'out'
  description: string | null
  amount: number | null              // null = perguntar valor
  category: string | null
  subcategory: string | null
  workspaceHint: string | null
}

export type FinanceIntent =
  | { kind: 'entry'; entries: EntryDraft[] }   // era um objeto único
  | { kind: 'query'; /* inalterado */ }
  | { kind: 'confirm_payment'; /* inalterado */ }
  | { kind: 'undo' } | { kind: 'help' }
  | { kind: 'smalltalk'; raw: string }
  | { kind: 'unknown'; raw: string }
```

`toIntent`:

- `intencao: 'lancamento'` + `lancamentos` não-vazio → mapeia cada item para
  `EntryDraft` (sem o default `?? 'pf'`; `type` pode sair `null`). `direction`
  segue `direcao === 'entrada' ? 'in' : 'out'`. `workspaceHint` só quando
  `type === 'pj'` — **mas** com `type: null` ainda não sabemos; guarda
  `unidade` no draft de qualquer jeito e o agente decide depois de resolver o
  tipo.
- `intencao: 'lancamento'` + `lancamentos` vazio → `unknown`.
- Item com `valor` inválido (≤ 0, NaN) → `valor: null` (vira pergunta), **não**
  descarta o item. Item sem `descricao` E sem `valor` → descartado (nada a
  perguntar).

## `lib/finance/parser.ts`

`parseCommand` continua devolvendo os mesmos `kind`s. O único ajuste: o ramo
`entry` embrulha em `entries: [ { …campos atuais, amount: number, type:
FinanceEntryType } ]` (atalho sempre tem tipo e valor explícitos, nunca gera
`null`).

## `lib/finance/agent.ts` — laço de processamento

Depois de `interpretMessage` / `parseCommand`, quando `intent.kind === 'entry'`:

```
readyEntries = []
queue = [...intent.entries]

while queue.length:
  draft = queue.shift()
  resolve categoria (resolveCategoryPair → categorizeEntry fallback, só se draft.type != null)

  if draft.type == null:
     → park({ awaiting: 'type', current: draft, queue }); persist(readyEntries); ask buildChooseTypeMessage; return
  if draft.amount == null:
     → park({ awaiting: 'amount', current: draft, queue }); persist(readyEntries); ask buildAskAmountMessage; return
  if draft.type == 'pj':
     units = listAccountUnits()
     resolved = resolveUnit(units, draft.workspaceHint)
     if resolved.status != 'one':
        → park({ awaiting: 'unit', current: draft, queue }); persist(readyEntries); ask buildChooseWorkspaceMessage; return
     draft.workspaceId = resolved.unit.id
  readyEntries.push(draft)

persist(readyEntries)
confirm: readyEntries.length == 1 ? buildConfirmationMessage : buildBatchConfirmationMessage
```

- **`persist(readyEntries)` antes de cada `park`**: o que já estava pronto nunca
  se perde por causa de uma pergunta sobre um item posterior. `persistEntryAndConfirm`
  hoje insere **e** confirma; extrai-se `persistEntry` (só o insert + tracking)
  para reuso no laço, e a confirmação passa a ser uma decisão do chamador.
- **Cada `persist` manda a confirmação correspondente** (`buildConfirmationMessage`
  para 1, `buildBatchConfirmationMessage` para vários) e, quando o motivo do
  persist foi um `park`, a **pergunta vai como uma segunda mensagem** logo em
  seguida. Assim nenhum lançamento gravado fica sem confirmação, mesmo num lote
  que precisou de duas ou três respostas do owner. As duas/três mensagens
  (confirmação + pergunta) são chamadas separadas de `sendFinanceReply`.
- Num `resume`, `readyEntries` recomeça vazio (o que já foi gravado não está no
  record — só `current` + `queue`), então cada confirmação cobre exatamente os
  itens gravados naquele passo, sem duplicar.
- Categoria com `draft.type == null`: adiada. Depois que o owner responde o
  tipo, o resume resolve a categoria com o tipo já conhecido.

### Pending record (`finance_sessions.pending_entry`, jsonb — sem migração)

```jsonc
{
  "kind": "entry_batch",
  "awaiting": "type" | "amount" | "unit",
  "current": { /* EntryDraft + categoryId/subcategoryId já resolvidos quando aplicável */ },
  "queue":   [ /* EntryDraft[] ainda não processados */ ]
}
```

`ready` já persistido não entra no record — só `current` + `queue`.

### `handlePendingEntryBatch` (novo, substitui `handlePendingChooseWorkspace`)

Roda no mesmo ponto do fluxo (antes de `handlePendingPaymentConfirm`). TTL
`PENDING_TTL_MS` (30 min) inalterado. `NEGATIVE.test(text)` → limpa o record,
"Ok, não registrei nada." e **descarta** `current` + `queue` (o `ready` já
persistido fica).

Caso contrário, conforme `awaiting`:

| `awaiting` | Parser da resposta | Sucesso | Falha |
|---|---|---|---|
| `type` | `parseEntryType(text)` → `'pf' \| 'pj' \| null` | seta `current.type`, resolve categoria, **re-entra no laço** com `[current, ...queue]` | `buildChooseTypeMessage` de novo |
| `amount` | parse numérico (aceita "35", "R$ 35,50", "35 reais") | seta `current.amount`, re-entra no laço | "Não peguei o valor. Me manda só o número, ex: 35" |
| `unit` | `resolveUnit(units, text)` | seta `current.workspaceId`, move para ready, re-entra no laço | `buildWorkspaceNotMatchedMessage` |

"Re-entra no laço" = mesma função de drenagem do fluxo direto (extraída para
`drainEntryQueue(current + queue)`), que pode gerar a **próxima** pergunta
(ex.: respondeu "PJ" → agora pergunta a unidade) ou, esvaziando a fila,
persistir tudo e confirmar. As verificações são independentes e sequenciais
(tipo → valor → unidade), então um item no pior caso gera 3 perguntas
(ambíguo, sem valor, e PJ multi-unidade). É raro e cada resposta é uma
palavra; aceitável. O caso comum é 0 ou 1 pergunta no lote inteiro.

### Confirmação em lote

`buildBatchConfirmationMessage(entries: FinanceEntry[], totals)` — uma mensagem:

```
Registrei 2 lançamentos:
• iFood — R$ 35,00 (PF, despesa)
• Uber — R$ 50,00 (PF, despesa)
Total de despesas PF em setembro/2026: R$ 1.230,00
```

Total por "bucket" (`type` + `direction`) efetivamente tocado — se o lote
misturar PF e PJ, uma linha de total por combinação. Sem chamada de LLM
(determinística, como as outras de lote/erro).

## `lib/finance/respond.ts` — copy

- `SYSTEM`: constraints de tom inalteradas (sério, sem markdown, ≤1 emoji,
  `R$ X.XXX,XX`). Uma frase adicionada: que ele entende o médico falando do
  jeito dele (texto livre, vários gastos juntos) e responde direto, sem
  reclamar do formato.
- `buildUnknownMessage` → sério mas com próximo passo, ex.:
  *"Não peguei essa. Me diz o gasto com valor e onde foi — tipo '35 no
  almoço' — ou pergunta 'quanto gastei esse mês'."* Determinística.
- Novos builders determinísticos:
  - `buildChooseTypeMessage(desc, amount)` → *"Esse lançamento ({desc} —
    {R$}) é pessoal (PF) ou da clínica (PJ)?"*
  - `buildAskAmountMessage(desc)` → *"Quanto foi o gasto com {desc}?"* (ou
    *"esse lançamento"* quando `desc` é null)
  - `buildBatchConfirmationMessage(entries, totals)`
- Nova helper pura `parseEntryType(text): 'pf' | 'pj' | null` ao lado de
  `parsePaymentMethod`. Aceita: `pf`, `pessoal`, `meu`, `minha`, `pessoa
  física` → `pf`; `pj`, `clínica`, `clinica`, `empresa`, `cnpj`,
  `consultório` → `pj`; resto → `null`.

## Testes (vitest, espelhando `tests/finance/`)

**`interpret.test.ts`**
- `lancamentos[]`: um item; dois itens ("35 no ifood e 50 no uber");
  `valor: null` quando não há número; `tipo: null` quando ambíguo.
- Prompt do sistema contém os três buckets (pf / pj / null) e **não** contém a
  regra antiga de tiebreak clínico.
- `intencao: 'lancamento'` com `lancamentos: []` → `unknown`.
- Consulta continua lendo filtros de `lancamentos[0]`.

**`agent-entry-batch.test.ts`** (novo) + ajustes em `agent-category.test.ts`
- Dois itens prontos → 2 `insert` em `finance_entries` + **uma**
  `buildBatchConfirmationMessage`.
- `tipo: null` → grava nada do item ambíguo, seta `pending_entry.kind =
  'entry_batch'`, `awaiting: 'type'`, e envia `buildChooseTypeMessage`.
- Resposta "pessoal" → resolve, persiste, confirma.
- Item pronto **antes** do item ambíguo é persistido na hora (insert antes do
  park) **e** confirmado; a pergunta chega como uma segunda mensagem.
- `valor: null` → `awaiting: 'amount'`; resposta "35" → persiste.
- "PJ" + conta multi-unidade → encadeia `awaiting: 'unit'` logo após o tipo.
- Casos de `choose_workspace` de hoje, migrados para `entry_batch`, continuam
  passando (conta com 1 unidade resolve sem perguntar; multi-unidade pergunta).
- `NEGATIVE` na pendência descarta `current`+`queue`, mantém o que já entrou.
- `handlePendingPaymentConfirm` sem regressão (suite existente intocada).

**`parser.test.ts`**
- Atalho `/pf Netflix 35` → `{ kind: 'entry', entries: [ { type: 'pf',
  amount: 35, … } ] }`.

**Novo `entry-type-parse.test.ts`** — `parseEntryType` puro: sinônimos de pf,
de pj, e texto que não casa → `null`.

## Arquivos tocados

- `lib/finance/interpret.ts` — tool schema (`lancamentos[]`), prompt, `toIntent`
- `lib/finance/types.ts` — `EntryDraft`, `FinanceIntent.entry`
- `lib/finance/parser.ts` — embrulhar `entries: [one]`
- `lib/finance/agent.ts` — laço de drenagem, `persistEntry` extraído,
  `handlePendingEntryBatch` (remove `handlePendingChooseWorkspace`)
- `lib/finance/respond.ts` — copy + 3 builders + `parseEntryType`
- `lib/finance/categorize.ts` — **inalterado** (chamado por draft no laço)
- testes acima

Sem migração. Sem mudança de env var. Sem mudança nas rotas web / API.

## Fase posterior (costura deixada pronta)

Contexto de consulta encadeada ("e mês passado?"). O `pending_entry` já é o
lugar natural para um `{ kind: 'last_query', filters, at }` gravado após cada
`buildQueryMessage`, lido por um handler novo antes do fluxo normal e
resolvido contra deltas ("mês passado", "e em março", "e a PJ"). Fora deste
escopo.
