// Domínios do tissSimpleTypesV4_03_00.xsd usados nas solicitações de
// autorização: código exatamente como no XSD → rótulo (dos comentários do
// próprio XSD). Ver docs/superpowers/specs/2026-10-05-tiss-autorizacoes-xsd.md §6.

export const CARATER_ATENDIMENTO = { '1': 'Eletiva', '2': 'Urgência/Emergência' } as const // dm_caraterAtendimento
export const TIPO_INTERNACAO = {
  '1': 'Clínica', '2': 'Cirúrgica', '3': 'Obstétrica', '4': 'Pediátrica', '5': 'Psiquiátrica',
} as const // dm_tipoInternacao
export const REGIME_INTERNACAO = { '1': 'Hospitalar', '2': 'Hospital-dia', '3': 'Domiciliar' } as const // dm_regimeInternacao
export const INDICADOR_ACIDENTE = {
  '0': 'Trabalho', '1': 'Trânsito', '2': 'Outros acidentes', '9': 'Não acidente',
} as const // dm_indicadorAcidente
export const ETAPA_AUTORIZACAO = {
  '1': 'Autorização prévia', '2': 'Autorização pelo prestador executante',
} as const // dm_etapasAutorizacao
export const AUSENCIA_COD_VALIDACAO = {
  '01': 'Beneficiário internado',
  '02': 'Urgência/emergência',
  '03': 'Intermitência/instabilidade de sistemas',
  '04': 'Beneficiário se negou a transmitir o token',
  '05': 'Coleta domiciliar',
  '06': 'Material para exames enviado por terceiros',
  '07': 'Beneficiário não possui celular',
} as const // dm_ausenciaCodValidacao
export const COBERTURA_ESPECIAL = { '01': 'Gestante', '02': 'Pré-operatório', '03': 'Pós-operatório' } as const // dm_cobEsp
export const OPCAO_FABRICANTE = { '1': '1ª opção', '2': '2ª opção', '3': '3ª opção' } as const // dm_opcaoFabricante
// dm_tabela. 19 = Materiais é o usual para OPME [INFERIDO]: o XSD não tem
// código específico de OPME.
export const TABELA = {
  '22': 'TUSS — Procedimentos e eventos em saúde',
  '19': 'TUSS — Materiais',
  '20': 'TUSS — Medicamentos',
  '18': 'TUSS — Taxas, diárias e gases medicinais',
  '00': 'Tabela própria da operadora',
  '90': 'Tabela própria — pacote odontológico',
  '98': 'Tabela própria de pacotes',
} as const
export const STATUS_SOLICITACAO = {
  '1': 'Autorizado',
  '2': 'Em análise',
  '3': 'Negado',
  '4': 'Aguardando justificativa técnica do solicitante',
  '5': 'Aguardando documentação do prestador',
  '6': 'Solicitação cancelada',
  '7': 'Autorizado parcialmente',
} as const // dm_statusSolicitacao

export type CaraterAtendimento = keyof typeof CARATER_ATENDIMENTO
export type TipoInternacao = keyof typeof TIPO_INTERNACAO
export type RegimeInternacao = keyof typeof REGIME_INTERNACAO
export type IndicadorAcidente = keyof typeof INDICADOR_ACIDENTE
export type EtapaAutorizacao = keyof typeof ETAPA_AUTORIZACAO
export type AusenciaCodValidacao = keyof typeof AUSENCIA_COD_VALIDACAO
export type CoberturaEspecial = keyof typeof COBERTURA_ESPECIAL
export type OpcaoFabricante = keyof typeof OPCAO_FABRICANTE
export type Tabela = keyof typeof TABELA
export type StatusSolicitacao = keyof typeof STATUS_SOLICITACAO

export function isCode<D extends Readonly<Record<string, string>>>(domain: D, value: unknown): value is keyof D & string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(domain, value)
}
