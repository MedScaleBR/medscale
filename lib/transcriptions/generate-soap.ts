import Anthropic from '@anthropic-ai/sdk'
import type { SOAPRecord } from './types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `Você é um assistente médico especializado em documentação clínica brasileira.
Receberá a transcrição de uma consulta médica e deve produzir um prontuário estruturado no formato SOAP.
Responda APENAS com um objeto JSON válido, sem texto adicional, sem markdown, sem backticks.

Estrutura obrigatória:
{
  "soap": {
    "S": {
      "queixa_principal": "string — motivo da consulta em até 2 linhas",
      "historia_atual": "string — HDA completa conforme relatada",
      "antecedentes": "string | null — pessoais, familiares, alergias se mencionados",
      "medicamentos_em_uso": ["string"]
    },
    "O": {
      "exame_fisico": "string | null — sinais vitais e achados relatados",
      "exames_solicitados": ["string"],
      "exames_resultados": "string | null — resultados discutidos se houver"
    },
    "A": {
      "hipotese_diagnostica": "string — diagnóstico principal",
      "diagnosticos_secundarios": ["string"],
      "cid10": "string | null — código CID-10 se mencionado"
    },
    "P": {
      "prescricao": ["string"],
      "orientacoes": ["string"],
      "retorno": "string | null — prazo ou condição de retorno",
      "encaminhamentos": ["string"]
    }
  },
  "resumo": "string — 2 a 3 frases resumindo a consulta para leitura rápida",
  "alertas": ["string"]
}

Regras absolutas:
- Nunca invente informação não dita na transcrição.
- Se um campo não foi mencionado, use null ou array vazio — nunca "não informado" como string.
- Não diagnostique além do que o médico explicitamente disse.
- Preserve terminologia médica exata usada pelo médico.
- Datas e dosagens: transcreva exatamente, sem arredondar.
- O campo "alertas" deve listar todo campo relevante que ficou vazio por ausência na fala.`

// Remove um possível fence de markdown (```json ... ```) em volta do JSON —
// o system prompt já instrui o Claude a nunca fazer isso, mas na prática o
// modelo ocasionalmente embrulha a resposta mesmo assim.
function stripMarkdownFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenced ? fenced[1] : trimmed
}

export async function generateSOAP(transcriptText: string): Promise<SOAPRecord> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Transcrição da consulta:\n\n${transcriptText}`,
      },
      // Prefill do turno do assistente com "{" — força o Claude a continuar
      // direto o JSON em vez de abrir com um fence de markdown antes dele.
      { role: 'assistant', content: '{' },
    ],
  })

  const completion = message.content[0].type === 'text' ? message.content[0].text : ''
  const raw = stripMarkdownFence(`{${completion}`)

  try {
    return JSON.parse(raw) as SOAPRecord
  } catch (err) {
    console.error('[generate-soap] Claude returned invalid JSON:', raw.slice(0, 500))
    throw new Error(`Claude returned invalid JSON: ${String(err)}`)
  }
}
