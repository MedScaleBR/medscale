import Link from 'next/link'
import { MessageCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'

const MAX_MESSAGES = 200

type FinanceAgentMessageRow = {
  id: string
  account_id: string | null
  phone: string
  content: string
  whatsapp_id: string | null
  created_at: string
  accounts?: { name: string } | null
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value))
}

export default async function AdminConversasPage() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('finance_agent_messages')
    .select('id, account_id, phone, content, whatsapp_id, created_at, accounts(name)')
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES)

  if (error) console.error('Erro ao buscar mensagens do agente financeiro:', error.message)

  const messages = (data ?? []) as unknown as FinanceAgentMessageRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Conversas</h1>
        <p className="text-sm text-gray-400">Últimas mensagens recebidas no número do agente financeiro.</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        <div className="flex items-center gap-2 border-b border-[var(--navy-06)] px-5 py-3">
          <MessageCircle className="h-4 w-4 text-[var(--cyan-dark)]" />
          <h2 className="text-sm font-medium text-gray-900">Mensagens recebidas</h2>
        </div>

        {messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">
            Nenhuma mensagem do agente financeiro registrada ainda.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 text-left text-xs text-gray-400">
                  <th className="px-5 py-3 font-normal">Recebida em</th>
                  <th className="px-5 py-3 font-normal">Telefone</th>
                  <th className="px-5 py-3 font-normal">Account</th>
                  <th className="px-5 py-3 font-normal">Mensagem</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((message) => (
                  <tr
                    key={message.id}
                    className="border-b border-[var(--navy-06)] align-top last:border-0 hover:bg-[var(--navy-06)]/40"
                  >
                    <td className="whitespace-nowrap px-5 py-4 text-xs text-gray-500">
                      {formatDate(message.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 font-medium text-gray-900">{message.phone}</td>
                    <td className="whitespace-nowrap px-5 py-4">
                      {message.account_id ? (
                        <Link
                          href={`/admin/accounts/${message.account_id}`}
                          className="text-gray-700 hover:text-[var(--cyan-dark)]"
                        >
                          {message.accounts?.name ?? 'Account sem nome'}
                        </Link>
                      ) : (
                        <Badge className="border-none bg-amber-50 text-amber-700">Não identificada</Badge>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-700">
                      <p className="max-w-2xl whitespace-pre-wrap break-words">{message.content}</p>
                      {message.whatsapp_id && <p className="mt-2 text-[11px] text-gray-400">{message.whatsapp_id}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
