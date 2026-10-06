# Autorizações TISS (Solicitação SP/SADT, Internação, Anexo OPME) — design

Data: 2026-10-05. Branch: `feat/tiss-autorizacoes` (a partir de `dev`).
Referência XSD (fonte de verdade, derivada de `lib/tiss/schemas/4.03.00`): `2026-10-05-tiss-autorizacoes-xsd.md`.

## Restrição de produção

O sistema tem usuários reais. Nada destrutivo:
- migration nova é **aditiva**: só `create … if not exists`, novas funções, novas policies em tabelas novas. Nenhum `drop`/`alter` em `tiss_guides`, `tiss_batches`, `appointments`, `profiles` nem nas funções existentes de faturamento.
- nenhuma migration é aplicada em Supabase nenhum pelo agente; o usuário roda no SQL Editor.
- o faturamento atual (guias, lotes, cron, XML `ENVIO_LOTE_GUIAS`) não muda de comportamento; o XML gerado por `buildBatch` fica byte a byte igual.

## Decisões

**D1 — Tabelas próprias.** Autorizações não entram em `tiss_guides`. A "categoria" é a tabela:
- `tiss_authorizations` (cabeçalho): `id`, `account_id`, `workspace_id`, `patient_id`, `insurer_id`, `appointment_id` (nullable, sem UNIQUE), `parent_id` (self-FK; obrigatório sse `type='opme_request'`, e o pai tem de ser `sp_sadt_request`/`hospitalization_request` da mesma account/paciente/operadora), `type` (`sp_sadt_request | hospitalization_request | opme_request`, text+CHECK), `status` (text+CHECK, D3), `provider_guide_number` (UNIQUE por `insurer_id`), `payload jsonb` (snapshot), `missing_fields text[]`, campos de resposta (`operator_guide_number`, `password`, `authorization_date`, `password_valid_until`, `response_status_code` = `dm_statusSolicitacao`), `requested_at`, `sent_at`, `responded_at`, `created_by`, `updated_by`, timestamps.
- `tiss_authorization_items`: `authorization_id`, `account_id`, `position`, `kind` (`procedure | opme`), `table_code`, `code`, `description`, `quantity_requested`, `quantity_authorized` (resposta), e para OPME `manufacturer_option`, `requested_value_cents`, `authorized_value_cents`, `anvisa_registration`, `manufacturer_reference`, `operating_authorization`.
- `tiss_authorization_events` (append-only): `authorization_id`, `account_id`, `event` (`created | updated | items_changed | refreshed | ready | sent | response_recorded | cancelled | xml_generated`), `from_status`, `to_status`, `actor_id`, `data jsonb` (sem PHI além do necessário: números/senha retornados), `created_at`. Escrita só por RPC/trigger; sem update/delete.
- Futuro (fora do escopo): `tiss_guides.authorization_id` nullable; tabela de itens para faturamento quando entrar Resumo de Internação/Honorários; troca de `UNIQUE(appointment_id)` por índice parcial nesse momento.

**D2 — Sem tabela de episódio.** Relação = `patient_id` + `appointment_id?` + `parent_id`.

**D3 — Máquina de estados própria** (text + CHECK), transições validadas em RPC `security definer` que grava evento na mesma transação:
```
draft ⇄ ready → sent → under_review | pending_info | authorized | partially_authorized | denied
under_review | pending_info → authorized | partially_authorized | denied | pending_info | under_review
draft | ready | sent | under_review | pending_info → cancelled
```
Mapeamento `dm_statusSolicitacao`: 1→authorized, 2→under_review, 3→denied, 4/5→pending_info, 6→cancelled, 7→partially_authorized. `draft`/`ready` calculados por `missing_fields` como no faturamento. Edição de conteúdo só em `draft`/`ready`.
Correção (R1, 2026-10-06): a resposta pode ser registrada de novo sobre `authorized | partially_authorized | denied` (`authorized | partially_authorized | denied → qualquer status da resposta`, gravando novo evento `response_recorded`); nunca a partir de `draft | ready | cancelled`. Estados finais continuam sem cancelamento.

**D4 — Numeração.** `provider_guide_number` vem de `next_tiss_number('guide')` (mesmo contador `next_guide_number` da operadora). Sem alteração da função. Viável porque só owner/admin criam (P1) e a função exige `is_account_admin`; `create_tiss_authorization` a chama de dentro do RPC.

**D5 — XML.**
- SP/SADT e Internação: `mensagemTISS/prestadorParaOperadora/solicitacaoProcedimento/{solicitacaoSP-SADT|solicitacaoInternacao}`, `tipoTransacao=SOLICITACAO_PROCEDIMENTOS`, uma solicitação por mensagem. Se houver exatamente 1 OPME não cancelado vinculado, ele é embutido em `anexoClinico/solicitacaoOPME`; com 0 ou ≥2, não embute.
- OPME: sempre gerável avulso, `prestadorParaOperadora/loteAnexos/AnexosGuiasTISS/anexoSolicitacaoOPME`, `tipoTransacao=ENVIO_ANEXO`, `numeroGuiaReferenciada` = `provider_guide_number` do pai; `numeroLote` = `provider_guide_number` do próprio anexo.
- Cabeçalho/epilogo/hash reaproveitados de `lib/tiss/v4_03_00` (extrair `cabecalho` parametrizado sem alterar a saída de `buildBatch`). Validação com `validateAgainstSchemas` atual.
- XML não é persistido em storage; é gerado sob demanda no download (determinístico a partir do snapshot) e registra evento `xml_generated`.
- Divergências documentadas: `tipoTransacao` inferido pelo nome (XSD não amarra); tabela 19 para OPME é inferida; solicitações não têm campos de senha/validade (vêm só na resposta).

**D6 — Resposta manual.** Usuário registra status, número da guia na operadora, senha, data de autorização, validade da senha e quantidade/valor autorizado por item. Sem parse de XML de resposta, sem webservice.

## Permissões e UI (decididas pelo product owner em 2026-10-06 — P1–P4, R1–R4)

- **Só `owner`/`admin`** (P1): criar, editar, recarregar, trocar itens, marcar envio, cancelar, registrar/corrigir resposta e baixar XML. `member` não tem acesso nenhum — nem leitura.
- RLS: `select` só com `is_account_admin(account_id)` nas três tabelas (mesma regra de `tiss_guides`/`tiss_batches`); escrita direta bloqueada — insert/update só via RPCs `security definer` que checam `is_account_admin` (member → `tiss_authorization_forbidden`; outra account → `not_found`).
- API em `app/api/billing/authorizations/**` com `requireBilling({ adminOnly: true })`, o mesmo guard de `/api/billing/guides` (exige módulo `billing` ligado na account e papel owner/admin).
- Nav (P2, opção a): label "Convênios / TISS" na rota `/faturamento`; `billing` continua em `ADMIN_MIN_MODULES`, então member não vê o menu nem a página. Abas fixas **Autorizações | Guias | Lotes**, sem filtro por papel.
- Criação: botão "Solicitar autorização" em `AppointmentModal` (seção convênio), renderizado só para owner/admin (P3); "Nova autorização" na aba; "Adicionar OPME" dentro de SP/SADT/Internação.
- Profissional solicitante (R3): escolhido entre os profissionais da account com CRM (RPC security definer, só owner/admin, devolvendo apenas id, nome, CRM, UF e CBO), snapshot no payload. Telefone/e-mail do solicitante não vêm de `profiles`: são digitados na autorização (obrigatório no OPME).
- Exclusão de paciente (R2): paciente com autorização não é excluído; `DELETE /api/patients/[id]` responde 409 "Este paciente tem autorizações TISS e não pode ser excluído.".

## Snapshot

`payload` congela operadora (registroANS, código do prestador), contratado solicitante (workspace CNPJ/código/nome), profissional (nome, conselho=06, número, UF, CBO; telefone e e-mail digitados na autorização — R3), beneficiário (carteira, atendimentoRN), e campos clínicos digitados. "Recarregar dados" só em `draft`/`ready`, preservando o que foi digitado (padrão `mergeRefreshedPayload`).
