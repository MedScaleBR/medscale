import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { WorkspacesClient } from '@/components/locais/WorkspacesClient'

export default async function AdminAccountWorkspacesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: account }, { data: workspaces }] = await Promise.all([
    supabase.from('accounts').select('id, name').eq('id', id).single(),
    supabase
      .from('workspaces')
      .select('id, name, slug, address, city, state, zip_code, is_active, is_default, display_order')
      .eq('account_id', id)
      .order('display_order'),
  ])

  if (!account) notFound()

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href={`/admin/accounts/${id}`} className="mb-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-3.5 w-3.5" />
          {account.name}
        </Link>
        <h1 className="text-xl font-medium text-gray-900">Unidades</h1>
        <p className="text-sm text-gray-400">Workspaces da account {account.name}.</p>
      </div>

      <WorkspacesClient
        initialWorkspaces={workspaces ?? []}
        canManage
        apiBase={`/api/admin/accounts/${id}/workspaces`}
      />
    </div>
  )
}
