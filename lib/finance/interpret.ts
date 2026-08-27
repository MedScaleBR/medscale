import Anthropic from '@anthropic-ai/sdk'
import { PF_CATEGORIES, PJ_CATEGORIES } from './categorize'
import type { FinanceIntent, FinanceEntryType } from './types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Interpretação usa Opus porque é o único ponto do fluxo onde um erro do
// modelo vira dado errado no banco (ler "3.500" como 350). O resto do
// módulo continua no claude-sonnet-4-5 do restante do projeto, onde o
// modelo só redige texto e um erro é cosmético.
const MODEL = 'claude-opus-5'

const TOOL_NAME = 'registrar_intencao'

// strict: true garante que o input bate exatamente com o schema — sem isso
// um campo faltando ou um enum inventado só apareceria em runtime.
const INTENT_TOOL = {
  name: TOOL_NAME,
  description: 'Classifica a mensagem do médico sobre as finanças dele.',
  strict: true,
  input_schema: {
    type: 'object' as const,
    properties: {
      intencao: {
        type: 'string',
        enum: [
          'lancamento',
          'consulta',
          'confirmar_pagamento',
          'desfazer',
          'ajuda',
          'conversa',
          'desconhecido',
        ],
        description:
          'lancamento = registrar um gasto. consulta = perguntar quanto gastou. ' +
          'confirmar_pagamento = o médico avisa que um paciente pagou uma consulta ' +
          '(ex: "João pagou a consulta das 14h", "recebi da Ana, foi no pix"). ' +
          'desfazer = apagar o último lançamento. ajuda = quer saber como usar. ' +
          'conversa = saudação/agradecimento sem pedido. desconhecido = não dá para saber.',
      },
      paciente: {
        type: ['string', 'null'],
        description: 'Em confirmar_pagamento: o nome do paciente que pagou, como o médico escreveu. Senão null.',
      },
      horario: {
        type: ['string', 'null'],
        description:
          'Em confirmar_pagamento: o horário da consulta mencionado, em HH:mm (ex: "14:00"). null se não mencionado.',
      },
      forma_pagamento: {
        anyOf: [
          {
            type: 'string',
            enum: ['pix', 'cartao_credito', 'cartao_debito', 'dinheiro', 'transferencia', 'outro'],
          },
          { type: 'null' },
        ],
        description:
          'Em confirmar_pagamento: a forma de pagamento, se o médico disser. "cartão" sem especificar → cartao_credito. null se não disser.',
      },
      // anyOf, e não `type: ['string','null'] + enum`: a API rejeita um enum
      // que mistura null com o tipo declarado ("Enum value 'pf' does not
      // match declared type '['string', 'null']'", HTTP 400).
      tipo: {
        anyOf: [{ type: 'string', enum: ['pf', 'pj'] }, { type: 'null' }],
        description:
          'pf = gasto pessoal do médico. pj = gasto da clínica. null quando a mensagem ' +
          'não deixa claro, ou quando a consulta é sobre os dois juntos.',
      },
      descricao: {
        type: ['string', 'null'],
        description: 'Em lancamento: o que foi comprado, curto (ex: "Netflix", "Aluguel"). Senão null.',
      },
      valor: {
        type: ['number', 'null'],
        description: 'Em lancamento: o valor em reais, positivo. Senão null.',
      },
      categoria: {
        type: ['string', 'null'],
        description:
          'A categoria EXATA da lista fornecida. Em lancamento: a categoria do gasto. ' +
          'Em consulta: a categoria pela qual filtrar, ou null quando a consulta é sobre tudo.',
      },
      mes: {
        type: ['string', 'null'],
        description: 'Mês da consulta no formato YYYY-MM. null quando é o mês atual.',
      },
    },
    required: [
      'intencao',
      'tipo',
      'descricao',
      'valor',
      'categoria',
      'mes',
      'paciente',
      'horario',
      'forma_pagamento',
    ],
    additionalProperties: false,
  },
}

type PaymentMethodValue = 'pix' | 'cartao_credito' | 'cartao_debito' | 'dinheiro' | 'transferencia' | 'outro'

type IntentToolInput = {
  intencao: 'lancamento' | 'consulta' | 'confirmar_pagamento' | 'desfazer' | 'ajuda' | 'conversa' | 'desconhecido'
  tipo: FinanceEntryType | null
  descricao: string | null
  valor: number | null
  categoria: string | null
  mes: string | null
  paciente: string | null
  horario: string | null
  forma_pagamento: PaymentMethodValue | null
}

function buildSystem(today: string): string {
  return `Você interpreta mensagens que um médico manda para o assistente financeiro dele no WhatsApp.
Sua única função é classificar a mensagem chamando a ferramenta ${TOOL_NAME}. Nunca responda em texto.

Hoje é ${today}. Use essa data para resolver referências como "esse mês", "mês passado", "em março".

O médico separa as finanças em dois tipos:
- pf (pessoa física): gastos pessoais dele — mercado, streaming, escola dos filhos, viagem.
- pj (pessoa jurídica): gastos da clínica — aluguel da sala, equipamento, salário de secretária, imposto.

Categorias válidas em pf: ${PF_CATEGORIES.join(', ')}
Categorias válidas em pj: ${PJ_CATEGORIES.join(', ')}

Regras:
- "confirmar_pagamento" é sobre um PACIENTE que pagou uma consulta ("o João pagou", "recebi da Ana"), não sobre um gasto do médico. Extraia o nome do paciente em "paciente"; o horário em "horario" se ele disser; a forma de pagamento em "forma_pagamento" se ele disser.
- Em "consulta", se o médico citar um assunto (ex: "assinaturas", "aluguel"), mapeie para a categoria EXATA das listas acima. Se não citar, categoria = null.
- Em "lancamento", nunca invente valor: se a mensagem não tiver um número claro, use intencao "desconhecido".
- Se a mensagem misturar vários gastos de uma vez, use "desconhecido" — o registro é de um gasto por vez.
- Na dúvida entre pf e pj num lançamento, escolha pelo contexto clínico: sala, equipamento, funcionário e imposto são pj; o resto é pf.`
}

// Interpreta linguagem natural. Só é chamada quando parseCommand não
// reconheceu um atalho com barra, então o custo de LLM não incide sobre
// quem usa os comandos.
export async function interpretMessage(messageText: string, today: string): Promise<FinanceIntent> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: buildSystem(today),
    tools: [INTENT_TOOL],
    // Força a chamada da ferramenta — sem isso o modelo às vezes responde
    // em texto e não sobra nada estruturado para executar.
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: messageText }],
  })

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    return { kind: 'unknown', raw: messageText }
  }

  return toIntent(toolUse.input as IntentToolInput, messageText)
}

function toIntent(input: IntentToolInput, raw: string): FinanceIntent {
  switch (input.intencao) {
    case 'lancamento': {
      // O schema permite valor null; um lançamento sem valor (ou com valor
      // inválido) não pode virar linha no banco.
      if (typeof input.valor !== 'number' || !isFinite(input.valor) || input.valor <= 0) {
        return { kind: 'unknown', raw }
      }
      // Sem tipo explícito, PF é o padrão menos danoso: gasto pessoal é o
      // caso mais comum e não polui o fechamento da clínica.
      const type = input.tipo ?? 'pf'
      return {
        kind: 'entry',
        type,
        description: input.descricao,
        amount: input.valor,
        // Aproveita a categoria que este mesmo passo já deduziu, evitando
        // uma segunda chamada ao modelo (categorizeEntry) no caminho de
        // linguagem natural. Só vale se for uma categoria real do tipo —
        // senão volta null e o agente categoriza da forma antiga.
        category: validCategory(input.categoria, type),
      }
    }

    case 'consulta':
      return {
        kind: 'query',
        type: input.tipo,
        category: input.categoria,
        month: /^\d{4}-\d{2}$/.test(input.mes ?? '') ? input.mes : null,
      }

    case 'confirmar_pagamento':
      return {
        kind: 'confirm_payment',
        patient: input.paciente?.trim() || null,
        time: /^\d{1,2}:\d{2}$/.test(input.horario ?? '') ? input.horario : null,
        method: input.forma_pagamento ?? null,
      }

    case 'desfazer':
      return { kind: 'undo' }

    case 'ajuda':
      return { kind: 'help' }

    case 'conversa':
      return { kind: 'smalltalk', raw }

    default:
      return { kind: 'unknown', raw }
  }
}

// Só aceita categoria que exista de fato na lista do tipo — o modelo pode
// devolver uma variação ("Assinatura") que não casaria com o que está
// gravado em finance_entries.category.
function validCategory(category: string | null, type: FinanceEntryType): string | null {
  if (!category) return null
  const valid = type === 'pf' ? PF_CATEGORIES : PJ_CATEGORIES
  return valid.includes(category) ? category : null
}
