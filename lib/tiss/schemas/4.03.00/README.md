# XSDs oficiais TISS 4.03.00

Os sete arquivos foram comparados byte a byte com o pacote oficial de Comunicação disponibilizado na [versão de setembro/2026 da ANS](https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/padrao-tiss-setembro-2026), em 01/10/2026. Todos conferiram; nenhum XSD foi modificado.

Pacote: [PadroTISSComunicao_202511.zip](https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/PadroTISSComunicao_202511.zip), diretório `040300`.

| Arquivo | SHA-256 |
| --- | --- |
| tissAssinaturaDigital_v1.01.xsd | `8567690a0eb05b9681fdc575ca7c867f75bf5cb33573175b8d333617ef035221` |
| tissComplexTypesV4_03_00.xsd | `83a24d606620cd3907c5cd574a71bf9c4411a2ec9e0510979f44293fe7c5956a` |
| tissGuiasV4_03_00.xsd | `587f0b6bac24175c50635ede52356cab00ff1ae28b550adc42e3a7f03cf605c7` |
| tissSimpleTypesV4_03_00.xsd | `d854debf58ac2d96194f72db95315ef2d102de57aeaf0388512f242824fdc794` |
| tissV4_03_00.xsd | `d4c421c7e3cf936551b70d6bd794a419867b6daea554d557b4d928363c54044c` |
| tissWebServicesV4_03_00.xsd | `3044f18d2e984910c7670e3357724c2f5798d64cc4ab5919094389a3f01bce02` |
| xmldsig-core-schema.xsd | `b6388292d746c6cc8f932ce3b6bf7c7fc0bf6cba58ec385b38988887bcf5fdbb` |

A regra do epílogo está no item 148, página 49, do [Componente Organizacional de setembro/2026](https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/PadroTISS_ComponenteOrganizacional_202609.pdf): MD5 dos valores dos elementos, em ordem, codificados em ISO-8859-1; tags e epílogo ficam fora do cálculo. `tests/tiss/batch.test.ts` recalcula o hash diretamente do XML e valida fixtures fictícias contra estes XSDs.
