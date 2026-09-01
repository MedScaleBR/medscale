import Anthropic from '@anthropic-ai/sdk'
import type { FinanceEntry, FinanceEntryType } from './types'
import type { RevenuePaymentMethod } from '@/types/database'
import { PAYMENT_METHOD_LABELS } from '@/lib/revenue/cycle'
import type { AppointmentPaymentMatch } from './appointment-payment'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM = `Você é um assistente financeiro pessoal para médicos, integrado via WhatsApp.
Tom: direto, amigável, profissional. Sem markdown. Máximo 1 emoji por mensagem.
Use "R$ X.XXX,XX" como formato de valor (padrão brasileiro).

Você separa todo gasto em dois tipos: PF (pessoal do médico) e PJ (da clínica).
Essa separação é o principal valor do produto — médicos costumam misturar as duas
coisas e perdem a noção de quanto de fato sobra para eles. Deixe esse papel claro
sempre que estiver se apresentando ou explicando o que você faz.`

// A instrução de confirmar valor + total só faz sentido ao registrar ou
// consultar; numa saudação ela faria o modelo inventar um "registro".
const SYSTEM_COM_TOTAL = `${SYSTEM}

Sempre confirme o que foi registrado e mostre o total do mês na mesma resposta.`

export async function buildConfirmationMessage(entry: FinanceEntry, monthTotal: number): Promise<string> {
  const typeLabel = entry.type === 'pf' ? 'Pessoal (PF)' : 'Clínica (PJ)'
  const desc = entry.description ?? 'Sem descrição'
  const cat = entry.category ?? 'Outros'
  const valor = formatBRL(entry.amount)
  const total = formatBRL(monthTotal)
  const mes = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  const prompt = `Confirme este registro de forma curta:
Tipo: ${typeLabel}
Descrição: ${desc}
Categoria: ${cat}
Valor: ${valor}
Total ${typeLabel} em ${mes}: ${total}`

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 120,
    system: SYSTEM_COM_TOTAL,
    messages: [{ role: 'user', content: prompt }],
  })

  return msg.content[0].type === 'text' ? toWhatsApp(msg.content[0].text) : `✅ ${desc} ${valor} registrado.`
}

export interface QueryFilters {
  type: FinanceEntryType | null
  // Nome da categoria resolvida, usado só no texto da resposta
  // (describeScope / groupByCategory).
  category: string | null
  // Filtro real contra finance_entries.category_id / subcategory_id.
  categoryId: string | null
  subcategoryId: string | null
  month: string | null
  // Unidade pela qual filtrar; null = consolidado (todas).
  workspaceId: string | null
  // Nome da unidade filtrada, para o texto da resposta.
  unitLabel: string | null
}

// Resposta de consulta. Cobre desde "/resumo pf" (sem filtros) até
// "me liste meus gastos em assinatura nesse mês" (categoria + período).
// `unitNames` mapeia workspace_id -> nome, para a quebra por unidade no
// modo consolidado.
export async function buildQueryMessage(
  entries: FinanceEntry[],
  filters: QueryFilters,
  unitNames: Record<string, string> = {}
): Promise<string> {
  const escopo = describeScope(filters)

  // Sem resultado não há nada para o modelo redigir — resposta determinística
  // economiza uma chamada e evita que ele invente números.
  if (entries.length === 0) {
    return `Não encontrei ${escopo}.`
  }

  const total = entries.reduce((s, e) => s + e.amount, 0)

  // Com filtro de categoria o médico quer ver os lançamentos em si
  // ("me liste"); sem filtro, o agrupamento por categoria é mais útil.
  const detalhe = filters.category ? listEntries(entries) : groupByCategory(entries)

  // Modo consolidado com lançamentos de mais de uma unidade: mostra a quebra.
  const distinctUnits = new Set(entries.map((e) => e.workspace_id ?? '__none__'))
  const porUnidade =
    !filters.workspaceId && distinctUnits.size > 1 ? `\n${groupByUnit(entries, unitNames)}` : ''

  const prompt = `Responda a uma consulta financeira de forma curta, para WhatsApp:
Consulta: ${escopo}
${detalhe}${porUnidade}
Total: ${formatBRL(total)}
Quantidade de lançamentos: ${entries.length}`

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 400,
    system: SYSTEM_COM_TOTAL,
    messages: [{ role: 'user', content: prompt }],
  })

  return msg.content[0].type === 'text' ? toWhatsApp(msg.content[0].text) : `${escopo}: ${formatBRL(total)}`
}

export function buildUndoMessage(entry: FinanceEntry): string {
  const desc = entry.description ?? 'lançamento sem descrição'
  return `Pronto, apaguei: ${desc} — ${formatBRL(entry.amount)} (${entry.type === 'pf' ? 'PF' : 'PJ'}).`
}

export function buildNothingToUndoMessage(): string {
  return `Não há nenhum lançamento recente para apagar.`
}

export async function buildSmalltalkMessage(raw: string): Promise<string> {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 220,
    system: `${SYSTEM}

Responda à saudação de forma breve e calorosa. A separação PF/PJ é o que o médico
mais precisa entender de cara, então deixe explícito que você registra os gastos
pessoais dele separados dos gastos da clínica, com um exemplo curto de cada um
(ex: "gastei 35 na Netflix" e "paguei 3500 de aluguel do consultório").
Feche mencionando que ele também pode perguntar quanto gastou.
No máximo 5 linhas curtas.`,
    messages: [{ role: 'user', content: raw }],
  })

  return msg.content[0].type === 'text'
    ? toWhatsApp(msg.content[0].text)
    : `Olá! Eu registro seus gastos separando o que é pessoal (PF) do que é da clínica (PJ). É só me dizer, por exemplo, "gastei 35 na Netflix" ou "paguei 3500 de aluguel do consultório". 😊`
}

export function buildHelpMessage(): string {
  return `Olá! Sou seu assistente financeiro. Pode falar comigo normalmente, do seu jeito:

➕ Registrar um gasto:
"gastei 35 na Netflix"
"paguei 3500 de aluguel do consultório"

📊 Consultar:
"quanto gastei esse mês?"
"me liste meus gastos em assinaturas"
"quanto a clínica gastou em março?"
"quanto a unidade Moema gastou esse mês?"

↩️ Errei um lançamento:
"apaga o último"

Se preferir atalhos, também funcionam:
/pf Netflix 35
/pj Aluguel 3500
/resumo pf
/desfazer

Os gastos são registrados na data de hoje. Dúvidas? Fale com o suporte MedScale.`
}

export function buildUnknownMessage(): string {
  return `Não consegui entender. Você pode me dizer algo como "gastei 50 no almoço" ou "quanto gastei esse mês?". Digite /ajuda para ver mais exemplos.`
}

export function buildUnregisteredMessage(): string {
  return `Número não encontrado na MedScale. Certifique-se de que sua conta está ativa e tente novamente.`
}

// ── Ciclo de receita: confirmação de pagamento de consulta ─────────────────

export function buildRevenueCycleInactiveMessage(): string {
  return `O ciclo de receita não está ativo na sua conta. Entre em contato com o suporte MedScale.`
}

// ── Lançamento PJ: qual unidade? ──────────────────────────────────────────

export function buildChooseWorkspaceMessage(
  units: { name: string }[],
  entryDescription: string | null,
  amount: number
): string {
  const desc = entryDescription ?? 'lançamento'
  const list = units.map((u, i) => `${i + 1}. ${u.name}`).join('\n')
  return (
    `Esse gasto da clínica (${desc} — ${formatBRL(amount)}) é de qual unidade?\n${list}\n\n` +
    `Responda com o nome ou o número da unidade.`
  )
}

export function buildWorkspaceNotMatchedMessage(units: { name: string }[]): string {
  const list = units.map((u, i) => `${i + 1}. ${u.name}`).join('\n')
  return `Não reconheci essa unidade. Escolha uma:\n${list}`
}

function describeMatch(m: AppointmentPaymentMatch): string {
  const parts = [m.patientName]
  if (m.time) parts.push(`às ${m.time}`)
  if (m.procedureName) parts.push(m.procedureName)
  parts.push(formatBRL(m.amount))
  return parts.join(' · ')
}

export function buildPaymentMatchNotFoundMessage(patient: string | null): string {
  const who = patient ? ` de ${patient}` : ''
  return `Não encontrei nenhuma consulta de hoje${who} aguardando pagamento. Confere o nome com a agenda e me chama de novo?`
}

export function buildPaymentMatchAmbiguousMessage(matches: AppointmentPaymentMatch[]): string {
  const list = matches.map((m, i) => `${i + 1}. ${describeMatch(m)}`).join('\n')
  return `Achei mais de uma consulta que pode ser:\n${list}\n\nMe diz o horário ou o nome completo pra eu confirmar a certa.`
}

export function buildPaymentConfirmPromptMessage(
  match: AppointmentPaymentMatch,
  method: RevenuePaymentMethod | null
): string {
  const via = method ? ` (${PAYMENT_METHOD_LABELS[method]})` : ''
  const ask = method
    ? `Confirmo o recebimento${via}?`
    : `Confirmo o recebimento? Se puder, me diz também a forma de pagamento.`
  return `Encontrei: ${describeMatch(match)}.\n${ask} Responda "sim" pra confirmar.`
}

export function buildPaymentConfirmedMessage(
  match: AppointmentPaymentMatch,
  method: RevenuePaymentMethod,
  today: { received: number; realized: number }
): string {
  return (
    `✅ Confirmado. ${match.patientName} · ${match.procedureName ?? 'Consulta'} · ${formatBRL(match.amount)} · ${PAYMENT_METHOD_LABELS[method]}\n` +
    `Receita de hoje: ${formatBRL(today.received)} recebidos de ${formatBRL(today.realized)} realizados.`
  )
}

export function buildPaymentConfirmCancelledMessage(): string {
  return `Ok, não confirmei nada. Se precisar, é só me chamar de novo.`
}

export function buildPaymentMethodNeededMessage(): string {
  return `Qual foi a forma de pagamento? (Pix, cartão de crédito, cartão de débito, dinheiro, transferência ou outro)`
}

export function buildUnsupportedTypeMessage(): string {
  return `Por favor, envie apenas mensagens de texto. Digite /ajuda para ver os comandos.`
}

// "gastos pessoais (PF) em Assinaturas em agosto de 2026" — usado tanto no
// prompt do modelo quanto na resposta de "nenhum resultado".
function describeScope(filters: QueryFilters): string {
  const tipo =
    filters.type === 'pf' ? 'gastos pessoais (PF)' : filters.type === 'pj' ? 'gastos da clínica (PJ)' : 'gastos'
  const categoria = filters.category ? ` em ${filters.category}` : ''
  const unidade = filters.unitLabel ? ` da ${filters.unitLabel}` : ''
  return `${tipo}${categoria}${unidade} em ${monthLabel(filters.month)}`
}

function monthLabel(month: string | null): string {
  const date = month ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1) : new Date()
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function groupByUnit(entries: FinanceEntry[], unitNames: Record<string, string>): string {
  const byUnit: Record<string, number> = {}
  for (const e of entries) {
    const key = e.workspace_id ? (unitNames[e.workspace_id] ?? 'Unidade') : 'Consolidado (sem unidade)'
    byUnit[key] = (byUnit[key] ?? 0) + e.amount
  }
  const lines = Object.entries(byUnit)
    .sort((a, b) => b[1] - a[1])
    .map(([name, val]) => `${name}: ${formatBRL(val)}`)
    .join('\n')
  return `Por unidade:\n${lines}`
}

function groupByCategory(entries: FinanceEntry[]): string {
  const byCategory: Record<string, number> = {}
  for (const e of entries) {
    const cat = e.category ?? 'Outros'
    byCategory[cat] = (byCategory[cat] ?? 0) + e.amount
  }

  const lines = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, val]) => `${cat}: ${formatBRL(val)}`)
    .join('\n')

  return `Por categoria:\n${lines}`
}

function listEntries(entries: FinanceEntry[]): string {
  const lines = entries
    .map((e) => {
      const dia = new Date(e.entry_date + 'T00:00:00').toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
      })
      return `${dia} ${e.description ?? 'sem descrição'}: ${formatBRL(e.amount)}`
    })
    .join('\n')

  return `Lançamentos:\n${lines}`
}

// O system prompt pede "sem markdown", mas o modelo às vezes devolve
// **negrito** assim mesmo. O WhatsApp usa *asterisco simples* — o formato do
// markdown não é renderizado e o médico veria os asteriscos crus no meio da
// frase. Converte em vez de remover, preservando a ênfase pretendida.
function toWhatsApp(text: string): string {
  // [\s\S] em vez da flag /s: o target do tsconfig é anterior a es2018,
  // onde dotAll não existe (TS1501).
  return text
    .replace(/\*\*\*([\s\S]+?)\*\*\*/g, '*_$1_*')
    .replace(/\*\*([\s\S]+?)\*\*/g, '*$1*')
    .replace(/__([\s\S]+?)__/g, '_$1_')
    .trim()
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
