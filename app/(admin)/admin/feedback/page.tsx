import { createClient } from '@/lib/supabase/server'
import { FeedbackList, type FeedbackRow } from '@/components/admin/FeedbackList'

export default async function AdminFeedbackPage() {
  const supabase = await createClient()

  const { data: rows, error } = await supabase
    .from('feedback')
    .select('id, message, status, created_at, account_id, user_id, accounts(name)')
    .order('created_at', { ascending: false })

  if (error) console.error('Erro ao buscar feedback:', error.message)

  // user_id aponta para auth.users, não para profiles — não há FK que o
  // PostgREST possa seguir, então o autor vem numa segunda consulta.
  const authorIds = [...new Set((rows ?? []).map((r) => r.user_id).filter((id): id is string => !!id))]
  const { data: authors } = authorIds.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', authorIds)
    : { data: [] }
  const authorsById = new Map((authors ?? []).map((a) => [a.id, a]))

  const feedback: FeedbackRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    message: r.message,
    status: r.status,
    createdAt: r.created_at,
    accountId: r.account_id,
    accountName: r.accounts?.name ?? null,
    authorName: (r.user_id && authorsById.get(r.user_id)?.full_name) ?? null,
    authorEmail: (r.user_id && authorsById.get(r.user_id)?.email) ?? null,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Feedback</h1>
        <p className="text-sm text-gray-400">Sugestões enviadas pelos clientes pelo balão do workspace</p>
      </div>

      <FeedbackList feedback={feedback} />
    </div>
  )
}
