import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCalendar } from '@/lib/google/calendar'
import { requireWorkspaceSession } from '@/lib/session/api'

// Mapeia uma unidade a um calendário Google dentro da conexão única da account.
// Body: { workspace_id, calendar_id }        -> aponta a unidade para esse calendário
//       { workspace_id, calendar_id: null }  -> volta a unidade para o "primary"
//       { workspace_id, create: true }       -> cria um calendário novo (nome = nome da unidade) e aponta
export async function PATCH(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  if (session.role !== 'owner' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas owner/admin pode configurar calendários.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const workspaceId: string | undefined = body?.workspace_id
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id é obrigatório' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id, name, account_id')
    .eq('id', workspaceId)
    .single()

  if (!workspace || workspace.account_id !== session.accountId) {
    return NextResponse.json({ error: 'Unidade não encontrada nesta conta.' }, { status: 404 })
  }

  let calendarId: string | null
  if (body.create === true) {
    try {
      calendarId = await createCalendar(session.accountId, workspace.name)
    } catch (err) {
      return NextResponse.json({ error: `Não foi possível criar o calendário: ${String(err)}` }, { status: 502 })
    }
  } else {
    calendarId =
      typeof body.calendar_id === 'string' && body.calendar_id.trim() ? body.calendar_id.trim() : null
  }

  const { error } = await supabase
    .from('workspaces')
    .update({ gcal_calendar_id: calendarId })
    .eq('id', workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, workspace_id: workspaceId, calendar_id: calendarId })
}
