'use client'

import { usePathname } from 'next/navigation'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LogOut, Settings } from 'lucide-react'
import Link from 'next/link'
import { moduleTitleFromPath } from '@/lib/nav/tabs'
import { useLogout } from '@/lib/auth/use-logout'
import type { ActiveSession, AccountSummary } from '@/lib/session/context'

interface TopbarProps {
  userName: string
  userEmail: string
  avatarUrl?: string | null
  session: ActiveSession
  accounts: AccountSummary[]
}

export function Topbar({ userName, userEmail, avatarUrl }: TopbarProps) {
  const pathname = usePathname()
  const screenTitle = moduleTitleFromPath(pathname)
  const handleLogout = useLogout()

  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <header className="flex h-14 items-center border-b border-[var(--navy-06)] bg-white px-4 md:h-16 md:px-6">
      <span className="text-base font-semibold text-[var(--navy)] md:hidden">{screenTitle}</span>
      <DropdownMenu>
        <DropdownMenuTrigger className="ml-auto flex items-center gap-3 rounded-lg px-2 py-1.5 outline-none hover:bg-[var(--navy-06)]">
          <div className="hidden text-right md:block">
            <p className="text-sm font-medium text-gray-900">{userName}</p>
            <p className="text-xs text-gray-400">{userEmail}</p>
          </div>
          <Avatar className="h-9 w-9">
            <AvatarImage src={avatarUrl ?? undefined} />
            <AvatarFallback className="bg-[var(--cyan-10)] text-[var(--cyan-dark)]">
              {initials}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem render={<Link href="/configuracoes" />} className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Configurações
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout} className="flex items-center gap-2 text-red-600">
            <LogOut className="h-4 w-4" />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
