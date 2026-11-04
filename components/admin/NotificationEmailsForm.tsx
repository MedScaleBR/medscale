'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { NOTIFICATION_EMAILS_MAX, parseNotificationEmails, splitEmails } from '@/lib/bot/notification-emails'
import { saveNotificationEmails } from './clara-api'

// "E-mails que recebem as solicitações" de uma unidade (só equipe MedScale).
export function NotificationEmailsForm({
  workspaceId,
  initial,
  onSaved,
}: {
  workspaceId: string
  initial: string[]
  onSaved?: (emails: string[]) => void
}) {
  const [text, setText] = useState(initial.join('\n'))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const parsed = parseNotificationEmails(splitEmails(text))

  const save = async () => {
    if (!parsed.ok) return
    setSaving(true)
    setMessage(null)
    const res = await saveNotificationEmails(workspaceId, parsed.value)
    setSaving(false)
    if (res.data === null) setMessage({ ok: false, text: res.error })
    else {
      setText(res.data.notification_emails.join('\n'))
      setMessage({ ok: true, text: 'Salvo.' })
      onSaved?.(res.data.notification_emails)
    }
  }

  return (
    <div className="mt-6 border-t border-[var(--navy-06)] pt-5">
      <Label htmlFor={`ws-${workspaceId}-emails`}>E-mails que recebem as solicitações</Label>
      <p className="mb-1 text-xs text-gray-400">
        Um por linha, até {NOTIFICATION_EMAILS_MAX}. Cada solicitação de agendamento desta unidade chega por e-mail, com o
        resumo e a foto da carteirinha. Vazio = sem e-mail.
      </p>
      <Textarea
        id={`ws-${workspaceId}-emails`}
        value={text}
        rows={3}
        onChange={(e) => {
          setText(e.target.value)
          setMessage(null)
        }}
        placeholder="secretaria@clinica.com.br"
      />
      {!parsed.ok && <p className="mt-1 text-xs text-red-500">{parsed.error}</p>}
      <div className="mt-2 flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={saving || !parsed.ok} onClick={save}>
          {saving ? 'Salvando...' : 'Salvar e-mails'}
        </Button>
        {message && <span className={`text-xs ${message.ok ? 'text-gray-500' : 'text-red-500'}`}>{message.text}</span>}
      </div>
    </div>
  )
}
