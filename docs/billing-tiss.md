# Faturamento TISS: instalação e verificação

O módulo cobre cadastro de operadoras/procedimentos e convênios de pacientes, agendamento por convênio, geração de guias e lotes XML para download. Habilite `billing` na account pelo painel admin; configure prestador, profissional e operadora nas configurações.

## Agendamento pela Clara

A Clara identifica o convênio informado pelo paciente entre as operadoras ativas da conta e confirma a escolha ao agendar. O atendimento salva `insurer_id`, `billing_type = convenio` e o nome em `health_plan`, mesmo sem o módulo de faturamento, e não gera previsão de receita particular. Uma pergunta sobre quais convênios são aceitos não conta como escolha; nomes ambíguos exigem esclarecimento e uma mudança para particular deve ser respeitada.

O marcador interno `CONVENIO_ID` acompanha a confirmação, com o ID real da operadora ou `PARTICULAR`, e é removido da mensagem enviada ao paciente. Uma escolha inválida, ausente quando há convênios ou uma falha ao consultar operadoras impede a confirmação e pede esclarecimento; numa remarcação bloqueada, a consulta antiga é preservada. A Clara não coleta carteirinha, autorização nem procedimento TUSS: a equipe completa esses campos na agenda ou na guia. O módulo `billing` continua necessário para gerar guias e lotes.

## SQL

- Instalação inicial: execute `supabase/billing.sql` no SQL Editor.
- Se o faturamento já foi instalado antes desta revisão: execute somente `supabase/billing-authenticated.sql` antes de publicar o código atualizado.
- Registre o job `tiss-batches` de `supabase/cron.sql`, que segue a autenticação e Vault dos demais jobs.
- `supabase/schema.sql` contém as mesmas mudanças e serve para reconstrução completa de ambientes vazios.

As funções `ensure_tiss_guide_for_appointment`, `tiss_professional_for_appointment`, `next_tiss_number` e `finalize_tiss_batch` são parte da migração. O novo contrato de finalização exige as versões `updated_at` dos snapshots; isso impede que uma edição simultânea seja incluída num lote cujo XML contém os dados anteriores.

## Credenciais e privacidade

Rotas de usuário consultam e alteram o banco com `createClient` e RLS. Um membro pode disparar a geração automática por um RPC autorizado pelo workspace, que retorna apenas IDs, status e metadados de analytics. O snapshot e o CID são montados dentro do banco e não retornam ao membro.

Foi aprovada na sessão uma exceção exclusiva para Storage: `lib/billing/storage.ts` expõe somente o bucket privado usando a credencial de serviço. Upload e signed URL nas rotas manuais ocorrem após a checagem owner/admin. O banco usa o client autenticado. O bucket continua sem policies de leitura para usuários, e a signed URL expira em cinco minutos.

O cron usa a credencial de serviço para a varredura e os lotes programados. Logs/Sentry de geração usam somente IDs. Mensagens do validador guardam apenas o elemento e a categoria do diagnóstico; os valores originais são descartados, inclusive quando contêm apóstrofos. As áreas com dados do paciente e o seletor de carteirinhas recebem `ph-no-capture`/`ph-mask`, inclusive nos portais de dialog e select, para bloquear autocapture e replay do PostHog.

## XML e verificação

O runtime Node valida cada lote contra os XSDs oficiais usando `xmllint-wasm`, sem binário nativo. `next.config.ts` inclui os schemas nas funções da Vercel e mantém o pacote WASM externo. A origem e os hashes dos XSDs constam em `lib/tiss/schemas/4.03.00/README.md`.

```sh
npx vitest run tests/billing tests/tiss tests/nav/tabs.test.ts
npx tsc --noEmit
npm run build
npm run tiss:validate -- caminho/lote-ficticio.xml
```

`tests/billing/database.test.ts` executa a migração de produção em PostgreSQL em memória (PGlite), com dados fictícios, papéis e RLS. Confere isolamento, geração por membro, data SP/CID, sequência, idempotência, finalização/envio e recusa de snapshots alterados. PGlite usa uma conexão: a disputa de locks entre conexões independentes deve ser conferida em um Supabase de teste.

Upload/download contra um Storage real e telas com uma account configurada exigem um ambiente de homologação. Nenhuma migração foi aplicada a um Supabase remoto nesta sessão.
