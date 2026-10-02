import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/components/auth/LogoutButton'
import { AdminNav } from '@/components/admin/AdminNav'
import { initialsFrom } from '@/lib/admin/format'
import { getNavCounts } from '@/lib/admin/nav-counts'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin } = await supabase.rpc('is_medscale_admin')
  if (!isAdmin) redirect('/dashboard')

  const [counts, { data: profile }] = await Promise.all([
    getNavCounts(supabase),
    supabase.from('profiles').select('full_name, email').eq('id', user.id).maybeSingle(),
  ])
  const displayName = profile?.full_name?.trim() || profile?.email || user.email || ''
  const initials = initialsFrom(profile?.full_name, profile?.email ?? user.email)

  return (
    <div className="min-h-screen bg-[var(--navy-06)]">
      {/* Em 1024px (lg, rótulos da nav visíveis) o nome "MedScale Admin" sai e os
          espaços apertam para caber com os dois contadores; ele volta em xl. */}
      <header className="flex h-16 items-center justify-between gap-4 bg-[var(--navy-dark)] px-6 xl:gap-6">
        <div className="flex min-w-0 items-center gap-4 xl:gap-6">
          <Link
            href="/admin"
            aria-label="MedScale Admin"
            className="flex shrink-0 items-center gap-2.5 rounded-[10px] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
          >
            <div className="flex h-8 items-center justify-center rounded-lg bg-white px-3">
              <Image src="/logo-icon.png" alt="MedScale" width={138} height={96} className="h-[22px] w-auto" priority />
            </div>
            <span className="hidden text-sm font-medium text-white xl:inline">MedScale Admin</span>
          </Link>
          <AdminNav counts={counts} />
        </div>
        <div className="flex shrink-0 items-center gap-3 whitespace-nowrap xl:gap-4">
          <Link
            href="/dashboard"
            className="rounded-[10px] text-xs text-[var(--w70)] outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
          >
            Voltar ao painel
          </Link>
          <span aria-hidden="true" className="h-6 w-px bg-[var(--w15)]" />
          <div className="flex items-center gap-1">
            <span
              role="img"
              title={displayName}
              aria-label={displayName ? `Conectado como ${displayName}` : 'Conectado'}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--w15)] text-[11px] font-medium text-white"
            >
              {initials}
            </span>
            {/* LogoutButton é um Button outline fixo (fundo branco); aqui ele vira texto sobre navy. */}
            <div className="[&_button]:h-8 [&_button]:rounded-[10px] [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-2 [&_button]:text-xs [&_button]:font-normal [&_button]:text-[var(--w70)] [&_button:hover]:bg-white/10 [&_button:hover]:text-white [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-[var(--cyan)]">
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  )
}
