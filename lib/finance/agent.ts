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
  // seus perfis — comparando telefone normalizado (dígitos apenas), já que
  // profiles.phone pode estar salvo com ou sem "+"/espaços/traços.
  const normalizedPhone = normalizePhone(senderPhone)

  const { data: ownerMemberships } = await supabase
    .from('memberships')
    .select('account_id, user_id')
    .eq('role', 'owner')
    .eq('status', 'active')

  const ownerUserIds = (ownerMemberships ?? []).map((m) => m.user_id)

  const { data: profiles } = ownerUserIds.length
    ? await supabase.from('profiles').select('id, phone').in('id', ownerUserIds).not('phone', 'is', null)
    : { data: [] }

  const matchedProfile = (profiles ?? []).find((p) => p.phone && normalizePhone(p.phone) === normalizedPhone)
  const membership = matchedProfile
    ? ownerMemberships?.find((m) => m.user_id === matchedProfile.id)
    : undefined

  if (!membership) {
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

// Normaliza número de telefone para comparação. O `from` que a Meta manda
// sempre vem em formato internacional (código do país + DDD + número, sem
// símbolos — ex: "5511999999999"), mas profiles.phone pode ter sido salvo
// local, com máscara e sem o 55 (ex: "(11) 99999-9999" → "11999999999",
// 11 dígitos). Números de celular/fixo brasileiros nunca passam de 11
// dígitos sem o código do país, então abaixo disso assume-se Brasil e
// prefixa o 55 antes de comparar.
function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '')
  return digits.length >= 12 ? digits : `55${digits}`
}
