# TISS 4.03.00 — Solicitações de autorização (SP/SADT, Internação, Anexo OPME): especificação a partir dos XSDs

Fonte: `lib/tiss/schemas/4.03.00/*.xsd` (oficiais da ANS, conferidos por SHA-256 no README). Nada aqui foi inventado; quando o XSD não define algo, isso está marcado como **[AMBÍGUO]** ou **[INFERIDO]**.
Notação: `[1]` = obrigatório (minOccurs=1, maxOccurs=1), `[0..1]` = opcional, `[1..n]` = obrigatório e repetível sem limite (`maxOccurs="unbounded"`), `[0..4]` etc. Ordem = ordem do documento (`<sequence>`), que o validador exige.

---

## 1. Envelope da mensagem (`tissV4_03_00.xsd`)

### 1.1 Estrutura do `mensagemTISS`

```xml
<element name="mensagemTISS">
  <complexType><sequence>
    <element name="cabecalho" type="ans:cabecalhoTransacao"/>
    <choice>
      <element name="operadoraParaPrestador" type="ans:operadoraPrestador" minOccurs="0"/>
      <element name="prestadorParaOperadora" type="ans:prestadorOperadora" minOccurs="0"/>
    </choice>
    <element name="epilogo" type="ans:epilogo"/>
    <element ref="ds:Signature" minOccurs="0"/>
  </sequence></complexType>
</element>
```

- Namespace alvo (único para todo o TISS): `http://www.ans.gov.br/padroes/tiss/schemas` (`elementFormDefault="qualified"` → todos os elementos qualificados, como o `serialize()` já faz com prefixo `ans:`). Assinatura: `ds:Signature` do namespace `http://www.w3.org/2000/09/xmldsig#`, opcional.
- `epilogo` é obrigatório: `<complexType name="epilogo"><sequence><element name="hash" type="string"/></sequence></complexType>`. O XSD só exige uma string; a regra MD5 vem do Componente Organizacional (já implementada em `lib/tiss/v4_03_00/hash.ts`) — o mesmo cálculo serve para qualquer tipo de mensagem (valores de `cabecalho` + `prestadorParaOperadora`).

### 1.2 `cabecalho` (`cabecalhoTransacao`) — idêntico ao do lote de guias

```
cabecalho
├─ identificacaoTransacao [1]
│  ├─ tipoTransacao        [1] dm_tipoTransacao (enum, abaixo)
│  ├─ sequencialTransacao  [1] st_texto12 (string 1..12)
│  ├─ dataRegistroTransacao[1] st_data (xs:date → AAAA-MM-DD)
│  └─ horaRegistroTransacao[1] st_hora (xs:time → hh:mm:ss)
├─ falhaNegocio            [0..1] dm_tipoGlosa  (usado em respostas)
├─ origem [1]  choice: identificacaoPrestador (ct_prestadorIdentificacao: choice CNPJ | CPF | codigoPrestadorNaOperadora) | registroANS
├─ destino [1] choice: identificacaoPrestador (ct_prestadorIdentificacao) | registroANS (st_registroANS)
├─ Padrao                  [1] dm_versao  ("4.03.00")   ← "P" maiúsculo
└─ loginSenhaPrestador     [0..1] ct_loginSenha (loginPrestador st_texto20, senhaPrestador st_texto32)
```

### 1.3 `dm_tipoTransacao` — TODOS os valores (tissSimpleTypesV4_03_00.xsd, linha 3876)

```
ENVIO_LOTE_GUIAS, ENVIO_ANEXO, SOLIC_DEMONSTRATIVO_RETORNO, SOLIC_STATUS_PROTOCOLO,
SOLICITACAO_PROCEDIMENTOS, SOLICITA_STATUS_AUTORIZACAO, VERIFICA_ELEGIBILIDADE, CANCELA_GUIA,
COMUNICACAO_BENEFICIARIO, RECURSO_GLOSA, SOLIC_STATUS_RECURSO_GLOSA, ENVIO_DOCUMENTO,
PROTOCOLO_RECEBIMENTO, PROTOCOLO_RECEBIMENTO_ANEXO, RECEBIMENTO_RECURSO_GLOSA,
DEMONSTRATIVO_ANALISE_CONTA, DEMONSTRATIVO_PAGAMENTO, DEMONSTRATIVO_ODONTOLOGIA,
SITUACAO_PROTOCOLO, RESPOSTA_SOLICITACAO, AUTORIZACAO_ODONTOLOGIA, STATUS_AUTORIZACAO,
SITUACAO_ELEGIBILIDADE, CANCELAMENTO_GUIA_RECIBO, RECIBO_COMUNICACAO, RESPOSTA_RECURSO_GLOSA,
RECEBIMENTO_DOCUMENTO
```
(27 valores. Existem também `dm_tipoTransacaoANS` = `MONITORAMENTO` e `dm_tipoTransacaoQualidade` = `QUALIDADE`, de outros schemas, irrelevantes aqui.)

### 1.4 Ramo `prestadorParaOperadora` (`prestadorOperadora` — um `<choice>`, exatamente UM filho)

```xml
<complexType name="prestadorOperadora"><choice>
  <element name="loteGuias" type="ans:ctm_guiaLote" minOccurs="0"/>
  <element name="loteAnexos" type="ans:ct_anexoLote" minOccurs="0"/>
  <element name="solicitacaoDemonstrativoRetorno" .../>
  <element name="solicitacaoStatusProtocolo" .../>
  <element name="solicitacaoProcedimento" type="ans:ct_solicitacaoProcedimento" minOccurs="0"/>
  <element name="solicitaStatusAutorizacao" type="ans:ct_autorizacaoSolicitaStatus" minOccurs="0"/>
  <element name="verificaElegibilidade" .../>  <element name="cancelaGuia" .../>
  <element name="comunicacaoInternacao" .../>  <element name="recursoGlosa" .../>
  <element name="solicitacaoStatusRecursoGlosa" .../>  <element name="envioDocumentos" .../>
</choice></complexType>
```

`ct_solicitacaoProcedimento` é só uma extensão vazia de `ctm_solicitacaoLote` (ComplexTypes l.1471):

```xml
<complexType name="ct_solicitacaoProcedimento">
  <complexContent><extension base="ans:ctm_solicitacaoLote"/></complexContent>
</complexType>
<!-- tissGuias l.804 -->
<complexType name="ctm_solicitacaoLote">
  <choice>
    <element name="solicitacaoSP-SADT" type="ans:ctm_sp-sadtSolicitacaoGuia"/>
    <element name="solicitacaoInternacao" type="ans:ctm_internacaoSolicitacaoGuia"/>
    <element name="solicitacaoProrrogacao" type="ans:ctm_prorrogacaoSolicitacaoGuia"/>
    <element name="solicitacaoOdontologia" type="ans:cto_odontoSolicitacaoGuia"/>
  </choice>
</complexType>
```

**Conclusões:**
- Solicitação SP/SADT → `mensagemTISS/prestadorParaOperadora/solicitacaoProcedimento/solicitacaoSP-SADT`.
- Solicitação de Internação → `mensagemTISS/prestadorParaOperadora/solicitacaoProcedimento/solicitacaoInternacao`.
- **Uma única solicitação por mensagem**: o `<choice>` não tem `maxOccurs`, logo vale 1. Apesar do nome "Lote", `ctm_solicitacaoLote` NÃO tem `numeroLote` nem repetição. Contraste com `ENVIO_LOTE_GUIAS`: `loteGuias` (`ctm_guiaLote`) = `numeroLote` + `guiasTISS` com choice de guias `maxOccurs="100"`.
- `tipoTransacao`: **[INFERIDO]** o XSD não amarra o valor do enum ao ramo do choice; pela correspondência de nomes: `solicitacaoProcedimento` → `SOLICITACAO_PROCEDIMENTOS`; `loteAnexos` → `ENVIO_ANEXO`; `solicitaStatusAutorizacao` → `SOLICITA_STATUS_AUTORIZACAO`; `cancelaGuia` → `CANCELA_GUIA`. Respostas da operadora: `autorizacaoServicos` → provavelmente `RESPOSTA_SOLICITACAO`; `situacaoAutorizacao` → `STATUS_AUTORIZACAO`; `recebimentoAnexo` → `PROTOCOLO_RECEBIMENTO_ANEXO`. Confirmar no Componente Organizacional/manual se for preciso certeza.
- No webservice (`tissWebServicesV4_03_00.xsd`), a mesma solicitação vai em `solicitacaoProcedimentoWS` = `cabecalho` + `solicitacaoProcedimento` (ct_solicitacaoProcedimento) + `hash` + `Signature?`; a resposta é `autorizacaoProcedimentoWS` (`autorizacaoProcedimento`: ct_situacaoAutorizacao). O anexo avulso vai em `loteAnexoWS` (`loteAnexo`: ct_anexoLote) e a resposta em `protocoloRecebimentoAnexoWS`.

### 1.5 Como trafega o Anexo OPME — DUAS formas válidas

**(a) Embutido na solicitação** — `ctm_sp-sadtSolicitacaoGuia` e `ctm_internacaoSolicitacaoGuia` (e `ctm_prorrogacaoSolicitacaoGuia` como `anexoClinicoProrrogacao`) têm:

```xml
<element name="anexoClinico" minOccurs="0">
  <complexType><sequence>
    <element name="solicitacaoQuimioterapia" type="ans:ctm_anexoSolicitacaoQuimio" minOccurs="0"/>
    <element name="solicitacaoRadioterapia"  type="ans:ctm_anexoSolicitacaoRadio"  minOccurs="0"/>
    <element name="solicitacaoOPME"          type="ans:ctm_anexoSolicitacaoOPME"   minOccurs="0"/>
  </sequence></complexType>
</element>
```
→ no máximo 1 anexo de cada tipo por solicitação; nesta ordem (Quimio, Radio, OPME). Caminho: `.../solicitacaoSP-SADT/anexoClinico/solicitacaoOPME`.

**(b) Avulso, em mensagem própria** — `prestadorParaOperadora/loteAnexos` (`ct_anexoLote`, tipoTransacao [INFERIDO] `ENVIO_ANEXO`):

```xml
<complexType name="ct_anexoLote">
  <annotation><documentation> estrutura da resposta da operadora a um lote de anexos</documentation></annotation>
  <sequence>
    <element name="numeroLote" type="ans:st_texto12"/>
    <element name="AnexosGuiasTISS">     <!-- "A" maiúsculo -->
      <complexType><choice>
        <element name="anexoSituacaoInicial" type="ans:cto_anexoSituacaoInicial" maxOccurs="100"/>
        <element name="anexoSolicitacaoRadio" type="ans:ctm_anexoSolicitacaoRadio"/>
        <element name="anexoSolicitacaoQuimio" type="ans:ctm_anexoSolicitacaoQuimio"/>
        <element name="anexoSolicitacaoOPME" type="ans:ctm_anexoSolicitacaoOPME"/>
      </choice></complexType>
    </element>
  </sequence>
</complexType>
```
→ "lote" de anexos tem `numeroLote` mas **um único** `anexoSolicitacaoOPME` (só o odontológico `anexoSituacaoInicial` repete até 100). **[AMBÍGUO]** a `documentation` diz "resposta da operadora", mas o tipo é usado em `prestadorOperadora/loteAnexos` (envio do prestador) e em `loteAnexoWS`; trata-se de texto copiado — a estrutura é a de envio.

Em ambos os casos o conteúdo é o mesmo tipo `ctm_anexoSolicitacaoOPME`, que carrega no próprio `cabecalhoAnexo` a referência à guia de origem (`numeroGuiaReferenciada`, obrigatória — ver §3).

---

## 2. Árvores completas (ordem do documento)

### Tipos simples usados (resolvidos)

| Tipo | Base / restrições |
|---|---|
| st_texto1/2/4/7/10/11/12/14/15/20/30/32/40/60/70/150/500/1000 | string, minLength=1, maxLength=N (st_texto2 idem) |
| st_data | xs:date (AAAA-MM-DD) |
| st_hora | xs:time (hh:mm:ss) |
| st_numerico2 / 3 / 4 | xs:integer, totalDigits=2 / 3 / 4 (máx. 99 / 999 / 9999) |
| st_decimal10-2 | decimal totalDigits=10 fractionDigits=2 |
| st_decimal7-2 / 5-2 / 4-2 | decimal totalDigits 7/5/4, fractionDigits=2 |
| st_registroANS | string maxLength=6 pattern `[0-9]{6}` |
| st_CNPJ | string pattern `[A-Z0-9]{12}[0-9]{2}` (aceita CNPJ alfanumérico) |
| st_CPF | string pattern `[0-9]{11}` |
| dm_diagnosticoCID10 | string 1..4 pattern `[a-zA-Z0-9]+` (sem ponto) |

### 2.1 Solicitação SP/SADT — `ctm_sp-sadtSolicitacaoGuia` (elemento `solicitacaoSP-SADT`)

```
solicitacaoSP-SADT
├─ cabecalhoSolicitacao [1] ct_guiaCabecalho
│  ├─ registroANS           [1] st_registroANS
│  └─ numeroGuiaPrestador   [1] st_texto20
├─ numeroGuiaPrincipal      [0..1] st_texto20
├─ ausenciaCodValidacao     [0..1] dm_ausenciaCodValidacao
├─ codValidacao             [0..1] st_texto10
├─ tipoEtapaAutorizacao     [1] dm_etapasAutorizacao
├─ dadosBeneficiario        [1] ct_beneficiarioDados
│  ├─ numeroCarteira            [1] st_texto20
│  ├─ atendimentoRN             [1] dm_simNao (S|N)
│  ├─ tipoIdent                 [0..1] dm_tipoIdent
│  └─ identificadorBeneficiario [0..1] xs:base64Binary
├─ dadosSolicitante         [1]
│  ├─ contratadoSolicitante     [1] ct_contratadoDados  (choice, exatamente 1:)
│  │    codigoPrestadorNaOperadora st_texto14 | cpfContratado st_CPF | cnpjContratado st_CNPJ
│  ├─ nomeContratadoSolicitante [1] st_texto70
│  └─ profissionalSolicitante   [1] ct_contratadoProfissionalDados
│     ├─ nomeProfissional           [0..1] st_texto70
│     ├─ conselhoProfissional       [1] dm_conselhoProfissional
│     ├─ numeroConselhoProfissional [1] st_texto15
│     ├─ UF                         [1] dm_UF (código IBGE, length=2)
│     └─ CBOS                       [1] dm_CBOS (enum de 172 códigos; 999999 = desconhecido)
├─ caraterAtendimento       [1] dm_caraterAtendimento
├─ dataSolicitacao          [1] st_data
├─ indicacaoClinica         [0..1] st_texto500
├─ coberturaEspecial        [0..1] dm_cobEsp
├─ procedimentosSolicitados [1..n]   ← o PRÓPRIO elemento repete (não há filho singular)
│  ├─ procedimento              [1] ct_procedimentoDados
│  │  ├─ codigoTabela               [1] dm_tabela
│  │  ├─ codigoProcedimento         [1] st_texto10
│  │  └─ descricaoProcedimento      [1] st_texto150
│  └─ quantidadeSolicitada      [1] st_numerico3
├─ dadosExecutante          [0..1]
│  ├─ codigonaOperadora         [1] st_texto14     ← "na" minúsculo
│  └─ CNES                      [1] st_texto7
├─ anexoClinico             [0..1]
│  ├─ solicitacaoQuimioterapia  [0..1] ctm_anexoSolicitacaoQuimio
│  ├─ solicitacaoRadioterapia   [0..1] ctm_anexoSolicitacaoRadio
│  └─ solicitacaoOPME           [0..1] ctm_anexoSolicitacaoOPME (§2.3)
└─ observacao               [0..1] st_texto500
```

### 2.2 Solicitação de Internação — `ctm_internacaoSolicitacaoGuia` (elemento `solicitacaoInternacao`)

Atenção: **não** tem `cabecalhoSolicitacao`; `registroANS`/`numeroGuiaPrestador` vêm soltos no topo.

```
solicitacaoInternacao
├─ registroANS              [1] st_registroANS
├─ numeroGuiaPrestador      [1] st_texto20
├─ ausenciaCodValidacao     [0..1] dm_ausenciaCodValidacao
├─ codValidacao             [0..1] st_texto10
├─ tipoEtapaAutorizacao     [1] dm_etapasAutorizacao
├─ dadosBeneficiario        [1] ct_beneficiarioDados (como em 2.1)
├─ identificacaoSolicitante [1]
│  ├─ dadosDoContratado          [1] ct_contratadoDados (choice codigoPrestadorNaOperadora | cpfContratado | cnpjContratado)
│  └─ dadosProfissionalContratado[1] ct_contratadoProfissionalDados (como em 2.1)
│     (NÃO há nome do contratado solicitante — diferente da SP/SADT)
├─ dadosHospitalSolicitado  [1]
│  ├─ codigoIndicadonaOperadora [1] st_texto14    ← grafia exata
│  ├─ nomeContratadoIndicado    [1] st_texto70
│  └─ dataSugeridaInternacao    [1] st_data
├─ dadosInternacao          [1]
│  ├─ caraterAtendimento        [1] dm_caraterAtendimento
│  ├─ tipoInternacao            [1] dm_tipoInternacao
│  ├─ regimeInternacao          [1] dm_regimeInternacao
│  ├─ qtDiariasSolicitadas      [1] st_numerico2   (máx. 99)
│  ├─ indicadorOPME             [1] dm_simNao
│  ├─ indicadorQuimio           [1] dm_simNao
│  └─ indicacaoClinica          [1] st_texto500    (obrigatória aqui; opcional na SP/SADT)
├─ hipotesesDiagnosticas    [1]
│  ├─ diagnosticoCID            [0..4] st_texto4   (não dm_diagnosticoCID10: sem pattern, só 1..4 chars)
│  └─ indicadorAcidente         [1] dm_indicadorAcidente
├─ procedimentosSolicitados [1..n]   ← repete o próprio elemento
│  ├─ procedimento              [1] ct_procedimentoDados (codigoTabela, codigoProcedimento, descricaoProcedimento — todos [1])
│  └─ quantidadeSolicitada      [1] st_numerico3
├─ dataSolicitacao          [1] st_data
├─ observacao               [0..1] st_texto1000   (1000 aqui; 500 na SP/SADT)
└─ anexoClinico             [0..1] (mesma estrutura de 2.1: Quimio?, Radio?, OPME?)
```

### 2.3 Anexo de Solicitação de OPME — `ctm_anexoSolicitacaoOPME`

Elemento: `solicitacaoOPME` (dentro de `anexoClinico`) ou `anexoSolicitacaoOPME` (dentro de `loteAnexos/AnexosGuiasTISS`).

```
ctm_anexoSolicitacaoOPME
├─ cabecalhoAnexo           [1] ct_anexoCabecalho
│  ├─ registroANS               [1] st_registroANS
│  ├─ numeroGuiaAnexo           [1] st_texto20   (nº do anexo no prestador)
│  ├─ numeroGuiaReferenciada    [1] st_texto20   (guia de origem — ver §3)
│  ├─ numeroGuiaOperadora       [0..1] st_texto20
│  ├─ dataSolicitacao           [1] st_data
│  ├─ senha                     [0..1] st_texto20
│  └─ dataAutorizacao           [0..1] st_data
├─ dadosBeneficiario        [1] ct_beneficiarioDados (numeroCarteira[1], atendimentoRN[1], tipoIdent?, identificadorBeneficiario?)
├─ profissionalSolicitante  [1] ctm_anexoSolicitante   ← NÃO é ct_contratadoProfissionalDados
│  ├─ nomeProfissional          [1] st_texto70  (obrigatório aqui)
│  ├─ telefoneProfissional      [1] st_texto11
│  └─ emailProfissional         [0..1] st_texto60
├─ justificativaTecnica     [1] st_texto1000
├─ especificacaoMaterial    [0..1] st_texto500
├─ opmeSolicitadas          [1]
│  └─ opmeSolicitada            [1..n]
│     ├─ identificacaoOPME          [1] ct_procedimentoDados (codigoTabela dm_tabela, codigoProcedimento st_texto10, descricaoProcedimento st_texto150)
│     ├─ opcaoFabricante            [1] dm_opcaoFabricante
│     ├─ quantidadeSolicitada       [1] st_numerico3
│     ├─ valorSolicitado            [0..1] st_decimal10-2
│     ├─ registroANVISA             [0..1] st_texto15
│     ├─ codigoRefFabricante        [0..1] st_texto60
│     └─ autorizacaoFuncionamento   [0..1] st_texto30
└─ Observacao               [0..1] st_texto500    ← "O" MAIÚSCULO (único no schema)
```

### 2.4 Quimioterapia / Radioterapia (só listagem — existem)

- `ctm_anexoSolicitacaoQuimio`: cabecalhoAnexo, dadosBeneficiario, dadosComplementaresBeneficiario (peso st_decimal5-2, altura st_decimal5-2, superficieCorporal st_decimal4-2, idade st_numerico3, sexo dm_sexo), medicoSolicitante (ctm_anexoSolicitante), diagnosticoOncologicoQuimioterapia (diagQuimio ct_diagnosticoOncologico, tumor dm_tumor, nodulo dm_nodulo, metastase dm_metastase, tipoQuimioterapia, planoTerapeutico st_texto1000), drogasSolicitadas/drogaSolicitada [1..n] (ct_drogasSolicitadas: dataProvavel, identificacao ct_procedimentoDados, qtDoses st_decimal7-2, unidadeMedida dm_unidadeMedida, viaAdministracao dm_viaAdministracao, frequencia st_numerico2), tratamentosAnteriores?, numeroCiclos, cicloAtual, diasCicloAtual, intervaloCiclos, observacao?.
- `ctm_anexoSolicitacaoRadio`: cabecalhoAnexo, dadosBeneficiario, dadosComplementaresBeneficiario (ct_dadosComplementaresBeneficiarioRadio: idade, sexo), medicoSolicitante, diagnosticoOncologicoRadio (diagRadio, diagnosticoImagem?), tratamentosAnteriores?, numeroCampos, doseCampo, doseTotal, nrDias, dtPrevistaInicio, observacao?.
- `ct_diagnosticoOncologico`: dataDiagnostico?, diagnosticoCID [0..4] dm_diagnosticoCID10, estadiamento, finalidade, ecog, diagnosticoHispatologico? (grafia do XSD), infoRelevantes?.
- Também existe `ctm_prorrogacaoSolicitacaoGuia` (`solicitacaoProrrogacao`) no mesmo choice — fora do escopo.

---

## 3. Destaques

### Obrigatório × opcional (resumo do que o gerador precisa sempre emitir)

- **SP/SADT**: cabecalhoSolicitacao(registroANS, numeroGuiaPrestador), tipoEtapaAutorizacao, dadosBeneficiario(numeroCarteira, atendimentoRN), dadosSolicitante(contratadoSolicitante, nomeContratadoSolicitante, profissionalSolicitante(conselho, número, UF, CBOS)), caraterAtendimento, dataSolicitacao, ≥1 procedimentosSolicitados. Opcionais: numeroGuiaPrincipal, ausenciaCodValidacao, codValidacao, indicacaoClinica, coberturaEspecial, dadosExecutante (se presente, codigonaOperadora e CNES ambos [1]), anexoClinico, observacao.
- **Internação**: registroANS, numeroGuiaPrestador, tipoEtapaAutorizacao, dadosBeneficiario, identificacaoSolicitante (ambos filhos), dadosHospitalSolicitado (3 filhos), dadosInternacao (7 filhos, todos [1]), hipotesesDiagnosticas.indicadorAcidente, ≥1 procedimentosSolicitados, dataSolicitacao. Opcionais: ausenciaCodValidacao, codValidacao, diagnosticoCID (0..4), observacao, anexoClinico.
- **OPME**: cabecalhoAnexo(registroANS, numeroGuiaAnexo, numeroGuiaReferenciada, dataSolicitacao), dadosBeneficiario, profissionalSolicitante(nome, telefone), justificativaTecnica, ≥1 opmeSolicitada (identificacaoOPME, opcaoFabricante, quantidadeSolicitada). Opcionais: numeroGuiaOperadora, senha, dataAutorizacao, especificacaoMaterial, valorSolicitado, registroANVISA, codigoRefFabricante, autorizacaoFuncionamento, Observacao.

### Listas repetíveis
| Onde | Elemento | Cardinalidade |
|---|---|---|
| SP/SADT | `procedimentosSolicitados` | 1..unbounded (sem teto no XSD) |
| Internação | `procedimentosSolicitados` | 1..unbounded |
| Internação | `hipotesesDiagnosticas/diagnosticoCID` | 0..4 |
| OPME | `opmeSolicitadas/opmeSolicitada` | 1..unbounded |
| Qualquer solicitação | `anexoClinico/solicitacaoOPME` | 0..1 |
| Mensagem | solicitação por `solicitacaoProcedimento` | exatamente 1 |
| Mensagem `loteAnexos` | `anexoSolicitacaoOPME` | exatamente 1 |

Não há `sequencialItem` nos itens solicitados (só nos executados/autorizados). Os limites de 12 linhas (internação) e 6 linhas (OPME) são do formulário em papel, não do XSD.

### Referência do anexo OPME à guia de origem
`cabecalhoAnexo/numeroGuiaReferenciada` (st_texto20, **obrigatório**). O XSD não diz se é o nº do prestador ou da operadora **[AMBÍGUO]**; o formulário em papel rotula o campo 3 como "Número da Guia Referenciada". Além dele, `cabecalhoAnexo` tem `numeroGuiaOperadora`, `senha` e `dataAutorizacao` opcionais (campos 6, 4, 5 do formulário). Quando o anexo vai embutido na solicitação, `numeroGuiaReferenciada` continua obrigatório — natural preencher com o `numeroGuiaPrestador` da própria solicitação **[INFERIDO]**.

### Campos de resposta da operadora dentro dos tipos de requisição
- `ctm_sp-sadtSolicitacaoGuia`: **nenhum** (não tem numeroGuiaOperadora, senha, dataAutorizacao, dataValidadeSenha).
- `ctm_internacaoSolicitacaoGuia`: **nenhum**.
- `ctm_anexoSolicitacaoOPME`: só em `cabecalhoAnexo`: `numeroGuiaOperadora?`, `senha?`, `dataAutorizacao?` (sem `dataValidadeSenha`).
- Esses dados chegam na resposta: `ct_autorizacaoDados` = numeroGuiaPrestador[1], numeroGuiaOperadora?, ausenciaCodValidacao?, codValidacao?, dataAutorizacao?, senha?, dataValidadeSenha?.
- Na guia de cobrança (já gerada hoje) eles voltam em `ct_autorizacaoSADT` (dataAutorizacao [1], senha?, numeroGuiaOperadora?, dataValidadeSenha?...).

---

## 4. Lado da resposta (informativo)

`operadoraParaPrestador` (`operadoraPrestador`, choice) tem, entre outros:
```xml
<!-- Estrutura para responder a solicitação de procedimento (ctm_solicitcaoLote) -->
<element name="autorizacaoServicos" type="ans:ct_situacaoAutorizacao" minOccurs="0"/>
<element name="situacaoAutorizacao" type="ans:ct_situacaoAutorizacao" minOccurs="0"/>
<element name="recebimentoAnexo" minOccurs="0"> choice: mensagemErro (ct_motivoGlosa) | protocoloRecebimentoAnexo (ct_anexoRecebimento)
```
- `ct_situacaoAutorizacao` = choice: `mensagemErro` (ct_motivoGlosa: codigoGlosa dm_tipoGlosa, descricaoGlosa?) | `autorizacaoInternacao` (ctm_autorizacaoInternacao) | `autorizacaoServico` (ctm_autorizacaoServico — resposta da SP/SADT) | `autorizacaoProrrogacao` | `autorizacaoServicoOdonto`.
- `ctm_autorizacaoServico`: dadosAutorizacao (ct_autorizacaoDados), tipoEtapaAutorizacao, dadosBeneficiario, nomeBeneficiario, nomeSocialBeneficiario?, coberturaEspecial?, prestadorAutorizado? (dadosContratado ct_contratadoDados, cnesContratado st_texto7), **statusSolicitacao** dm_statusSolicitacao, motivosNegativa? (codigoGlosa dm_tipoGlosa [1..n]), servicosAutorizados?/servicoAutorizado [1..n] (ct_procedimentoAutorizado: sequencialItem, procedimento, quantidadeSolicitada, quantidadeAutorizada, valorSolicitado?, valorAutorizado?, opcaoFabricante?, registroANVISA?, codigoRefFabricante?, autorizacaoFuncionamento?, motivosNegativa?), observacao? st_texto1000, autorizacaoQuimio?, autorizacaoRadio?. **Não contém autorizacaoOPME** — a resposta da OPME embutida não tem lugar próprio aqui **[AMBÍGUO]** (provavelmente via servicosAutorizados com opcaoFabricante/registroANVISA).
- `ctm_autorizacaoInternacao`: autorizacaoDosServicos (ctm_autorizacaoServico), dataProvavelAdmissao?, qtdDiariasAutorizadas? st_numerico3, tipoAcomodacaoAutorizada? dm_tipoAcomodacao.
- Anexo avulso: `ct_anexoRecebimento` (nrProtocoloRecebimento, dataEnvioAnexo, numeroLote, registroANS, dadosPrestador, qtAnexosClinicos, anexosClinicos choice anexoOPME = `ctm_autorizacaoOPME`, observacao?). `ctm_autorizacaoOPME`: dadosAutorizacao, dadosBeneficiario, `nomebeneficiario` (b minúsculo), nomeSocialBeneficiario?, statusSolicitacao, motivosNegativa? (ct_motivoGlosa [1..n]), prestadorAutorizado? (ct_contratadoDados), servicosAutorizadosOPME [0..n] (ct_procedimentoAutorizado). Consulta posterior: `ct_loteAnexoStatus` (statusProtocolo dm_statusProtocolo...).
- Consulta de status: envio `solicitaStatusAutorizacao` (ct_autorizacaoSolicitaStatus: identificacaoSolicitacao ct_guiaCabecalho, dadosBeneficiario, dadosContratado) → resposta `situacaoAutorizacao`.

**`dm_statusSolicitacao`** (string, length=1) — comentários do XSD:
| Valor | Significado |
|---|---|
| 1 | Autorizado |
| 2 | Em análise |
| 3 | Negado |
| 4 | Aguardando justificativa técnica do solicitante |
| 5 | Aguardando documentação do prestador |
| 6 | Solicitação cancelada |
| 7 | Autorizado parcialmente |

(Para referência: `dm_statusProtocolo` — 1 Recebido, 2 Em análise, 3 Liberado para pagamento, 4 Encerrado sem pagamento, 5 Analisado e aguardando liberação para pagamento, 6 Pagamento Efetuado, 7 Não Localizado, 8 Aguardando informação complementar, 9 Cancelado, 10 Bloqueio judicial - prestador. É status de protocolo/lote, não de autorização.)

---

## 5. Diferenças vs. guia de cobrança `ctm_sp-sadtGuia` e reaproveitamento

| Aspecto | Cobrança `guiaSP-SADT` | Solicitação `solicitacaoSP-SADT` |
|---|---|---|
| Cabeçalho | `cabecalhoGuia` (ct_guiaCabecalho + `guiaPrincipal?`) | `cabecalhoSolicitacao` (ct_guiaCabecalho puro) + `numeroGuiaPrincipal?` solto |
| Autorização | `dadosAutorizacao?` (ct_autorizacaoSADT) | não existe; em seu lugar `ausenciaCodValidacao?`, `codValidacao?`, `tipoEtapaAutorizacao` [1] |
| Solicitante | `dadosSolicitante` (contratadoSolicitante, nomeContratadoSolicitante, profissionalSolicitante) | **idêntico** |
| Caráter/data | dentro de `dadosSolicitacao` (dataSolicitacao **opcional**, caraterAtendimento, indicacaoClinica?, indCobEspecial?) | soltos no topo: caraterAtendimento, dataSolicitacao **[1]**, indicacaoClinica?, `coberturaEspecial?` (nome diferente de `indCobEspecial`) |
| Executante | `dadosExecutante` [1] (contratadoExecutante ct_contratadoDados + CNES) | `dadosExecutante` [0..1] (`codigonaOperadora` st_texto14 + CNES) — sem choice CPF/CNPJ |
| Atendimento | `dadosAtendimento` (tipoAtendimento, indicacaoAcidente, ...) [1] | não existe (sem tipoAtendimento, sem indicador de acidente, sem regimeAtendimento) |
| Procedimentos | `procedimentosExecutados?/procedimentoExecutado[1..n]` com sequencialItem, dataExecucao, valores, reducaoAcrescimo... | `procedimentosSolicitados[1..n]` (o próprio wrapper repete) só com procedimento + quantidadeSolicitada; **sem valores** |
| Totais | `valorTotal` [1], outrasDespesas?, assinaturaDigitalGuia? | não existe |
| Anexos | não existe | `anexoClinico?` |

**Reaproveitável de `lib/tiss/v4_03_00/common.ts`:**
- Constantes: `TABELA_TUSS_PROCEDIMENTOS='22'`, `CONSELHO_CRM='06'`, `INDICADOR_NAO_ACIDENTE='9'` (útil para internação `indicadorAcidente`), `CARATER_ELETIVO='1'`, `UF_IBGE` — tal como estão. `REGIME_AMBULATORIAL` e `TIPO_ATENDIMENTO_CONSULTA` não se aplicam (dm_regimeAtendimento/dm_tipoAtendimento não aparecem nas solicitações; internação usa `dm_regimeInternacao`, outro domínio).
- `crmNumber(crm)` — como está.
- `profissional(elementName, payload)` — a estrutura gerada (ct_contratadoProfissionalDados) é exatamente a necessária para `profissionalSolicitante` (SP/SADT) e `dadosProfissionalContratado` (internação). Porém recebe `GuidePayload` (tipo de cobrança); reutilizável as-is só se o payload de autorização tiver o mesmo shape `professional`; senão extrair uma versão que receba o profissional. **Não serve** para o OPME (`ctm_anexoSolicitante`: nome[1]+telefone[1]+email?).
- `beneficiario(payload)` — gera `dadosBeneficiario` com numeroCarteira + `atendimentoRN='N'`: estrutura certa para os três tipos (todos usam o nome `dadosBeneficiario` e ct_beneficiarioDados). Mesma ressalva de acoplamento a `GuidePayload`; e `atendimentoRN` fixo em 'N' pode não servir para internação obstétrica/pediátrica.
- `tipoConsulta` — não se aplica.

**Reaproveitável de `guide-sp-sadt.ts`:** só o trecho inline de `dadosSolicitante` (contratadoSolicitante/codigoPrestadorNaOperadora + nomeContratadoSolicitante + profissional) — idêntico; vale extrair para common. O resto não se aplica.

**Infra (tal como está):** `xml.ts` (`el`, `serialize`, `toLatin1Text`, `textValues`, `centsToDecimal` — este para `valorSolicitado` da OPME), `hash.ts` (`epilogueHash([cabecalho, body])`), `validate.ts` (`validateAgainstSchemas` com o mesmo `SCHEMAS` de `batch.ts`: o XSD raiz `tissV4_03_00.xsd` já cobre todos os ramos). O `cabecalho` está inline em `buildBatch` com `'ENVIO_LOTE_GUIAS'` fixo — extrair para uma função parametrizada por `tipoTransacao` e `sequencialTransacao`. Observação: `el()` descarta `''`/null; campos obrigatórios vazios (ex.: `UF_IBGE[...] ?? ''`) geram `<UF></UF>`, que falha em minLength — validação acusará, como hoje.

---

## 6. Gotchas

### Domínios (enumerações com significado do XSD)
- **dm_tabela** (codigoTabela, inclusive OPME): 18 TUSS Taxas hospitalares, diárias e gases medicinais; **19 TUSS Materiais**; 20 TUSS Medicamentos; 22 TUSS Procedimentos e eventos em saúde; 00 Tabela Própria das Operadoras; 90 e 98 aceitos, **sem comentário em dm_tabela** (em `dm_tabelaGeral` aparecem como "90 Tabela Própria Pacote Odontológico" e "98 Tabela Própria de Pacotes"). Não há código específico "OPME"; o XSD só indica 19 = Materiais (OPME normalmente cai em 19 ou 00) **[INFERIDO]**.
- **dm_caraterAtendimento**: 1 Eletiva; 2 Urgência/Emergência.
- **dm_tipoInternacao**: 1 Clínica; 2 Cirúrgica; 3 Obstétrica; 4 Pediátrica; 5 Psiquiátrica.
- **dm_regimeInternacao**: 1 Hospitalar; 2 Hospital-Dia; 3 Domiciliar.
- **dm_indicadorAcidente**: 0 Trabalho; 1 Trânsito; 2 Outros Acidentes; 9 Não Acidentes.
- **dm_etapasAutorizacao** (base st_texto1): 1 Solicitação de autorização prévia; 2 Solicitação de autorização pelo prestador executante.
- **dm_ausenciaCodValidacao**: 01 Beneficiário internado; 02 Urgência/emergência; 03 Intermitência/instabilidade de sistemas...; 04 Beneficiário se negou a transmitir o token; 05 Coleta domiciliar; 06 Material para exames enviado por terceiros; 07 Beneficiário não possui celular.
- **dm_opcaoFabricante**: 1 Primeira, 2 Segunda, 3 Terceira opção de fabricante.
- **dm_cobEsp** (maxLength 2): 01 Gestante; 02 Pré-operatório; 03 Pós-operatório.
- **dm_simNao**: S | N.
- **dm_tipoIdent** (base st_texto2): 01 Tarja magnética; 02 Código de barras; 03 Cartão físico; 04 QR code; 05 Impressão digital; 06 Leitura facial; 07 Íris; 08 Geometria da mão; 09 Cartão virtual.
- **dm_conselhoProfissional**: 01 CRESS, 02 COREN, 03 CRF, 04 CRFA, 05 CREFITO, 06 CRM, 07 CRN, 08 CRO, 09 CRP, 10 Outros, 11 CRBio, 12 CRBM, 13 CREF, 14 CRMV, 15 CRTR.
- **dm_UF**: código IBGE (11..53) + 98 Países Estrangeiros — nunca a sigla.
- **dm_tipoAcomodacao** (só resposta): 45 códigos (02 Quarto privativo... 12 Apartamento simples, 32 Enfermaria 4+ leitos, 51 UTI adulto geral, 53 UTI neonatal...).
- **dm_tipoGlosa** (motivos de negativa): 769 enumerações, incluindo um valor **vazio `""`** (linha 2979) — curiosidade do XSD.

### Formatos
- Datas `st_data` = xs:date → `AAAA-MM-DD` (xs:date aceitaria fuso, ex. `2026-10-05-03:00`; não usar). Hora `st_hora` = xs:time `hh:mm:ss`.
- Quantidades são inteiros: `quantidadeSolicitada` st_numerico3 (≤999), `qtDiariasSolicitadas` **st_numerico2 (≤99)**.
- Textos têm minLength=1: elemento opcional vazio deve ser omitido, nunca `<x></x>`.
- `diagnosticoCID` na internação é st_texto4 (≤4 chars, sem ponto: "K359"), não o dm_diagnosticoCID10 do oncológico.
- `telefoneProfissional` st_texto11 (só dígitos cabem: DDD + 9 dígitos).

### Nomes que diferem do coloquial / armadilhas de grafia
- `solicitacaoSP-SADT` (com hífen); tipo `ctm_sp-sadtSolicitacaoGuia` (não "ctm_spsadtSolicitacaoGuia").
- Anexo OPME: tipo `ctm_anexoSolicitacaoOPME`; elemento `solicitacaoOPME` (embutido) vs `anexoSolicitacaoOPME` (avulso); wrapper avulso `AnexosGuiasTISS` com A maiúsculo.
- `Observacao` maiúsculo no OPME; `observacao` minúsculo nos demais.
- `codigonaOperadora` (SP/SADT executante) e `codigoIndicadonaOperadora` (hospital da internação) — "na" minúsculo, e diferente de `codigoPrestadorNaOperadora`.
- `procedimentosSolicitados` (plural) é o elemento repetido — não há `procedimentoSolicitado` filho (existe um tipo `ct_procedimentoSolicitado`, com `unidadeMedida`, que **não** é usado nestas guias).
- `indicadorAcidente` (internação) vs `indicacaoAcidente` (SP/SADT de cobrança).
- `qtDiariasSolicitadas` (pedido) vs `qtdDiariasAutorizadas` (resposta).
- `coberturaEspecial` (solicitação) vs `indCobEspecial` (cobrança).
- Profissional: `profissionalSolicitante` (SP/SADT, ct_contratadoProfissionalDados) vs `dadosProfissionalContratado` (internação, mesmo tipo) vs `profissionalSolicitante` do OPME (ctm_anexoSolicitante — tipo diferente!).
- Resposta: `autorizacaoServicos` (plural, em operadoraPrestador) vs `autorizacaoServico` (singular, dentro de ct_situacaoAutorizacao); `nomebeneficiario` com b minúsculo em ctm_autorizacaoOPME.
- Nome do beneficiário, CNS e validade da carteira **não existem** em ct_beneficiarioDados desde a 4.00.00 (comentário no XSD).

---

## 7. Mapeamento formulário → XSD

Formulários lidos: `docs/GUIA OPME - LIMPO.pdf` (pág. 1 = Guia de Solicitação de Internação genérica ANS; pág. 2 = Anexo de Solicitação de OPME) e `docs/Guia_internacao (Unimed).pdf` (Guia de Solicitação de Internação, Unimed Conselheiro Lafaiete). Não foi fornecido formulário de Solicitação SP/SADT. Legenda: **REQ** = campo do pedido; **RESP** = preenchido pela operadora (vem na resposta); **—** = sem elemento XSD.

### 7.1 Guia de Solicitação de Internação (genérica e Unimed têm a mesma numeração)

| Nº | Rótulo no formulário | XSD (`solicitacaoInternacao/...`) | Obs. |
|---|---|---|---|
| 1 | Registro ANS | `registroANS` | REQ. Unimed: impresso "345709" |
| 2 | Nº Guia no Prestador | `numeroGuiaPrestador` | REQ |
| 3 | Número da Guia Atribuído pela Operadora | — (resposta: `autorizacaoInternacao/autorizacaoDosServicos/dadosAutorizacao/numeroGuiaOperadora`) | RESP |
| 4 | Data da Autorização | — (resp.: `dadosAutorizacao/dataAutorizacao`) | RESP |
| 5 | Senha | — (resp.: `dadosAutorizacao/senha`) | RESP |
| 6 | Data de Validade da Senha | — (resp.: `dadosAutorizacao/dataValidadeSenha`) | RESP |
| 7 | Número da Carteira | `dadosBeneficiario/numeroCarteira` | REQ |
| 8 | Validade da Carteira | — | sem elemento na 4.03.00 |
| 9 | Atendimento a RN | `dadosBeneficiario/atendimentoRN` (S/N) | REQ |
| 10 | Nome | — (removido na 4.00.00; resposta traz `nomeBeneficiario`) | só no papel |
| 11 | Cartão Nacional de Saúde | — (numeroCNS removido na 4.00.00) | só no papel |
| 12 | Código na Operadora | `identificacaoSolicitante/dadosDoContratado` (choice codigoPrestadorNaOperadora / cpfContratado / cnpjContratado) | REQ |
| 13 | Nome do Contratado | — (não há nome do contratado na solicitação de internação) | só no papel |
| 14 | Nome do Profissional Solicitante | `identificacaoSolicitante/dadosProfissionalContratado/nomeProfissional` | opcional no XSD |
| 15 | Conselho Profissional | `.../conselhoProfissional` | REQ (06 = CRM) |
| 16 | Número no Conselho | `.../numeroConselhoProfissional` | REQ |
| 17 | UF | `.../UF` | REQ — código IBGE (o PDF genérico mostra "BA" impresso; no XML seria "29") |
| 18 | Código CBO | `.../CBOS` | REQ |
| 19 | Código na Operadora / CNPJ | `dadosHospitalSolicitado/codigoIndicadonaOperadora` (st_texto14, sem choice) | REQ |
| 20 | Nome do Hospital/Local Solicitado | `dadosHospitalSolicitado/nomeContratadoIndicado` | REQ |
| 21 | Data sugerida para internação | `dadosHospitalSolicitado/dataSugeridaInternacao` | REQ |
| 22 | Caráter do Atendimento | `dadosInternacao/caraterAtendimento` | REQ |
| 23 | Tipo de Internação | `dadosInternacao/tipoInternacao` | REQ |
| 24 | Regime de Internação | `dadosInternacao/regimeInternacao` | REQ |
| 25 | Qtde. Diárias Solicitadas | `dadosInternacao/qtDiariasSolicitadas` | REQ, ≤99 (o papel tem 3 casas) |
| 26 | Previsão de uso de OPME | `dadosInternacao/indicadorOPME` | REQ S/N |
| 27 | Previsão de uso de quimioterápico | `dadosInternacao/indicadorQuimio` | REQ S/N |
| 28 | Indicação Clínica | `dadosInternacao/indicacaoClinica` | REQ, ≤500 |
| 29–32 | CID 10 Principal, (2), (3), (4) | `hipotesesDiagnosticas/diagnosticoCID` [0..4] | opcional; a Unimed imprime "(Opcional)" |
| 33 | Indicação de Acidente | `hipotesesDiagnosticas/indicadorAcidente` | REQ |
| 34 | Tabela | `procedimentosSolicitados/procedimento/codigoTabela` | REQ por item |
| 35 | Código do Procedimento ou Item Assistencial | `.../codigoProcedimento` | REQ |
| 36 | Descrição | `.../descricaoProcedimento` | REQ (≤150) |
| 37 | Qtde Solic | `procedimentosSolicitados/quantidadeSolicitada` | REQ |
| 38 | Qtde Aut | — (resp.: `servicoAutorizado/quantidadeAutorizada`) | RESP |
| (linhas 01–12) | 12 linhas | `procedimentosSolicitados` [1..n] | o XSD não limita a 12 |
| 39 | Data Provável da Admissão Hospitalar | — (resp.: `autorizacaoInternacao/dataProvavelAdmissao`) | RESP |
| 40 | Qtde. Diárias Autorizadas | — (resp.: `qtdDiariasAutorizadas`) | RESP |
| 41 | Tipo da Acomodação Autorizada | — (resp.: `tipoAcomodacaoAutorizada`, dm_tipoAcomodacao) | RESP |
| 42 | Código na Operadora / CNPJ autorizado | — (resp.: `autorizacaoDosServicos/prestadorAutorizado/dadosContratado`) | RESP |
| 43 | Nome do Hospital / Local Autorizado | — (nenhum elemento de nome em `prestadorAutorizado`) | RESP só no papel |
| 44 | Código CNES | — (resp.: `prestadorAutorizado/cnesContratado`) | RESP |
| 45 | Observação / Justificativa | `observacao` (≤1000) | opcional |
| 46 | Data da Solicitação | `dataSolicitacao` | REQ |
| 47 | Assinatura do Profissional Solicitante | — | papel |
| 48 | Assinatura do Beneficiário ou Responsável | — | papel |
| 49 | Assinatura do Responsável pela Autorização | — | papel |

Elementos XSD **sem campo** no formulário: `ausenciaCodValidacao`, `codValidacao`, **`tipoEtapaAutorizacao` (obrigatório!)**, `dadosBeneficiario/tipoIdent`, `identificadorBeneficiario`, `anexoClinico` (o anexo OPME é um formulário à parte).

Específico da Unimed: só o logotipo "Unimed Conselheiro Lafaiete", o `registroANS` pré-impresso **345709** e o sufixo "(Opcional)" nos CIDs 29–32. Numeração e campos idênticos ao modelo genérico; nenhum campo extra.

### 7.2 Anexo de Solicitação de OPME (pág. 2 de `GUIA OPME - LIMPO.pdf`)

| Nº | Rótulo no formulário | XSD (`ctm_anexoSolicitacaoOPME/...`) | Obs. |
|---|---|---|---|
| 1 | Registro ANS | `cabecalhoAnexo/registroANS` | REQ |
| 2 | Nº Guia no Prestador | `cabecalhoAnexo/numeroGuiaAnexo` | REQ (nº do próprio anexo) |
| 3 | Número da Guia Referenciada | `cabecalhoAnexo/numeroGuiaReferenciada` | REQ |
| 4 | Senha | `cabecalhoAnexo/senha` | opcional |
| 5 | Data da Autorização | `cabecalhoAnexo/dataAutorizacao` | opcional |
| 6 | Número da Guia Atribuído pela Operadora | `cabecalhoAnexo/numeroGuiaOperadora` | opcional |
| 7 | Número da Carteira | `dadosBeneficiario/numeroCarteira` | REQ |
| 8 | Nome | — (não existe em ct_beneficiarioDados; resposta traz `nomebeneficiario`) | só no papel |
| 9 | Nome do Profissional Solicitante | `profissionalSolicitante/nomeProfissional` | REQ |
| 10 | Telefone | `profissionalSolicitante/telefoneProfissional` | REQ (≤11) |
| 11 | E-mail | `profissionalSolicitante/emailProfissional` | opcional (≤60) |
| 12 | Justificativa Técnica | `justificativaTecnica` | REQ (≤1000) |
| 13 | Tabela | `opmeSolicitadas/opmeSolicitada/identificacaoOPME/codigoTabela` | REQ |
| 14 | Código do Material | `.../identificacaoOPME/codigoProcedimento` | REQ (≤10) |
| 15 | Descrição | `.../identificacaoOPME/descricaoProcedimento` | REQ (≤150) |
| 16 | Opção | `.../opcaoFabricante` | REQ (1/2/3) |
| 17 | Qtde. Solicitada | `.../quantidadeSolicitada` | REQ |
| 18 | Valor Unitário Solicitado | `.../valorSolicitado` | opcional — o XSD não diz se é unitário ou total **[AMBÍGUO]**; o papel diz unitário |
| 19 | Qtde. Autorizada | — (resp.: `servicosAutorizadosOPME/quantidadeAutorizada`) | RESP |
| 20 | Valor Unitário Autorizado | — (resp.: `servicosAutorizadosOPME/valorAutorizado`) | RESP |
| 21 | Registro ANVISA do Material | `.../registroANVISA` | opcional (≤15) |
| 22 | Referência do material no fabricante | `.../codigoRefFabricante` | opcional (≤60) |
| 23 | Nº Autorização de Funcionamento | `.../autorizacaoFuncionamento` | opcional (≤30) |
| (linhas 01–06) | 6 linhas | `opmeSolicitada` [1..n] | o XSD não limita a 6 |
| 24 | Especificação do Material | `especificacaoMaterial` | opcional (≤500) |
| 25 | Observação / Justificativa | `Observacao` | opcional (≤500) |
| 26 | Data da Solicitação | `cabecalhoAnexo/dataSolicitacao` | REQ — no XML fica no cabeçalho, entre numeroGuiaOperadora e senha |
| 27 | Assinatura do Profissional Solicitante | — | papel |
| 28 | Assinatura do Responsável pela Autorização | — | papel |

Elementos XSD **sem campo** no formulário OPME: **`dadosBeneficiario/atendimentoRN` (obrigatório!)**, `tipoIdent`, `identificadorBeneficiario`. A ordem do XML difere da do papel: senha (4) vem depois de dataSolicitacao (26) e numeroGuiaOperadora (6) antes de dataSolicitacao.

### 7.3 Solicitação SP/SADT
Sem formulário fornecido — usar §2.1.
