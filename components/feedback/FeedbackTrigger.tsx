'use client'

import { MessageSquarePlus } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useFeedback } from './feedback-context'

// Fica fora do NAV_GROUPS de propósito: feedback não é módulo do plano e não
// deve passar pelo gate de permissões da navegação.
export function SidebarFeedbackButton() {
  const { open } = useFeedback()

  return (
    <button
      type="button"
      onClick={open}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--w70)] transition-colors hover:bg-[var(--w10)] hover:text-white"
    >
      <MessageSquarePlus className="h-4 w-4" />
      Enviar feedback
    </button>
  )
}

// A sidebar é md:flex — no celular o menu do avatar é o único caminho.
export function FeedbackMenuItem() {
  const { open } = useFeedback()

  return (
    <DropdownMenuItem onClick={open} className="flex items-center gap-2">
      <MessageSquarePlus className="h-4 w-4" />
      Enviar feedback
    </DropdownMenuItem>
  )
}
