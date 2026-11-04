import { NextRequest, NextResponse } from 'next/server'
import { requireMedscaleAdmin } from '@/lib/admin/require-admin'
import { parseNotificationEmails } from '@/lib/bot/notification-emails'

// E-mails que recebem as solicitações de agendamento da unidade — só a equipe
// MedScale. Client da sessão: a RLS "medscale admin full" libera o UPDATE e o
// trigger protect_workspace_bot_settings aceita is_medscale_admin().
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireMedscaleAdmin()
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => null)
  const parsed = parseNotificationEmails(body?.notification_emails)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { data, error } = await auth.supabase
    .from('workspaces')
    .update({ notification_emails: parsed.value })
    .eq('id', id)
    .select('id, notification_emails')
    .maybeSingle()

  if (error) {
    console.error(`[admin] notification-emails falhou workspace=${id}`)
    return NextResponse.json({ error: 'Não foi possível salvar os e-mails.' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  return NextResponse.json(data)
}
