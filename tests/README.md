# Testes automatizados — MedScale

Cobertura dos três fluxos de maior risco clínico: ciclo de mensagem do WhatsApp,
pipeline de transcrição e cálculo de disponibilidade.

```bash
npm test              # roda tudo uma vez
npm run test:watch    # modo watch
npm run test:coverage # com cobertura (falha abaixo de 80% de statements)
```

## Estrutura

```
tests/
  setup.ts                      variáveis de ambiente falsas + supressão de console
  helpers/
    supabase-mock.ts            builder encadeável e thenable do client Supabase
    agent-harness.ts            estado compartilhado dos testes de processIncomingMessage
    types.ts                    alias MockFn (vi.fn tipado como função, não construtor)
  webhook/signature.test.ts     HMAC da Meta, roteamento e handshake
  agent/
    markers.test.ts             parsing puro dos marcadores + ações que eles disparam
    context.test.ts             paciente/conversa/histórico, mídia não suportada
    handoff.test.ts             intenção de handoff e janela de atendimento humano
    scheduling.test.ts          criação da consulta e sincronização com o Google
    config.test.ts              mapeamento e cache do bot_config
    prompt-builder.test.ts      montagem do system prompt
  transcriptions/
    upload.test.ts              signed upload URL + criação do registro
    process.test.ts             etapa Whisper e política de retry
    generate-soap.test.ts       contrato do SOAPRecord e geração do prontuário
    sign.test.ts                assinatura do prontuário
  google/
    availability.test.ts        cálculo de slots, fuso e degradação
    reconcile.test.ts           sincronização inversa Google → Supabase
    calendar.test.ts            contrato dos eventos criados no Google
```

## Regras

- **Nenhuma chamada de rede.** Anthropic, OpenAI, googleapis, Supabase e a Graph
  API da Meta são todos mockados. Teste que falha por rede é mock incompleto.
- **Nenhuma dependência de ordem.** Todo estado é reconstruído em `beforeEach`.
- **Datas sempre fixas** nas suites de disponibilidade e handoff, via
  `vi.setSystemTime`. `new Date()` sem mock não é aceito ali.
- **Nomes em português**, no padrão `deve [comportamento] quando [condição]`.

## Como mockar as dependências do agente

`vi.mock` é hoisted acima dos imports estáticos, então referenciar um binding
importado dentro da factory cai em TDZ. Duas saídas, ambas usadas aqui:

- `vi.hoisted()` para um objeto de estado local (`tests/google/*`, `tests/webhook/*`);
- factory `async` com `await import('../helpers/agent-harness')` para reaproveitar
  o harness compartilhado (`tests/agent/*`).

Por isso o bloco de `vi.mock` se repete no topo de cada suite de `tests/agent/` —
não dá para extrair para uma função. `lib/bot/handoff.ts` é deixado **real** de
propósito: depende só de Supabase e do envio de WhatsApp, ambos já mockados, então
testá-lo de verdade cobre a decisão de handoff em vez de presumi-la.

O mock do Supabase resolve por tabela e operação. Um array de respostas é
consumido em ordem, o que cobre "primeira consulta devolve X, segunda devolve Y":

```ts
createSupabaseMock({
  appointments: {
    select: [{ data: [] }, { data: { id: 'appt-1' } }],
    insert: { data: { id: 'appt-1' } },
  },
})
```

---

## Divergências entre o plano de testes e o código real

O documento que originou esta suite descrevia alguns arquivos e comportamentos
que não batem com o que existe. Registro aqui o que foi encontrado.

### Caminhos e contratos diferentes do descrito

| No plano | No código |
|---|---|
| `app/api/transcriptions/upload/route.ts` | O upload é em duas etapas: `upload-url/route.ts` emite a signed URL e `transcriptions/route.ts` cria o registro. O áudio nunca passa pelo corpo da rota (limite de ~4.5MB da Vercel). |
| Autenticação por header `x-cron-secret` | As rotas usam `Authorization: Bearer ${CRON_SECRET}`. Os testes seguem o código. |
| Upload acima de `RECORDING_MAX_MB` retorna 413 | Não existe `RECORDING_MAX_MB` em lugar nenhum do projeto, nem checagem de tamanho no servidor — o limite é do bucket do Storage. Cenário não testado por não existir. |
| `detectHandoffIntent` retorna `true` na 8ª troca de mensagem | Não há regra por número de mensagens: a função recebe só a mensagem atual do paciente e a resposta do bot, sem o histórico. O gatilho por "2 tentativas sem sucesso" está no system prompt, e chega ao código como o marcador `[HANDOFF]`. |
| Marcador com espaço extra "deve falhar atualmente" | Os regexes já usam `\s*`, então `AGENDAMENTO_CONFIRMADO:  <data>` sempre funcionou. Há teste cobrindo isso. |

### Correções feitas no código de produção

Quatro problemas apareceram ao escrever os testes e foram corrigidos, cada um
com teste que trava o comportamento:

1. **`lib/google/availability.ts` — exceção do tipo `extra` era ignorada.**
   A função lia `availability_exceptions` mas só usava o caso "dia inteiro
   bloqueado". Uma exceção `extra` (ex: abrir um sábado pontual) nunca gerava
   slot, e um bloqueio parcial (`blocked` com horário) não removia nada. O
   `.maybeSingle()` da consulta também estourava se a data tivesse mais de uma
   exceção. Agora lê a lista inteira e trata os três casos.

2. **`lib/google/availability.ts` — consultas do Supabase não bloqueavam slots.**
   A disponibilidade só descontava eventos do Google Calendar. Numa workspace sem
   calendário conectado, uma consulta já marcada continuava sendo oferecida ao
   paciente — dois pacientes no mesmo horário, que é exatamente o risco clínico
   que este fluxo deveria impedir. Agora `appointments` com status `agendado` ou
   `confirmado` também bloqueiam.

3. **`lib/transcriptions/generate-soap.ts` — `stripMarkdownFence` era inalcançável.**
   O código montava `` stripMarkdownFence(`{${completion}`) ``: como a string
   sempre começava por `{`, o regex de fence jamais casava. Se o modelo
   embrulhasse a resposta em ```` ```json ````, o parse falhava e a transcrição ia
   para retry. A limpeza agora acontece antes de repor a `{`, o que também cobre
   o caso do modelo ignorar o prefill e repetir a chave de abertura.

4. **`lib/transcriptions/types.ts` — `JSON.parse(raw) as SOAPRecord` não validava nada.**
   Um JSON sintaticamente válido mas sem queixa principal ou sem hipótese
   diagnóstica virava `draft_ready` e chegava à tela do médico como prontuário
   completo. Foi extraída `validateSOAPRecord(data: unknown): SOAPRecord`, que
   exige os campos clínicos obrigatórios, normaliza listas ausentes para `[]` e
   descarta campos extras. A falha agora cai no retry que já existia.

### Extração para função pura

`lib/bot/parse-markers.ts` é novo: o parsing dos marcadores
(`AGENDAMENTO_CONFIRMADO`, `CANCELAMENTO_CONFIRMADO`, `NOME_PACIENTE`,
`[HANDOFF]`) estava embutido em `lib/llm/agent.ts`, misturado com acesso ao
banco. Agora é uma função pura testada isoladamente, e `agent.ts` a consome —
o comportamento não mudou.

### Cobertura

Acima do mínimo de 80% de statements em todos os arquivos críticos:
`availability.ts` 97%, `agent.ts` 95%, `reconcile.ts` 93%, `generate-soap.ts` 100%,
`prompt-builder.ts` 100%, `handoff.ts` 97%.

A exceção é `lib/google/auth.ts` (40%): o que falta é o fluxo OAuth de
`exchangeCodeAndSave` e `getAuthUrl`, plumbing de token que não faz parte de
nenhum dos três fluxos. As partes usadas por eles (`isGoogleConnected` e
`getAuthenticatedClient`) estão cobertas.
