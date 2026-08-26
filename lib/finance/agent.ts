import { createAdminClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage } from '@/lib/whatsapp/send'
import { parseCommand } from './parser'
import { interpretMessage } from './interpret'
import { categorizeEntry } from './categorize'
import {
  buildConfirmationMessage,
  buildQueryMessage,
  buildSmalltalkMessage,
  buildUndoMessage,
  buildNothingToUndoMessage,
  buildHelpMessage,
  buildUnknownMessage,
  buildUnregisteredMessage,
  type QueryFilters,
} from './respond'
import type { FinanceEntry } from './types'

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

  // 3. Entender a mensagem. Atalho com barra primeiro (instantâneo e sem
  // custo); só o que não for comando vai para o Claude interpretar.
  const today = new Date().toISOString().split('T')[0]
  const shortcut = parseCommand(messageText)
  const intent = shortcut.kind === 'unknown' ? await interpretMessage(messageText, today) : shortcut

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
    const entries = await getEntries(accountId, {
      type: intent.type,
      category: intent.category,
      month: intent.month,
    })
    const response = await buildQueryMessage(entries, intent)
    await sendFinanceReply(senderPhone, response)
    return
  }

  // 4. Categorizar. A interpretação por linguagem natural já traz a
  // categoria; só o caminho dos atalhos precisa desta chamada extra.
  let category = intent.category
  if (!category && intent.description) {
    category = await categorizeEntry(intent.description, intent.type)
  }

  // 5. Salvar no banco
  const { data: entry, error } = await supabase
    .from('finance_entries')
    .insert({
      account_id: accountId,
      recorded_by_phone: senderPhone,
      type: intent.type,
      description: intent.description,
      amount: intent.amount,
      category,
      raw_message: messageText,
      entry_date: today,
    })
    .select('*')
    .single()

  if (error || !entry) {
    await sendFinanceReply(senderPhone, `Erro ao registrar o lançamento. Tente novamente.`)
    return
  }

  // 6. Calcular total do mês para a confirmação
  const monthEntries = await getEntries(accountId, { type: intent.type, category: null, month: null })
  const monthTotal = monthEntries.reduce((s, e) => s + e.amount, 0)

  const response = await buildConfirmationMessage(entry, monthTotal)
  await sendFinanceReply(senderPhone, response)
}

// Apaga o lançamento mais recente da account. Existe porque o registro por
// linguagem natural grava direto, sem etapa de confirmação — sem um jeito de
// desfazer pelo WhatsApp, um valor lido errado só sairia via SQL.
async function handleUndo(
  supabase: ReturnType<typeof createAdminClient>,
  accountId: string,
  senderPhone: string
): Promise<void> {
  const { data: last } = await supabase
    .from('finance_entries')
    .select('*')
    .eq('account_id', accountId)
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

// Lançamentos da account com os filtros da consulta. `type`/`category` nulos
// significam "todos"; `month` nulo significa o mês atual.
async function getEntries(accountId: string, filters: QueryFilters): Promise<FinanceEntry[]> {
  const supabase = createAdminClient()

  const ref = filters.month
    ? new Date(Number(filters.month.slice(0, 4)), Number(filters.month.slice(5, 7)) - 1, 1)
    : new Date()
  const firstDay = new Date(ref.getFullYear(), ref.getMonth(), 1).toISOString().split('T')[0]
  const lastDay = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).toISOString().split('T')[0]

  let query = supabase
    .from('finance_entries')
    .select('*')
    .eq('account_id', accountId)
    .gte('entry_date', firstDay)
    .lte('entry_date', lastDay)

  if (filters.type) query = query.eq('type', filters.type)
  if (filters.category) query = query.eq('category', filters.category)

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
