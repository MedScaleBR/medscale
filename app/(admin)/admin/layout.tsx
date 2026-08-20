import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/components/auth/LogoutButton'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin } = await supabase.rpc('is_medscale_admin')
  if (!isAdmin) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-[var(--navy-06)]">
      <header className="flex h-16 items-center justify-between border-b border-[var(--navy-06)] bg-[var(--navy-dark)] px-6">
        <Link href="/admin/accounts" className="flex items-center gap-2.5">
          <div className="flex h-8 items-center justify-center rounded-lg bg-white px-1.5">
            <Image src="/logo-icon.png" alt="MedScale" width={138} height={96} className="h-[18px] w-auto" priority />
          </div>
          <span className="text-sm font-semibold text-white">MedScale Admin</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-xs text-[var(--w70)] hover:text-white">
            Voltar ao painel
          </Link>
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  )
}
