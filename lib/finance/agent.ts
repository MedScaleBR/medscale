import { createAdminClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage } from '@/lib/whatsapp/send'
import { trackFinanceEntryCreatedViaWhatsApp } from '@/lib/analytics/posthog-server'
import { parseCommand } from './parser'
import { interpretMessage } from './interpret'
import { categorizeEntry } from './categorize'
import { ensureFinanceCategories } from './provision'
import { getFinanceCategoryTree, resolveCategoryPair } from './categories'
import {
  buildConfirmationMessage,
  buildQueryMessage,
  buildSmalltalkMessage,
  buildUndoMessage,
  buildNothingToUndoMessage,
  buildCategoryNotFoundMessage,
  buildHelpMessage,
  buildUnknownMessage,
  buildUnregisteredMessage,
  buildRevenueCycleInactiveMessage,
  buildPaymentMatchNotFoundMessage,
  buildPaymentMatchAmbiguousMessage,
  buildPaymentConfirmPromptMessage,
  buildPaymentConfirmedMessage,
  buildPaymentConfirmCancelledMessage,
  buildPaymentMethodNeededMessage,
  buildChooseWorkspaceMessage,
  buildWorkspaceNotMatchedMessage,
  type QueryFilters,
} from './respond'
import { normalizeName } from './appointment-payment'
import {
  findTodayUnpaidByPatient,
  confirmAppointmentPayment,
  summarizeAccountToday,
  type AppointmentPaymentMatch,
} from './appointment-payment'
import type { FinanceEntry } from './types'
import type { RevenuePaymentMethod } from '@/types/database'

// Confirmação de pagamento de consulta pendente de "sim" do owner, guardada
// em finance_sessions.pending_entry entre as duas mensagens.
interface PendingPaymentConfirm {
  kind: 'confirm_payment'
  revenue_entry_id: string
  method: RevenuePaymentMethod | null
  match: AppointmentPaymentMatch
}
// Lançamento PJ aguardando o owner dizer a unidade, guardado em
// finance_sessions.pending_entry entre as duas mensagens.
interface PendingChooseWorkspace {
  kind: 'choose_workspace'
  entry: {
    type: 'pj'
    direction: 'in' | 'out'
    description: string | null
    amount: number
    // `category` (texto) é o snapshot do nome; os ids resolvem a árvore.
    category: string | null
    category_id: string | null
    subcategory_id: string | null
    raw_message: string
  }
}

const PENDING_TTL_MS = 30 * 60 * 1000

interface AccountUnit {
  id: string
  name: string
}

async function listAccountUnits(
  supabase: ReturnType<typeof createAdminClient>,
  accountId: string
): Promise<AccountUnit[]> {
  const { data } = await supabase
    .from('workspaces')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('display_order')
  return data ?? []
}

// Casa o que o owner digitou (nome parcial ou número da lista) com uma unidade.
// Com uma única unidade, sempre resolve para ela.
export function resolveUnit(
  units: AccountUnit[],
  hint: string | null
): { status: 'one'; unit: AccountUnit } | { status: 'none' } | { status: 'ambiguous' } {
  if (units.length === 1) return { status: 'one', unit: units[0] }
  if (!hint) return { status: 'none' }

  const trimmed = hint.trim()
  const asNumber = Number(trimmed)
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= units.length) {
    return { status: 'one', unit: units[asNumber - 1] }
  }

  const q = normalizeName(trimmed)
  const hits = units.filter((u) => {
    const n = normalizeName(u.name)
    return n.includes(q) || q.includes(n)
  })
  if (hits.length === 1) return { status: 'one', unit: hits[0] }
  if (hits.length > 1) return { status: 'ambiguous' }
  return { status: 'none' }
}

const AFFIRMATIVE = /^(s|sim|isso|isso mesmo|exato|é isso|e isso|confirmo|confirma|confirmar|pode confirmar|ok|ta|tá|👍|isso ai|isso aí)\b/i
const NEGATIVE = /^(n|nao|não|cancela|cancelar|deixa|esquece|errado|não era|nao era|para|pare)\b/i

function parsePaymentMethod(text: string): RevenuePaymentMethod | null {
  const t = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
  if (/\bpix\b/.test(t)) return 'pix'
  if (/(cartao|cartão).*(cred|credito)/.test(t) || /\bcredito\b/.test(t)) return 'cartao_credito'
  if (/(cartao|cartão).*(deb|debito)/.test(t) || /\bdebito\b/.test(t)) return 'cartao_debito'
  if (/\bcartao\b|\bcartão\b/.test(t)) return 'cartao_credito'
  if (/\bdinheiro\b|especie|espécie/.test(t)) return 'dinheiro'
  if (/transfer|\bted\b|\bdoc\b/.test(t)) return 'transferencia'
  return null
}

export async function processFinancialMessage(senderPhone: string, messageText: string): Promise<void> {
  const supabase = createAdminClient()

  // 1. Identificar o owner pelo número de telefone. memberships e profiles
  // não têm FK direta entre si (ambas referenciam auth.users separadamente),
  // então o match é feito em duas etapas — primeiro os owners ativos, depois
  // seus perfis — comparando pela chave canônica de telefone (ver phoneKey).
  const senderKey = phoneKey(senderPhone)

  const { data: ownerMemberships } = await supabase
    .from('memberships')
    .select('account_id, user_id')
    .eq('role', 'owner')
    .eq('status', 'active')

  const ownerUserIds = (ownerMemberships ?? []).map((m) => m.user_id)

  const { data: profiles } = ownerUserIds.length
    ? await supabase.from('profiles').select('id, phone').in('id', ownerUserIds).not('phone', 'is', null)
    : { data: [] }

  const matches = (profiles ?? []).filter((p) => p.phone && phoneKey(p.phone) === senderKey)

  // Como a chave canônica descarta o nono dígito, dois owners com o mesmo
  // DDD e os mesmos 8 dígitos finais colidiriam. É raro, mas gravar
  // lançamento financeiro na account errada é grave demais para se arriscar
  // um palpite — nesse caso não escolhe nenhum.
  if (matches.length > 1) {
    console.error('[finance-agent] telefone ambíguo: mais de um owner corresponde', {
      senderKeyTail: senderKey.slice(-4),
      matches: matches.length,
    })
    await sendFinanceReply(senderPhone, buildUnregisteredMessage())
    return
  }

  const matchedProfile = matches[0]
  const membership = matchedProfile
    ? ownerMemberships?.find((m) => m.user_id === matchedProfile.id)
    : undefined

  if (!membership) {
    // Sem isso, "não encontrado" é indistinguível de telefone não cadastrado,
    // profile sem phone, ou membership que não é owner/ativo. Só os 4 últimos
    // dígitos — o número inteiro é dado pessoal e não deve ir para o log.
    console.warn('[finance-agent] nenhum owner ativo corresponde ao telefone', {
      senderKeyTail: senderKey.slice(-4),
      ownersAtivos: ownerUserIds.length,
      ownersComTelefone: profiles?.length ?? 0,
    })
    await sendFinanceReply(senderPhone, buildUnregisteredMessage())
    return
  }

  const accountId = membership.account_id

  // 2. Verificar feature flag
  const { data: account } = await supabase.from('accounts').select('modules').eq('id', accountId).single()

  if (!account?.modules?.includes('finance')) {
    await sendFinanceReply(
      senderPhone,
      `O módulo financeiro ainda não está ativo na sua conta. Entre em contato com o suporte MedScale.`
    )
    return
  }

  const revenueCycleActive = account?.modules?.includes('revenue_cycle') ?? false

  // 2.4 Garante a árvore de categorias provisionada e a carrega uma vez —
  // interpretação, consulta e categorização usam a mesma árvore.
  await ensureFinanceCategories(supabase, accountId)
  const categoryTree = await getFinanceCategoryTree(supabase, accountId)

  // 2.5 Há um lançamento PJ esperando o owner dizer a unidade?
  if (await handlePendingChooseWorkspace(supabase, accountId, senderPhone, messageText, membership.user_id)) return

  // 2.6 Há uma confirmação de pagamento de consulta esperando o "sim" do owner?
  // (ciclo de receita — fluxo de duas mensagens, ver PendingPaymentConfirm)
  if (await handlePendingPaymentConfirm(supabase, accountId, senderPhone, messageText)) return

  // 3. Entender a mensagem. Atalho com barra primeiro (instantâneo e sem
  // custo); só o que não for comando vai para o Claude interpretar.
  const today = new Date().toISOString().split('T')[0]
  const shortcut = parseCommand(messageText)
  const intent = shortcut.kind === 'unknown' ? await interpretMessage(messageText, today, categoryTree) : shortcut

  if (intent.kind === 'confirm_payment') {
    if (!revenueCycleActive) {
      await sendFinanceReply(senderPhone, buildRevenueCycleInactiveMessage())
      return
    }
    const matches = await findTodayUnpaidByPatient(supabase, accountId, {
      patient: intent.patient,
      time: intent.time,
    })
    if (matches.length === 0) {
      await sendFinanceReply(senderPhone, buildPaymentMatchNotFoundMessage(intent.patient))
      return
    }
    if (matches.length > 1) {
      await sendFinanceReply(senderPhone, buildPaymentMatchAmbiguousMessage(matches))
      return
    }
    const match = matches[0]
    await setPendingPaymentConfirm(supabase, accountId, senderPhone, {
      kind: 'confirm_payment',
      revenue_entry_id: match.revenueEntryId,
      method: intent.method,
      match,
    })
    await sendFinanceReply(senderPhone, buildPaymentConfirmPromptMessage(match, intent.method))
    return
  }

  if (intent.kind === 'help') {
    await sendFinanceReply(senderPhone, buildHelpMessage())
    return
  }

  if (intent.kind === 'unknown') {
    await sendFinanceReply(senderPhone, buildUnknownMessage())
    return
  }

  if (intent.kind === 'smalltalk') {
    await sendFinanceReply(senderPhone, await buildSmalltalkMessage(intent.raw))
    return
  }

  if (intent.kind === 'undo') {
    await handleUndo(supabase, accountId, senderPhone)
    return
  }

  if (intent.kind === 'query') {
    // Recorte por unidade: "quanto a Moema gastou" filtra; sem menção = consolidado.
    const units = await listAccountUnits(supabase, accountId)
    const resolved = intent.workspace ? resolveUnit(units, intent.workspace) : { status: 'none' as const }
    const unit = resolved.status === 'one' ? resolved.unit : null

    // Nome -> id contra a árvore da conta. O nome resolvido (pair.categoryName)
    // fica no filtro para o texto da resposta; os ids fazem o filtro real.
    const pair = resolveCategoryPair(categoryTree, intent.type, intent.category, intent.subcategory, intent.direction)

    // O modelo extraiu um nome de categoria que não casa com a árvore da conta.
    // Rodar a consulta sem esse filtro devolveria o total do mês inteiro como
    // se fosse a resposta — melhor dizer que não achou. Subcategoria ausente
    // (com a categoria resolvida) não é problema: consulta só pela categoria.
    if (intent.category && intent.category.trim() !== '' && !pair.categoryId) {
      await sendFinanceReply(senderPhone, buildCategoryNotFoundMessage(intent.category))
      return
    }

    const filters: QueryFilters = {
      type: intent.type,
      direction: intent.direction,
      category: pair.categoryName,
      categoryId: pair.categoryId,
      subcategoryId: pair.subcategoryId,
      month: intent.month,
      workspaceId: unit?.id ?? null,
      unitLabel: unit?.name ?? null,
    }
    const entries = await getEntries(accountId, filters)
    const unitNames = Object.fromEntries(units.map((u) => [u.id, u.name]))
    const response = await buildQueryMessage(entries, filters, unitNames)
    await sendFinanceReply(senderPhone, response)
    return
  }

  // 4. Categorizar. A interpretação por linguagem natural já traz a
  // categoria; só o caminho dos atalhos precisa desta chamada extra.
  // Sempre resolvemos nome -> id contra a árvore da conta.
  let pair = resolveCategoryPair(categoryTree, intent.type, intent.category, intent.subcategory, intent.direction)
  if (!pair.categoryId && intent.description) {
    const guess = await categorizeEntry(intent.description, intent.type, intent.direction, categoryTree)
    pair = resolveCategoryPair(categoryTree, intent.type, guess.categoryName, guess.subcategoryName, intent.direction)
  }

  // 4.5 Lançamento PJ pertence a uma unidade. Se a account tem mais de uma e a
  // mensagem não deixou claro qual, pergunta antes de gravar. PF é sempre
  // consolidado (workspace_id null).
  let workspaceId: string | null = null
  if (intent.type === 'pj') {
    const units = await listAccountUnits(supabase, accountId)
    const resolved = resolveUnit(units, intent.workspaceHint)
    if (resolved.status === 'one') {
      workspaceId = resolved.unit.id
    } else {
      await setPendingFinanceSession(supabase, accountId, senderPhone, {
        kind: 'choose_workspace',
        entry: {
          type: 'pj',
          direction: intent.direction,
          description: intent.description,
          amount: intent.amount,
          category: pair.categoryName,
          category_id: pair.categoryId,
          subcategory_id: pair.subcategoryId,
          raw_message: messageText,
        },
      })
      await sendFinanceReply(
        senderPhone,
        buildChooseWorkspaceMessage(units, intent.direction, intent.description, intent.amount)
      )
      return
    }
  }

  // 5. Salvar no banco + confirmar
  await persistEntryAndConfirm(supabase, {
    accountId,
    senderPhone,
    userId: membership.user_id,
    type: intent.type,
    direction: intent.direction,
    description: intent.description,
    amount: intent.amount,
    categoryName: pair.categoryName,
    categoryId: pair.categoryId,
    subcategoryId: pair.subcategoryId,
    workspaceId,
    rawMessage: messageText,
    today,
  })
}

// Insere o lançamento e responde com a confirmação + total do mês. Usado tanto
// no fluxo direto quanto depois de o owner escolher a unidade (PJ).
async function persistEntryAndConfirm(
  supabase: ReturnType<typeof createAdminClient>,
  args: {
    accountId: string
    senderPhone: string
    userId: string
    type: FinanceEntry['type']
    direction: 'in' | 'out'
    description: string | null
    amount: number
    // Nome renomeado para não colidir com a coluna `category` do insert.
    categoryName: string | null
    categoryId: string | null
    subcategoryId: string | null
    workspaceId: string | null
    rawMessage: string
    today: string
  }
): Promise<void> {
  const { data: entry, error } = await supabase
    .from('finance_entries')
    .insert({
      account_id: args.accountId,
      workspace_id: args.workspaceId,
      recorded_by_phone: args.senderPhone,
      type: args.type,
      direction: args.direction,
      description: args.description,
      amount: args.amount,
      category: args.categoryName,
      category_id: args.categoryId,
      subcategory_id: args.subcategoryId,
      raw_message: args.rawMessage,
      entry_date: args.today,
    })
    .select('*')
    .single()

  if (error || !entry) {
    await sendFinanceReply(args.senderPhone, `Erro ao registrar o lançamento. Tente novamente.`)
    return
  }

  await trackFinanceEntryCreatedViaWhatsApp(args.userId, {
    account_id: args.accountId,
    category: args.categoryName ?? null,
    amount: entry.amount,
  })

  const monthEntries = await getEntries(args.accountId, {
    type: args.type,
    direction: args.direction,
    category: null,
    categoryId: null,
    subcategoryId: null,
    month: null,
    workspaceId: null,
    unitLabel: null,
  })
  const monthTotal = monthEntries.reduce((s, e) => s + e.amount, 0)

  const response = await buildConfirmationMessage(entry, monthTotal)
  await sendFinanceReply(args.senderPhone, response)
}

// Apaga o lançamento mais recente da account. Existe porque o registro por
// linguagem natural grava direto, sem etapa de confirmação — sem um jeito de
// desfazer pelo WhatsApp, um valor lido errado só sairia via SQL.
async function handleUndo(
  supabase: ReturnType<typeof createAdminClient>,
  accountId: string,
  senderPhone: string
): Promise<void> {
  // .is('revenue_entry_id', null): nunca apaga o espelho de um pagamento do
  // ciclo de receita — essa linha só a API web trava (409 revenue_mirror_locked)
  // e este caminho grava direto via admin client, sem passar por ela.
  const { data: last } = await supabase
    .from('finance_entries')
    .select('*')
    .eq('account_id', accountId)
    .is('revenue_entry_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!last) {
    await sendFinanceReply(senderPhone, buildNothingToUndoMessage())
    return
  }

  const { error } = await supabase.from('finance_entries').delete().eq('id', last.id)

  if (error) {
    await sendFinanceReply(senderPhone, `Não consegui apagar o lançamento agora. Tente novamente.`)
    return
  }

  await sendFinanceReply(senderPhone, buildUndoMessage(last))
}

// Trata a mensagem quando há uma confirmação de pagamento de consulta
// aguardando resposta. Retorna true se a mensagem foi consumida aqui.
async function handlePendingPaymentConfirm(
  supabase: ReturnType<typeof createAdminClient>,
  accountId: string,
  senderPhone: string,
  messageText: string
): Promise<boolean> {
  const { data: fsession } = await supabase
    .from('finance_sessions')
    .select('pending_entry, last_message_at')
    .eq('phone', senderPhone)
    .maybeSingle()

  const pending = fsession?.pending_entry as PendingPaymentConfirm | null | undefined
  if (!pending || pending.kind !== 'confirm_payment') return false

  // Expirou — limpa e deixa a mensagem seguir o fluxo normal.
  if (
    fsession?.last_message_at &&
    Date.now() - new Date(fsession.last_message_at).getTime() > PENDING_TTL_MS
  ) {
    await clearPendingFinanceSession(supabase, senderPhone)
    return false
  }

  const text = messageText.trim()

  if (NEGATIVE.test(text)) {
    await clearPendingFinanceSession(supabase, senderPhone)
    await sendFinanceReply(senderPhone, buildPaymentConfirmCancelledMessage())
    return true
  }

  const methodFromText = parsePaymentMethod(text)
  const affirm = AFFIRMATIVE.test(text)
  if (!affirm && !methodFromText) {
    // Nem sim/não nem forma de pagamento — abandona a confirmação e deixa o
    // fluxo normal tratar (provavelmente é outro assunto).
    await clearPendingFinanceSession(supabase, senderPhone)
    return false
  }

  const method = methodFromText ?? pending.method
  if (!method) {
    await sendFinanceReply(senderPhone, buildPaymentMethodNeededMessage())
    return true
  }

  const ok = await confirmAppointmentPayment(supabase, pending.revenue_entry_id, method)
  await clearPendingFinanceSession(supabase, senderPhone)
  if (!ok) {
    await sendFinanceReply(
      senderPhone,
      'Não consegui confirmar — essa consulta pode já ter sido paga ou cancelada. Dá uma olhada no painel.'
    )
    return true
  }
  const today = await summarizeAccountToday(supabase, accountId)
  await sendFinanceReply(senderPhone, buildPaymentConfirmedMessage(pending.match, method, today))
  return true
}

async function setPendingPaymentConfirm(
  supabase: ReturnType<typeof createAdminClient>,
  accountId: string,
  senderPhone: string,
  pending: PendingPaymentConfirm
): Promise<void> {
  await setPendingFinanceSession(supabase, accountId, senderPhone, pending)
}

async function setPendingFinanceSession(
  supabase: ReturnType<typeof createAdminClient>,
  accountId: string,
  senderPhone: string,
  pending: PendingPaymentConfirm | PendingChooseWorkspace
): Promise<void> {
  await supabase.from('finance_sessions').upsert(
    {
      phone: senderPhone,
      account_id: accountId,
      pending_entry: pending as unknown as Record<string, unknown>,
      last_message_at: new Date().toISOString(),
    },
    { onConflict: 'phone' }
  )
}

// Trata a mensagem quando há um lançamento PJ aguardando a escolha da unidade.
// Retorna true se a mensagem foi consumida aqui.
async function handlePendingChooseWorkspace(
  supabase: ReturnType<typeof createAdminClient>,
  accountId: string,
  senderPhone: string,
  messageText: string,
  userId: string
): Promise<boolean> {
  const { data: fsession } = await supabase
    .from('finance_sessions')
    .select('pending_entry, last_message_at')
    .eq('phone', senderPhone)
    .maybeSingle()

  const pending = fsession?.pending_entry as PendingChooseWorkspace | null | undefined
  if (!pending || pending.kind !== 'choose_workspace') return false

  // Expirou — limpa e deixa a mensagem seguir o fluxo normal.
  if (
    fsession?.last_message_at &&
    Date.now() - new Date(fsession.last_message_at).getTime() > PENDING_TTL_MS
  ) {
    await clearPendingFinanceSession(supabase, senderPhone)
    return false
  }

  const text = messageText.trim()
  if (NEGATIVE.test(text)) {
    await clearPendingFinanceSession(supabase, senderPhone)
    await sendFinanceReply(senderPhone, 'Ok, não registrei nada. Me chama de novo quando quiser.')
    return true
  }

  const units = await listAccountUnits(supabase, accountId)
  const resolved = resolveUnit(units, text)
  if (resolved.status !== 'one') {
    await sendFinanceReply(senderPhone, buildWorkspaceNotMatchedMessage(units))
    return true
  }

  await clearPendingFinanceSession(supabase, senderPhone)
  const today = new Date().toISOString().split('T')[0]
  await persistEntryAndConfirm(supabase, {
    accountId,
    senderPhone,
    userId,
    type: 'pj',
    direction: pending.entry.direction,
    description: pending.entry.description,
    amount: pending.entry.amount,
    categoryName: pending.entry.category,
    categoryId: pending.entry.category_id,
    subcategoryId: pending.entry.subcategory_id,
    workspaceId: resolved.unit.id,
    rawMessage: pending.entry.raw_message,
    today,
  })
  return true
}

async function clearPendingFinanceSession(
  supabase: ReturnType<typeof createAdminClient>,
  senderPhone: string
): Promise<void> {
  await supabase
    .from('finance_sessions')
    .update({ pending_entry: null, last_message_at: new Date().toISOString() })
    .eq('phone', senderPhone)
}

// Lançamentos da account com os filtros da consulta. `type`/`categoryId`/
// `subcategoryId` nulos significam "todos"; `month` nulo significa o mês atual.
async function getEntries(accountId: string, filters: QueryFilters): Promise<FinanceEntry[]> {
  const supabase = createAdminClient()

  const ref = filters.month
    ? new Date(Number(filters.month.slice(0, 4)), Number(filters.month.slice(5, 7)) - 1, 1)
    : new Date()
  const firstDay = new Date(ref.getFullYear(), ref.getMonth(), 1).toISOString().split('T')[0]
  const lastDay = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).toISOString().split('T')[0]

  // direction vem sempre explícita do chamador — nunca mistura receita e
  // despesa na mesma consulta ou no total pós-registro (ver QueryFilters).
  let query = supabase
    .from('finance_entries')
    .select('*')
    .eq('account_id', accountId)
    .eq('direction', filters.direction)
    .gte('entry_date', firstDay)
    .lte('entry_date', lastDay)

  if (filters.type) query = query.eq('type', filters.type)
  if (filters.categoryId) query = query.eq('category_id', filters.categoryId)
  if (filters.subcategoryId) query = query.eq('subcategory_id', filters.subcategoryId)
  if (filters.workspaceId) query = query.eq('workspace_id', filters.workspaceId)

  const { data } = await query.order('entry_date', { ascending: false })

  return data ?? []
}

export async function sendFinanceReply(to: string, text: string): Promise<void> {
  const phoneNumberId = process.env.FINANCE_PHONE_NUMBER_ID
  const token = process.env.FINANCE_META_TOKEN

  if (!phoneNumberId || !token) {
    console.error('[finance-agent] Missing FINANCE_PHONE_NUMBER_ID or FINANCE_META_TOKEN')
    return
  }

  await sendWhatsAppMessage({ to, message: text, phoneNumberId, token })
}

// Chave canônica de telefone, para comparar o `from` da Meta com o que está
// em profiles.phone. Precisa absorver duas diferenças independentes:
//
//  1. Formato — a Meta manda só dígitos em formato internacional
//     ("5561995704956"), profiles.phone costuma vir local e com máscara
//     ("(61) 99570-4956"). Abaixo de 12 dígitos assume-se Brasil e prefixa 55.
//
//  2. Nono dígito — a Meta é inconsistente com o 9 dos celulares brasileiros
//     e frequentemente o omite (o próprio número financeiro é devolvido pela
//     API como "+55 61 9570-4956"). Por isso a chave usa só os 8 últimos
//     dígitos, que são estáveis nas duas formas.
//
// Resultado: 55 + DDD + 8 dígitos finais.
//
// Assume Brasil por definição: com 11 dígitos ou menos não há como
// distinguir um celular BR sem código do país ("61995704956") de um número
// estrangeiro com ele ("14155550123" = +1 415 555 0123), e os dois viram
// chave brasileira. É aceitável porque profiles.phone é preenchido por
// médicos no Brasil, em formato local — mas um owner com telefone
// estrangeiro não seria reconhecido por este agente.
function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const withCountry = digits.length <= 11 ? `55${digits}` : digits

  if (withCountry.startsWith('55') && withCountry.length >= 12) {
    return `55${withCountry.slice(2, 4)}${withCountry.slice(-8)}`
  }

  return withCountry
}
