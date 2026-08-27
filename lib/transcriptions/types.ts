import type { Database } from '@/types/database'

export type SOAPRecord = {
  soap: {
    S: {
      queixa_principal: string
      historia_atual: string
      antecedentes: string | null
      medicamentos_em_uso: string[]
    }
    O: {
      exame_fisico: string | null
      exames_solicitados: string[]
      exames_resultados: string | null
    }
    A: {
      hipotese_diagnostica: string
      diagnosticos_secundarios: string[]
      cid10: string | null
    }
    P: {
      prescricao: string[]
      orientacoes: string[]
      retorno: string | null
      encaminhamentos: string[]
    }
  }
  resumo: string
  alertas: string[]
}

export type Transcription = Omit<
  Database['public']['Tables']['transcriptions']['Row'],
  'medical_record_draft' | 'medical_record_final'
> & {
  medical_record_draft: SOAPRecord | null
  medical_record_final: SOAPRecord | null
}

// ── Validação do contrato do SOAPRecord ──────────────────────────────────────
// O Claude devolve texto livre: `JSON.parse(raw) as SOAPRecord` só faz o cast
// e mente pro TypeScript — um prontuário sem queixa principal ou sem hipótese
// diagnóstica chegava a `draft_ready` e ia parar na tela do médico como se
// estivesse completo. Aqui a falha vira erro explícito, que o retry das rotas
// já sabe tratar.

export class SOAPValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SOAPValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Campo obrigatório: precisa ser string não vazia. Nunca "conserta" com ''
// silenciosamente — um campo clínico vazio tem que falhar alto.
function requiredString(source: Record<string, unknown>, path: string, key: string): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SOAPValidationError(`${path}.${key} é obrigatório e deve ser uma string não vazia`)
  }
  return value
}

// Campo opcional: aceita string, null ou ausente. Qualquer outro tipo é erro
// (número/objeto ali significa que o modelo inventou outra estrutura).
function nullableString(source: Record<string, unknown>, path: string, key: string): string | null {
  const value = source[key]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new SOAPValidationError(`${path}.${key} deve ser string ou null`)
  }
  return value.trim() === '' ? null : value
}

// Listas ausentes ou null viram [] — é o mesmo significado clínico ("nada
// registrado") e o prompt já instrui o modelo a usar array vazio.
function stringArray(source: Record<string, unknown>, path: string, key: string): string[] {
  const value = source[key]
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) {
    throw new SOAPValidationError(`${path}.${key} deve ser um array de strings`)
  }
  if (!value.every((item) => typeof item === 'string')) {
    throw new SOAPValidationError(`${path}.${key} contém item que não é string`)
  }
  return value as string[]
}

function section(soap: Record<string, unknown>, key: 'S' | 'O' | 'A' | 'P'): Record<string, unknown> {
  const value = soap[key]
  if (!isRecord(value)) {
    throw new SOAPValidationError(`soap.${key} ausente ou não é um objeto`)
  }
  return value
}

// Valida e normaliza a resposta do modelo. Campos extras são descartados
// (o retorno é sempre montado campo a campo), campos obrigatórios ausentes
// lançam SOAPValidationError.
export function validateSOAPRecord(data: unknown): SOAPRecord {
  if (!isRecord(data)) throw new SOAPValidationError('resposta não é um objeto JSON')
  if (!isRecord(data.soap)) throw new SOAPValidationError('campo "soap" ausente ou não é um objeto')

  const soap = data.soap
  const S = section(soap, 'S')
  const O = section(soap, 'O')
  const A = section(soap, 'A')
  const P = section(soap, 'P')

  return {
    soap: {
      S: {
        queixa_principal: requiredString(S, 'soap.S', 'queixa_principal'),
        historia_atual: requiredString(S, 'soap.S', 'historia_atual'),
        antecedentes: nullableString(S, 'soap.S', 'antecedentes'),
        medicamentos_em_uso: stringArray(S, 'soap.S', 'medicamentos_em_uso'),
      },
      O: {
        exame_fisico: nullableString(O, 'soap.O', 'exame_fisico'),
        exames_solicitados: stringArray(O, 'soap.O', 'exames_solicitados'),
        exames_resultados: nullableString(O, 'soap.O', 'exames_resultados'),
      },
      A: {
        hipotese_diagnostica: requiredString(A, 'soap.A', 'hipotese_diagnostica'),
        diagnosticos_secundarios: stringArray(A, 'soap.A', 'diagnosticos_secundarios'),
        cid10: nullableString(A, 'soap.A', 'cid10'),
      },
      P: {
        prescricao: stringArray(P, 'soap.P', 'prescricao'),
        orientacoes: stringArray(P, 'soap.P', 'orientacoes'),
        retorno: nullableString(P, 'soap.P', 'retorno'),
        encaminhamentos: stringArray(P, 'soap.P', 'encaminhamentos'),
      },
    },
    resumo: requiredString(data, '', 'resumo'),
    alertas: stringArray(data, '', 'alertas'),
  }
}
