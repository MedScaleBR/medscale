import { NextRequest, NextResponse } from 'next/server'
import { requireMedscaleAdmin } from '@/lib/admin/require-admin'
import { parseNotificationEmails } from '@/lib/bot/notification-emails'

// "Aplicar e-mails a todas as unidades" de uma account — só a equipe MedScale.
// Grava a mesma lista em cada unidade ativa; depois dá para ajustar uma a uma.
// Mesmas permissões da rota por unidade (RLS "medscale admin full" + trigger).
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
    .eq('account_id', id)
    .eq('is_active', true)
    .select('id, notification_emails')

  if (error) {
    console.error(`[admin] notification-emails da account falhou account=${id}`)
    return NextResponse.json({ error: 'Não foi possível salvar os e-mails.' }, { status: 500 })
  }
  return NextResponse.json({ workspaces: data ?? [] })
}
