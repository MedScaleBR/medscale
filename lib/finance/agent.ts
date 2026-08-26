import { createAdminClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage } from '@/lib/whatsapp/send'
import { parseCommand } from './parser'
import { categorizeEntry } from './categorize'
import {
  buildConfirmationMessage,
  buildSummaryMessage,
  buildHelpMessage,
  buildUnknownMessage,
  buildUnregisteredMessage,
} from './respond'
import type { FinanceEntry, FinanceEntryType } from './types'

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

  // 3. Parsear comando
  const command = parseCommand(messageText)

  if (command.kind === 'help') {
    await sendFinanceReply(senderPhone, buildHelpMessage())
    return
  }

  if (command.kind === 'unknown') {
    await sendFinanceReply(senderPhone, buildUnknownMessage())
    return
  }

  if (command.kind === 'summary') {
    const entries = await getMonthEntries(accountId, command.type)
    const response = await buildSummaryMessage(entries, command.type)
    await sendFinanceReply(senderPhone, response)
    return
  }

  // 4. Categorizar (se tem descrição)
  let category: string | null = null
  if (command.description) {
    category = await categorizeEntry(command.description, command.type)
  }

  // 5. Salvar no banco
  const { data: entry, error } = await supabase
    .from('finance_entries')
    .insert({
      account_id: accountId,
      recorded_by_phone: senderPhone,
      type: command.type,
      description: command.description,
      amount: command.amount,
      category,
      raw_message: messageText,
      entry_date: new Date().toISOString().split('T')[0],
    })
    .select('*')
    .single()

  if (error || !entry) {
    await sendFinanceReply(senderPhone, `Erro ao registrar o lançamento. Tente novamente.`)
    return
  }

  // 6. Calcular total do mês para a confirmação
  const monthEntries = await getMonthEntries(accountId, command.type)
  const monthTotal = monthEntries.reduce((s, e) => s + e.amount, 0)

  const response = await buildConfirmationMessage(entry, monthTotal)
  await sendFinanceReply(senderPhone, response)
}

async function getMonthEntries(accountId: string, type: FinanceEntryType): Promise<FinanceEntry[]> {
  const supabase = createAdminClient()
  const now = new Date()
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]

  const { data } = await supabase
    .from('finance_entries')
    .select('*')
    .eq('account_id', accountId)
    .eq('type', type)
    .gte('entry_date', firstDay)
    .lte('entry_date', lastDay)
    .order('created_at', { ascending: false })

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
