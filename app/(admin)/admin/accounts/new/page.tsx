import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { NewAccountForm } from '@/components/admin/NewAccountForm'

export default function NewAccountPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/accounts"
          className="mb-3 inline-flex items-center gap-1 rounded text-xs text-gray-400 outline-none hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Accounts
        </Link>
        <h1 className="text-xl font-medium text-gray-900">Nova account</h1>
        <p className="text-sm text-gray-400">Cadastre o cliente e escolha como o owner entra.</p>
      </div>
      <NewAccountForm />
    </div>
  )
}
