// Convênios e atendimento particular por unidade. Arquivo puro — usado pelo
// contexto do agente, pelo prompt, pelo plano e pela Agenda.

export interface InsurerRef {
  id: string
  name: string
}

/** O que uma unidade aceita: particular e os convênios ligados a ela. */
export interface UnitCoverage {
  acceptsPrivate: boolean
  insurers: InsurerRef[]
}

/**
 * Cobertura de cada unidade.
 * - `unit.acceptsPrivate` null/ausente (coluna ainda não migrada) → vale o da account.
 * - `insurer.workspaceIds` null/ausente (vínculo ainda não migrado) → o convênio vale em todas.
 */
export function buildCoverageByUnit(
  units: readonly { id: string; acceptsPrivate?: boolean | null }[],
  insurers: readonly (InsurerRef & { workspaceIds?: readonly string[] | null })[],
  accountAcceptsPrivate: boolean
): Record<string, UnitCoverage> {
  const out: Record<string, UnitCoverage> = {}
  for (const u of units) {
    out[u.id] = {
      acceptsPrivate: u.acceptsPrivate ?? accountAcceptsPrivate,
      insurers: insurers
        .filter((i) => !i.workspaceIds || i.workspaceIds.includes(u.id))
        .map((i) => ({ id: i.id, name: i.name })),
    }
  }
  return out
}

/** Junção das coberturas: o que vale em pelo menos uma unidade. */
export function mergeCoverages(coverages: readonly UnitCoverage[]): UnitCoverage {
  const byId = new Map<string, InsurerRef>()
  for (const c of coverages) for (const i of c.insurers) byId.set(i.id, i)
  return {
    acceptsPrivate: coverages.some((c) => c.acceptsPrivate),
    insurers: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  }
}

function coverageKey(c: UnitCoverage): string {
  return `${c.acceptsPrivate}|${c.insurers.map((i) => i.id).sort().join(',')}`
}

/** Todas as unidades aceitam exatamente a mesma coisa? */
export function isUniformCoverage(coverages: readonly UnitCoverage[]): boolean {
  return new Set(coverages.map(coverageKey)).size <= 1
}

/** Frase do que a unidade aceita — a mesma que a Clara usava para a account. */
export function coverageSummary(c: UnitCoverage): string {
  const names = c.insurers.map((i) => i.name)
  if (names.length === 0 && c.acceptsPrivate) return 'Atendimento apenas particular (sem convênios).'
  if (names.length > 0 && c.acceptsPrivate) return `Convênios aceitos: ${names.join(', ')}. Também atende particular.`
  if (names.length > 0) return `Convênios aceitos: ${names.join(', ')}. Não atende particular.`
  return 'Consulte a equipe para informações sobre convênios.'
}

/**
 * A escolha de pagamento cabe na unidade? `insurerId` null = particular.
 * Devolve a mensagem de erro, ou null se está ok.
 */
export function coverageProblem(
  c: UnitCoverage,
  unitName: string,
  insurerId: string | null
): string | null {
  if (insurerId === null) {
    return c.acceptsPrivate ? null : `A unidade ${unitName} não atende particular.`
  }
  return c.insurers.some((i) => i.id === insurerId) ? null : `A unidade ${unitName} não aceita este convênio.`
}
