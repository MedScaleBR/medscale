# Plano de integracao ProDoctor

## Objetivo

Integrar o MedScale com a API aberta do ProDoctor para sincronizar dados clinicos operacionais, principalmente agenda, pacientes, usuarios/profissionais e procedimentos.

## O que ja sabemos

- A API aberta e disponibilizada para clientes ProDoctor Cloud +Clinica e +Corp.
- A documentacao oficial deve ser solicitada ao suporte ou gerente de contas da ProDoctor.
- A integracao usa chave de API e senha criadas no ProDoctor Cloud.
- A permissao da chave define quais dados podem ser acessados ou alterados.
- A ProDoctor registra auditoria das acoes feitas pela chave de API.
- Ha limites de transacao por segundo/minuto, entao a integracao precisa ter retry com backoff e evitar sincronizacoes agressivas.

## Endpoints publicamente indicados

Estes endpoints aparecem em materiais publicos/nao oficiais e devem ser validados contra a documentacao oficial antes de implementar:

- `POST /api/v1/Agenda/Listar`: lista agenda do dia por usuario.
- `POST /api/v1/Agenda/Buscar`: busca agendamentos de um paciente.
- `POST /api/v1/Agenda/Livres`: busca horarios livres.
- `POST /api/v1/Agenda/Inserir`: cria agendamento.
- `PATCH /api/v1/Agenda/Desmarcar`: desmarca/cancela agendamento.
- `PUT /api/v1/Agenda/Alterar`: remarca/altera agendamento.
- `POST /api/v1/Agenda/Detalhar`: detalha agendamento.
- `PATCH /api/v1/Agenda/AlterarStatus`: altera status.
- `POST /api/v1/Pacientes`: lista/pesquisa pacientes.
- `GET /api/v1/Pacientes/Detalhar/{codigo}`: detalha paciente.
- `POST /api/v1/Usuarios`: lista usuarios/profissionais.
- `GET /api/v1/Usuarios/Detalhar/{codigo}`: detalha usuario/profissional.
- `POST /api/v1/Procedimentos`: pesquisa procedimentos.
- `GET /api/v1/TabelasProcedimentos`: lista tabelas de procedimentos.

## Decisao de arquitetura

Hoje o MedScale usa Google Calendar como fonte de verdade quando conectado:

- `app/api/appointments/route.ts` cria evento no Google antes de salvar no Supabase.
- `lib/google/reconcile.ts` reconcilia Google Calendar para `appointments`.
- `appointments.gcal_event_id` guarda o id externo do Google.

Com ProDoctor, precisamos escolher uma fonte de verdade:

1. ProDoctor como fonte de verdade da agenda.
   - Recomendado quando a clinica ja opera a agenda no ProDoctor.
   - MedScale passa a consultar e criar/remarcar/cancelar no ProDoctor.
   - Supabase vira espelho local para CRM, bot, receita e transcricoes.

2. MedScale como fonte de verdade.
   - So faz sentido se a clinica quiser abandonar agenda ativa no ProDoctor.
   - Maior risco de conflito operacional.

3. Google Calendar continua como fonte de verdade.
   - Simples para o estado atual do app, mas nao resolve integracao real com ProDoctor.

Recomendacao inicial: ProDoctor como fonte de verdade para agenda em contas/unidades que ativarem essa integracao.

## MVP sugerido

1. Configuracao por workspace/account:
   - `prodoctor_enabled`
   - `prodoctor_base_url`
   - credenciais/chave em storage seguro
   - mapeamento `workspace_id` -> local/unidade ProDoctor
   - mapeamento `doctor/user` -> usuario ProDoctor

2. Cliente HTTP isolado:
   - `lib/prodoctor/client.ts`
   - timeouts curtos
   - logs sanitizados
   - retry com backoff apenas para falhas transientes
   - nunca logar chave/senha

3. Sincronizacao de leitura:
   - buscar agenda por periodo
   - salvar/atualizar `appointments` como `source = 'importado'` ou `source = 'bot'`
   - guardar id externo em um campo novo, por exemplo `prodoctor_appointment_id`

4. Escrita minima:
   - criar agendamento no ProDoctor quando o bot confirmar horario
   - cancelar/desmarcar no ProDoctor quando paciente cancelar
   - remarcar no ProDoctor quando mudar data/hora

5. Pacientes:
   - pesquisar paciente por telefone/CPF/nome antes de criar agenda
   - vincular `patients` do MedScale ao codigo do ProDoctor
   - evitar criar duplicados quando ProDoctor ja tem cadastro

## Mudancas provaveis no banco

Campos ou tabela de mapeamento a validar:

- `workspaces.prodoctor_enabled boolean`
- `workspaces.prodoctor_local_id text`
- `workspaces.prodoctor_user_id text`
- `appointments.prodoctor_appointment_id text`
- `patients.prodoctor_patient_id text`
- `procedure_catalog.prodoctor_procedure_id text`
- tabela `prodoctor_credentials` ou equivalente usando service role, sem expor ao client

## Perguntas para a ProDoctor

Enviar ao suporte/gerente de contas:

1. Qual e a URL base da API para producao e existe ambiente sandbox?
2. Qual e o metodo de autenticacao exato?
3. Como a chave/senha devem ser enviadas: header, Basic Auth, bearer token ou outro formato?
4. Quais endpoints estao liberados na nossa chave?
5. Quais sao os limites de requisicoes por segundo/minuto?
6. Existe webhook para alteracoes na agenda/pacientes ou a integracao precisa fazer polling?
7. Quais campos obrigatorios para inserir agendamento?
8. Como representar confirmar, cancelar, remarcar, no-show e realizado?
9. O endpoint de horarios livres considera bloqueios, feriados, duracao e tipo de procedimento?
10. Qual timezone esperado nos payloads?
11. Qual identificador usar para unidade/local, usuario/profissional, paciente e procedimento?
12. Ha idempotencia para criar agendamento, ou devemos controlar duplicidade do lado MedScale?

## Ordem de implementacao recomendada

1. Obter documentacao oficial e credenciais de teste.
2. Criar cliente ProDoctor com testes unitarios mockados.
3. Criar tabela/campos de mapeamento externo.
4. Implementar leitura de agenda ProDoctor para espelhar em `appointments`.
5. Integrar criacao/cancelamento/remarcacao ao fluxo do bot e da tela de agenda.
6. Adicionar tela/configuracao para habilitar por conta/unidade.
7. Rodar piloto em uma unidade antes de ativar para todos.

## Fontes consultadas

- Blog oficial ProDoctor: `https://prodoctor.net/blog/api-aberta-prodoctor/`
- Pagina oficial de ecossistema ProDoctor: `https://prodoctor.net/funcionalidades/ecossistema-prodoctor/`
- Listagem publica nao oficial de endpoints: `https://github.com/dotojr123/mcp-prodoctor/blob/master/ENDPOINTS-API.md`
