import { el, toLatin1Text, type XmlNode } from '../xml'
import { CONSELHO_CRM, UF_IBGE, crmNumber } from './common'
import type {
  AuthorizationItem, AuthorizationPayloadBase, AuthorizationProfessional, ValidationData,
} from '@/lib/billing/authorizations/types'

// Peças comuns às solicitações (SP/SADT, Internação) e ao anexo OPME.
// Texto livre: Latin-1 e corte no maxLength do XSD. Identificadores: nunca
// cortados — o XSD reprova o excesso e a rota devolve 422.

export function clip(value: string | null | undefined, max: number): string {
  return toLatin1Text(value ?? '').slice(0, max).trim()
}

// Elemento opcional de texto livre: omitido quando vazio (minLength=1).
export function optText(name: string, value: string | null | undefined, max: number): XmlNode | null {
  const text = clip(value, max)
  return text ? el(name, text) : null
}

// Elemento opcional de identificador: omitido quando vazio, nunca cortado.
export function optId(name: string, value: string | null | undefined): XmlNode | null {
  const text = toLatin1Text(value ?? '')
  return text ? el(name, text) : null
}

const present = (n: XmlNode | null): n is XmlNode => n !== null

// ct_beneficiarioDados — sem nome/CNS desde a 4.00.00.
export function beneficiarioSolicitacao(payload: AuthorizationPayloadBase): XmlNode {
  return el('dadosBeneficiario', [
    el('numeroCarteira', payload.beneficiary.card_number ?? ''),
    el('atendimentoRN', payload.beneficiary.newborn ? 'S' : 'N'),
  ])
}

// ct_contratadoProfissionalDados (profissionalSolicitante da SP/SADT e
// dadosProfissionalContratado da Internação). Não serve para o OPME.
export function profissionalContratado(
  elementName: 'profissionalSolicitante' | 'dadosProfissionalContratado',
  p: AuthorizationProfessional,
): XmlNode {
  return el(elementName, [
    optText('nomeProfissional', p.name, 70),
    el('conselhoProfissional', CONSELHO_CRM),
    el('numeroConselhoProfissional', crmNumber(p.crm ?? '')),
    el('UF', UF_IBGE[p.crm_uf ?? ''] ?? ''),
    el('CBOS', p.cbo_code ?? ''),
  ])
}

// ct_procedimentoDados (procedimento das solicitações e identificacaoOPME).
export function procedimentoDados(
  elementName: 'procedimento' | 'identificacaoOPME',
  item: Pick<AuthorizationItem, 'table_code' | 'code' | 'description'>,
): XmlNode {
  return el(elementName, [
    el('codigoTabela', item.table_code),
    el('codigoProcedimento', item.code),
    el('descricaoProcedimento', clip(item.description, 150)),
  ])
}

// ausenciaCodValidacao?, codValidacao?, tipoEtapaAutorizacao — nesta ordem.
export function etapaEValidacao(r: ValidationData): XmlNode[] {
  return [
    r.absence_code ? el('ausenciaCodValidacao', r.absence_code) : null,
    optId('codValidacao', r.code),
    el('tipoEtapaAutorizacao', r.stage),
  ].filter(present)
}

// procedimentosSolicitados [1..n]: o próprio wrapper repete (sem sequencialItem).
export function procedimentosSolicitados(items: AuthorizationItem[]): XmlNode[] {
  return items.map((item) =>
    el('procedimentosSolicitados', [
      procedimentoDados('procedimento', item),
      el('quantidadeSolicitada', String(item.quantity_requested)),
    ]),
  )
}
