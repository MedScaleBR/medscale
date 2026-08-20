import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { NewAccountForm } from '@/components/admin/NewAccountForm'

export default function NewAccountPage() {
  return (
    <div className="max-w-lg space-y-6">
      <div>
        <Link href="/admin/accounts" className="mb-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-3.5 w-3.5" />
          Accounts
        </Link>
        <h1 className="text-xl font-medium text-gray-900">Nova account</h1>
        <p className="text-sm text-gray-400">Cria a account, uma workspace padrão e convida o owner.</p>
      </div>
      <NewAccountForm />
    </div>
  )
}
