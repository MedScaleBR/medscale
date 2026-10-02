import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/components/auth/LogoutButton'
import { AdminNav } from '@/components/admin/AdminNav'
import { getNavCounts } from '@/lib/admin/nav-counts'

// Iniciais do avatar: nome do perfil (primeira + última palavra); sem nome,
// a parte local do e-mail.
function initialsFrom(fullName: string | null | undefined, email: string | null | undefined): string {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  const local = (email ?? '').split('@')[0].replace(/[^a-zA-Z0-9]/g, '')
  return local.slice(0, 2).toUpperCase() || '?'
}

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
      <header className="flex h-16 items-center justify-between gap-6 bg-[var(--navy-dark)] px-6">
        <div className="flex min-w-0 items-center gap-6">
          <Link
            href="/admin"
            className="flex shrink-0 items-center gap-2.5 rounded-[10px] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
          >
            <div className="flex h-8 items-center justify-center rounded-lg bg-white px-3">
              <Image src="/logo-icon.png" alt="MedScale" width={138} height={96} className="h-[22px] w-auto" priority />
            </div>
            <span className="text-sm font-medium text-white">MedScale Admin</span>
          </Link>
          <AdminNav counts={counts} />
        </div>
        <div className="flex shrink-0 items-center gap-4 whitespace-nowrap">
          <Link
            href="/dashboard"
            className="rounded-[10px] text-xs text-[var(--w70)] outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
          >
            Voltar ao painel
          </Link>
          <span aria-hidden="true" className="h-6 w-px bg-[var(--w15)]" />
          <div className="flex items-center gap-1">
            <span
              title={displayName}
              aria-label={displayName ? `Conectado como ${displayName}` : undefined}
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
