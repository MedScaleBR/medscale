'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 60 * 60 * 24 * 30,
}

export async function switchWorkspace(workspaceId: string) {
  const cookieStore = await cookies()
  cookieStore.set('ms_workspace_id', workspaceId, COOKIE_OPTS)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) {
    await supabase.from('profiles').update({ last_workspace_id: workspaceId }).eq('id', user.id)
  }

  redirect('/dashboard')
}

export async function switchAccount(accountId: string) {
  const cookieStore = await cookies()
  cookieStore.set('ms_account_id', accountId, COOKIE_OPTS)
  cookieStore.delete('ms_workspace_id') // reseta o workspace ao trocar de account
  redirect('/dashboard')
}
