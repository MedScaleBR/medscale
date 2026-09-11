'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'

interface FeedbackContextValue {
  isOpen: boolean
  open: () => void
  close: () => void
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null)

// Separa quem abre o balão (sidebar, menu do avatar, regra dos 15 dias) de
// quem o desenha — os três ficam em ramos distintos da árvore do layout.
export function FeedbackProvider({
  initialOpen = false,
  children,
}: {
  initialOpen?: boolean
  children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(initialOpen)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  const value = useMemo(() => ({ isOpen, open, close }), [isOpen, open, close])

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>
}

export function useFeedback() {
  const context = useContext(FeedbackContext)
  if (!context) throw new Error('useFeedback precisa estar dentro de FeedbackProvider')
  return context
}
