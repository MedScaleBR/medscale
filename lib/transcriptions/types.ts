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
