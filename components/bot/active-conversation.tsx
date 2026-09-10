'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'

// Ponte entre o inbox do bot e o HandoffToastListener (ambos no layout do
// dashboard):
//  - `activeConversationId`: qual conversa está aberta agora. O inbox publica;
//    o listener lê para NÃO mostrar toast da conversa que o usuário já vê.
//  - `pendingConversationId`: conversa que o clique num toast pediu para abrir.
//    O inbox consome no mount / quando a lista muda e limpa em seguida.
interface ActiveConversationValue {
  activeConversationId: string | null
  setActiveConversationId: (id: string | null) => void
  pendingConversationId: string | null
  requestConversation: (id: string) => void
  clearPendingConversation: () => void
}

const ActiveConversationContext = createContext<ActiveConversationValue | null>(null)

export function ActiveConversationProvider({ children }: { children: React.ReactNode }) {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null)

  const requestConversation = useCallback((id: string) => setPendingConversationId(id), [])
  const clearPendingConversation = useCallback(() => setPendingConversationId(null), [])

  const value = useMemo(
    () => ({
      activeConversationId,
      setActiveConversationId,
      pendingConversationId,
      requestConversation,
      clearPendingConversation,
    }),
    [activeConversationId, pendingConversationId, requestConversation, clearPendingConversation]
  )

  return <ActiveConversationContext.Provider value={value}>{children}</ActiveConversationContext.Provider>
}

// Fora do provider (ex.: página sem o inbox) o hook devolve no-ops — o listener
// ainda funciona, só não consegue suprimir por "conversa aberta".
export function useActiveConversation(): ActiveConversationValue {
  return (
    useContext(ActiveConversationContext) ?? {
      activeConversationId: null,
      setActiveConversationId: () => {},
      pendingConversationId: null,
      requestConversation: () => {},
      clearPendingConversation: () => {},
    }
  )
}
