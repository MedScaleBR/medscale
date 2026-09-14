import { Bug } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'

const MAX_ROWS = 200

type WebhookDebugLogRow = {
  id: string
  phone_number_id: string | null
  is_finance_number: boolean
  signature_valid: boolean
  account_id: string | null
  message_type: string | null
  content: string | null
  whatsapp_id: string | null
  created_at: string
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value))
}

export default async function AdminWebhookDebugPage() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('webhook_debug_log')
    .select('id, phone_number_id, is_finance_number, signature_valid, account_id, message_type, content, whatsapp_id, created_at')
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)

  if (error) console.error('Erro ao buscar webhook_debug_log:', error.message)

  const rows = (data ?? []) as WebhookDebugLogRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Webhook debug (temporário)</h1>
        <p className="text-sm text-gray-400">
          Toda chamada recebida em <code>/api/whatsapp/webhook</code>, incluindo as que falham na validação de
          assinatura. Página temporária para diagnóstico — remover junto com a tabela <code>webhook_debug_log</code>{' '}
          quando não for mais necessária.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        <div className="flex items-center gap-2 border-b border-[var(--navy-06)] px-5 py-3">
          <Bug className="h-4 w-4 text-[var(--cyan-dark)]" />
          <h2 className="text-sm font-medium text-gray-900">Chamadas recebidas</h2>
        </div>

        {rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">Nenhuma chamada registrada ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 text-left text-xs text-gray-400">
                  <th className="px-5 py-3 font-normal">Recebida em</th>
                  <th className="px-5 py-3 font-normal">phone_number_id</th>
                  <th className="px-5 py-3 font-normal">Assinatura</th>
                  <th className="px-5 py-3 font-normal">Número financeiro?</th>
                  <th className="px-5 py-3 font-normal">Account</th>
                  <th className="px-5 py-3 font-normal">Mensagem</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--navy-06)] align-top last:border-0 hover:bg-[var(--navy-06)]/40"
                  >
                    <td className="whitespace-nowrap px-5 py-4 text-xs text-gray-500">{formatDate(row.created_at)}</td>
                    <td className="whitespace-nowrap px-5 py-4 font-mono text-xs text-gray-700">
                      {row.phone_number_id ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4">
                      {row.signature_valid ? (
                        <Badge className="border-none bg-emerald-50 text-emerald-700">Válida</Badge>
                      ) : (
                        <Badge className="border-none bg-red-50 text-red-700">Falhou</Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4">
                      {row.is_finance_number ? (
                        <Badge className="border-none bg-cyan-50 text-cyan-700">Sim</Badge>
                      ) : (
                        <Badge className="border-none bg-gray-100 text-gray-600">Não</Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-xs text-gray-500">{row.account_id ?? '—'}</td>
                    <td className="px-5 py-4 text-gray-700">
                      {row.content ? (
                        <p className="max-w-xl whitespace-pre-wrap break-words">{row.content}</p>
                      ) : (
                        <span className="text-xs text-gray-400">{row.message_type ?? 'sem corpo (evento não-texto)'}</span>
                      )}
                      {row.whatsapp_id && <p className="mt-2 text-[11px] text-gray-400">{row.whatsapp_id}</p>}
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
