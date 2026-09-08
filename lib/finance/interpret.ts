import Anthropic from '@anthropic-ai/sdk'
import type { FinanceIntent, FinanceEntryType, EntryDraft } from './types'
import type { FinanceCategoryTree } from './categories'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Interpretação usa Opus porque é o único ponto do fluxo onde um erro do
// modelo vira dado errado no banco (ler "3.500" como 350). O resto do
// módulo continua no claude-sonnet-4-5 do restante do projeto, onde o
// modelo só redige texto e um erro é cosmético.
const MODEL = 'claude-opus-5'

const TOOL_NAME = 'registrar_intencao'

// Um item de `lancamentos[]`: um gasto ou receita citado na mensagem. Os
// campos de tipo/categoria/unidade/direção que antes ficavam no topo da
// ferramenta vivem aqui agora — um conjunto por lançamento.
const LANCAMENTO_ITEM = {
  type: 'object' as const,
  properties: {
    tipo: {
      anyOf: [{ type: 'string', enum: ['pf', 'pj'] }, { type: 'null' }],
      description: 'pf = gasto/receita pessoal do médico. pj = da clínica. null quando a mensagem não deixa claro.',
    },
    descricao: { type: ['string', 'null'], description: 'O que foi comprado/recebido, curto (ex: "Netflix", "Aluguel"). null se não der.' },
    valor: { type: ['number', 'null'], description: 'Valor em reais, positivo. null quando a mensagem não traz um número claro.' },
    categoria: { type: ['string', 'null'], description: 'A categoria EXATA da lista fornecida para o tipo/direção do item. null se não der.' },
    subcategoria: { type: ['string', 'null'], description: 'A subcategoria EXATA da árvore, quando fizer sentido. null se não houver.' },
    unidade: { type: ['string', 'null'], description: 'Nome (ou trecho) da unidade/clínica, se o médico citar. null se não citar.' },
    direcao: {
      anyOf: [{ type: 'string', enum: ['entrada', 'saida'] }, { type: 'null' }],
      description: 'entrada = o médico RECEBEU dinheiro. saida = o médico GASTOU. null é tratado como saida.',
    },
  },
  required: ['tipo', 'descricao', 'valor', 'categoria', 'subcategoria', 'unidade', 'direcao'],
  additionalProperties: false,
}

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
      lancamentos: {
        type: 'array',
        items: LANCAMENTO_ITEM,
        description:
          'Em intencao "lancamento": um item para cada gasto ou receita citado na ' +
          'mensagem (pode ser mais de um). Vazio ([]) em qualquer outra intenção.',
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
          'Em consulta: pf, pj, ou null quando a consulta é sobre os dois juntos. ' +
          'Em lancamento o tipo vai em cada item de lancamentos, não aqui.',
      },
      categoria: {
        type: ['string', 'null'],
        description:
          'Em consulta: a categoria EXATA da lista fornecida pela qual filtrar, ou null quando a consulta é sobre tudo.',
      },
      subcategoria: {
        type: ['string', 'null'],
        description:
          'Em consulta: a subcategoria EXATA da árvore, quando fizer sentido (ex: "Escola" dentro de "Filhos"). null se não houver.',
      },
      mes: {
        type: ['string', 'null'],
        description: 'Em consulta: o mês no formato YYYY-MM. null quando é o mês atual.',
      },
      unidade: {
        type: ['string', 'null'],
        description:
          'Em consulta: nome (ou trecho do nome) da unidade/clínica pela qual filtrar. null quando a mensagem não cita nenhuma unidade.',
      },
      // anyOf pelo mesmo motivo de `tipo` (API rejeita enum + null direto).
      direcao: {
        anyOf: [{ type: 'string', enum: ['entrada', 'saida'] }, { type: 'null' }],
        description:
          'Em consulta: entrada = o médico RECEBEU dinheiro (ex: "quanto recebi esse mês"); ' +
          'saida = o médico GASTOU (ex: "quanto gastei"). null quando a mensagem não deixa ' +
          'claro (interpretado como saida). Em lancamento a direção vai em cada item de lancamentos.',
      },
    },
    required: [
      'intencao', 'lancamentos',
      'tipo', 'categoria', 'subcategoria', 'unidade', 'direcao',
      'mes', 'paciente', 'horario', 'forma_pagamento',
    ],
    additionalProperties: false,
  },
}

type PaymentMethodValue = 'pix' | 'cartao_credito' | 'cartao_debito' | 'dinheiro' | 'transferencia' | 'outro'

type LancamentoItem = {
  tipo: FinanceEntryType | null
  descricao: string | null
  valor: number | null
  categoria: string | null
  subcategoria: string | null
  unidade: string | null
  direcao: 'entrada' | 'saida' | null
}

type IntentToolInput = {
  intencao: 'lancamento' | 'consulta' | 'confirmar_pagamento' | 'desfazer' | 'ajuda' | 'conversa' | 'desconhecido'
  lancamentos: LancamentoItem[]
  tipo: FinanceEntryType | null
  categoria: string | null
  subcategoria: string | null
  unidade: string | null
  direcao: 'entrada' | 'saida' | null
  mes: string | null
  paciente: string | null
  horario: string | null
  forma_pagamento: PaymentMethodValue | null
}

function buildSystem(today: string, tree: FinanceCategoryTree): string {
  const fmt = (nodes: FinanceCategoryTree['pf']) =>
    nodes
      .filter((c) => !c.isArchived)
      .map((c) => {
        const subs = c.children.filter((s) => !s.isArchived).map((s) => s.name)
        return subs.length ? `${c.name} (${subs.join(', ')})` : c.name
      })
      .join('; ')
  const byDirection = (nodes: FinanceCategoryTree['pf'], direction: 'in' | 'out') =>
    fmt(nodes.filter((c) => c.direction === direction))

  return `Você interpreta mensagens que um médico manda para o assistente financeiro dele no WhatsApp.
Sua única função é classificar a mensagem chamando a ferramenta ${TOOL_NAME}. Nunca responda em texto.

Hoje é ${today}. Use essa data para resolver referências como "esse mês", "mês passado", "em março".

O médico separa as finanças em dois tipos:
- pf (pessoa física): pessoal dele — mercado, streaming, escola dos filhos, viagem, mas também salário/pró-labore, aluguel recebido, investimentos.
- pj (pessoa jurídica): da clínica — aluguel da sala, equipamento, salário de secretária, imposto, mas também receita de consultas e procedimentos.

Categorias de despesa em pf: ${byDirection(tree.pf, 'out')}
Categorias de receita em pf: ${byDirection(tree.pf, 'in')}
Categorias de despesa em pj: ${byDirection(tree.pj, 'out')}
Categorias de receita em pj: ${byDirection(tree.pj, 'in')}

Regras:
- "confirmar_pagamento" é sobre um PACIENTE que pagou uma consulta ("o João pagou", "recebi da Ana"), não sobre um gasto ou receita do médico. Extraia o nome do paciente em "paciente"; o horário em "horario" se ele disser; a forma de pagamento em "forma_pagamento" se ele disser.
- "direcao" = entrada quando o médico RECEBEU dinheiro (ex: "recebi 500 de aluguel", "entrou um pix de 200", "quanto recebi esse mês"); saida quando ele GASTOU (ex: "gastei 50", "paguei 3500", "quanto gastei"). Se não estiver claro, use saida.
- Em "lancamento" ou "consulta" com direcao entrada, use as listas de RECEITA acima para "categoria"; com direcao saida, use as listas de DESPESA. Nunca misture as duas.
- Em "consulta", se o médico citar um assunto (ex: "assinaturas", "aluguel"), mapeie para a categoria EXATA da lista certa (despesa ou receita, conforme a direcao). Se não citar, categoria = null.
- Em "lancamento", nunca invente valor: se a mensagem não tiver um número claro, use intencao "desconhecido".
- Se a mensagem misturar vários gastos/receitas de uma vez, use "desconhecido" — o registro é de um por vez.
- Na dúvida entre pf e pj num lançamento, escolha pelo contexto clínico: sala, equipamento, funcionário, imposto e receita de consulta são pj; o resto é pf.`
}

// Interpreta linguagem natural. Só é chamada quando parseCommand não
// reconheceu um atalho com barra, então o custo de LLM não incide sobre
// quem usa os comandos.
export async function interpretMessage(
  messageText: string,
  today: string,
  tree: FinanceCategoryTree
): Promise<FinanceIntent> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: buildSystem(today, tree),
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
      const drafts: EntryDraft[] = []
      for (const item of input.lancamentos) {
        // Task 1: comportamento de hoje — sem número claro, a mensagem inteira é unknown.
        if (typeof item.valor !== 'number' || !isFinite(item.valor) || item.valor <= 0) {
          return { kind: 'unknown', raw }
        }
        drafts.push({
          // Sem tipo explícito, PF é o padrão menos danoso (gasto pessoal é o caso comum).
          type: item.tipo ?? 'pf',
          direction: item.direcao === 'entrada' ? 'in' : 'out',
          description: item.descricao?.trim() || null,
          amount: item.valor,
          // Aproveita a categoria/subcategoria que este mesmo passo já deduziu,
          // evitando uma segunda chamada ao modelo (categorizeEntry). Passa os
          // NOMES adiante — o agente resolve nome->id contra a árvore e valida.
          category: item.categoria?.trim() || null,
          subcategory: item.subcategoria?.trim() || null,
          // Só PJ pertence a uma unidade; PF ignora esse campo mais adiante.
          workspaceHint: item.unidade?.trim() || null,
        })
      }
      if (drafts.length === 0) return { kind: 'unknown', raw }
      return { kind: 'entry', entries: drafts }
    }

    case 'consulta':
      return {
        kind: 'query',
        type: input.tipo,
        direction: input.direcao === 'entrada' ? 'in' : 'out',
        // Nomes passam adiante; o agente resolve nome->id e valida.
        category: input.categoria?.trim() || null,
        subcategory: input.subcategoria?.trim() || null,
        month: /^\d{4}-\d{2}$/.test(input.mes ?? '') ? input.mes : null,
        workspace: input.unidade?.trim() || null,
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
