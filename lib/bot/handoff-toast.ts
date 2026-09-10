// Payload do evento `handoff_message` que o server emite em
// `broadcastToWorkspace` e o `HandoffToastListener` consome no client.
export interface HandoffToastEvent {
  conversationId: string
  patientName?: string
}

// Toast só é ruído quando o usuário JÁ está olhando exatamente a conversa que
// recebeu a mensagem. Em qualquer outro lugar do sistema (outra página, ou o
// inbox com outra conversa / nenhuma aberta) ele aparece.
export function shouldShowHandoffToast(args: {
  pathname: string
  openConversationId: string | null
  event: HandoffToastEvent
}): boolean {
  const onThisConversation =
    args.pathname === '/bot' && args.openConversationId === args.event.conversationId
  return !onThisConversation
}
