// Operadora pronta para TISS: tem registro ANS e código do prestador. Sem o
// módulo billing a conta cadastra só o nome do convênio (para a Clara), e
// essas operadoras nunca podem chegar a uma guia ou lote.
export type TissIdentity = { ans_registry: string; provider_code: string }

export function hasTissIdentity<T extends { ans_registry: string | null; provider_code: string | null }>(
  insurer: T,
): insurer is T & TissIdentity {
  return Boolean(insurer.ans_registry && insurer.provider_code)
}

export const INCOMPLETE_INSURER_ERROR =
  'Complete o registro ANS e o código do prestador desta operadora em Convênios.'
