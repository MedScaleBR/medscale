import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'
import { searchConversationIds } from '@/lib/bot/conversation-search'
import { loadInboxConversations } from '@/lib/bot/load-inbox'

// Busca de conversas por nome ou telefone em toda a account — a tela /bot só
// carrega as mais recentes, então conversas antigas só aparecem por aqui.
export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 100)
  const supabase = await createClient()
  const ids = await searchConversationIds(supabase, session.accountId, q)
  const conversations = await loadInboxConversations(supabase, session.accountId, { ids })
  return NextResponse.json({ conversations })
}
