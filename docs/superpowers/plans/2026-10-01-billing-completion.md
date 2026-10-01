# Conclusão do faturamento TISS: implementação existente

**Objetivo:** conferir as fases 1 e 2 do prompt e corrigir as lacunas da implementação já presente em `8bbc53b`.

**Especificação:** prompt do usuário nesta sessão; TISS 4.03.00, owner/admin para guias e lotes, membros podem agendar por convênio, sem alterações no bot, agente financeiro ou caixa.

**Arquitetura:** rotas autenticadas usam `createClient` e RLS. A geração automática por membros passa por uma função SQL restrita ao agendamento acessível, sem retornar o snapshot. A finalização de lote é transacional. Storage privado depende da escolha solicitada ao usuário.

- [x] Conferir implementação existente, documentação local de Route Handlers, tipagem e testes de faturamento.
- [x] Acrescentar testes de regressão para geração autenticada, atualização do snapshot e uso de RLS no lote manual.
- [x] Remover acesso administrativo ao banco das rotas de faturamento e da geração em eventos do usuário; espelhar funções e grants em `billing.sql` e `schema.sql`.
- [x] Resolver upload/download privado conforme resposta do usuário.
- [x] Conferir XSDs e regra oficial do hash, cron e configurações da versão.
- [x] Executar testes de faturamento/TISS, TypeScript, lint dos arquivos alterados e build; registrar limites da verificação.

## Evidência inicial

- `npx tsc --noEmit`: passou.
- `npx vitest run tests/billing tests/tiss tests/nav/tabs.test.ts`: 6 arquivos, 91 testes passaram, incluindo XML contra os XSDs.
- `npm test`: 5 timeouts nos testes do agente financeiro; 1.117 testes passaram.
- Lacuna confirmada: `createAdminClient` no lote manual, download, atualização de snapshot e geração automática.
- Restrição a esclarecer: signed URL e upload em bucket privado sem policies de usuário exigem credencial de serviço; o prompt permite essa credencial somente no cron.

## Verificações críticas

- Membro pode concluir consulta e produzir uma guia sem obter acesso de leitura a guias/lotes ou ao prontuário de outro médico.
- Funções SQL autenticadas não permitem trocar account, workspace, profissional ou autoria.
- Duas chamadas para o mesmo agendamento e duas finalizações sobre as mesmas guias não criam duplicatas.
- Erros e analytics não contêm dados do paciente.
- Dados de configuração exigidos continuam disponíveis ao atualizar o snapshot de um médico diferente do usuário atual.

## Conclusão e decisões

- Usuário aprovou credencial de serviço exclusiva para Storage após checagem owner/admin. O banco usa RLS nas rotas de usuário.
- A geração por membros usa RPC restrito ao workspace, sem retornar o snapshot. O SQL reserva a numeração e insere a guia na mesma transação.
- Finalização autenticada confere `updated_at`, total, account, operadora, tipo e autoria; recusa edição simultânea ou guia já incluída num lote.
- PGlite foi acrescentado somente como dependência de testes: 7 testes executam as migrações e RLS de produção em PostgreSQL em memória. A instalação local de PostgreSQL não tinha `postgres.bki`, então não foi utilizada.
- Corrigida mensagem de validador que podia expor parte de uma carteirinha com apóstrofo; teste de regressão comprovou a falha e a correção.
- Áreas com dados de pacientes, inclusive portais de edição/carteirinhas, bloqueiam autocapture e replay do PostHog.
- XSDs conferidos byte a byte com o ZIP oficial da ANS; hashes/origem em `lib/tiss/schemas/4.03.00/README.md`.
- `tsx` registrado como dependência de desenvolvimento para executar o validador CLI sem instalação implícita. Lote fictício de três guias: XML válido e hash confere.
- Suíte completa com `--maxWorkers=2`: 92 arquivos, 1.135 testes passaram; os timeouts iniciais não se repetiram com concorrência limitada.
- TypeScript, lint dos arquivos alterados e build passaram. Artefatos de deploy incluem XSDs e `xmllint.wasm` nas rotas manual e cron.
- Verificação final: 104 testes de faturamento/TISS/navegação passaram. O último build passou com acesso à rede; a falha intermediária no sandbox foi apenas o download de Geist/Geist Mono do Google Fonts.
- Revisão independente não encontrou bugs concretos; conferiu os trechos críticos apesar da compressão automática de saídas.
- Limites: disputa de locks entre conexões independentes, telas autenticadas e Storage real precisam de homologação. Nenhum SQL remoto foi executado. Instalação/atualização descrita em `docs/billing-tiss.md`.
