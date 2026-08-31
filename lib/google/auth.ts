import { google } from 'googleapis'
import { createAdminClient } from '@/lib/supabase/server'
import { encryptToken, decryptToken } from '@/lib/crypto'

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
}

// URL para redirecionar o médico ao consentimento Google. A conexão é única
// por account (atende todas as unidades); cada unidade escolhe depois qual
// calendário representa ela (workspaces.gcal_calendar_id).
export function getAuthUrl(accountId: string): string {
  const oauth2 = getOAuthClient()
  return oauth2.generateAuthUrl({
    access_type: 'offline', // obrigatório para obter refresh_token
    prompt: 'consent', // força exibir tela de consentimento sempre (garante novo refresh_token)
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state: accountId, // recuperado no callback
  })
}

// Troca o code por tokens e salva criptografados no banco.
// connectedByUserId é quem de fato clicou "conectar" — fica em google_tokens.doctor_id.
export async function exchangeCodeAndSave(code: string, accountId: string, connectedByUserId: string) {
  const oauth2 = getOAuthClient()
  const { tokens } = await oauth2.getToken(code)

  if (!tokens.refresh_token) {
    throw new Error(
      'Refresh token não recebido. Revogue o acesso em myaccount.google.com/permissions e tente novamente.'
    )
  }
  if (!tokens.access_token || !tokens.expiry_date) {
    throw new Error('Resposta de token incompleta do Google.')
  }

  oauth2.setCredentials(tokens)
  const oauth2api = google.oauth2({ version: 'v2', auth: oauth2 })
  const { data } = await oauth2api.userinfo.get()

  const supabase = createAdminClient()
  const { error } = await supabase.from('google_tokens').upsert(
    {
      account_id: accountId,
      doctor_id: connectedByUserId,
      access_token: encryptToken(tokens.access_token),
      refresh_token: encryptToken(tokens.refresh_token),
      token_expiry: new Date(tokens.expiry_date).toISOString(),
      google_email: data.email ?? null,
    },
    { onConflict: 'account_id' }
  )

  if (error) throw new Error(error.message)
}

// Retorna um client OAuth autenticado, renovando o access_token se necessário
export async function getAuthenticatedClient(accountId: string) {
  const supabase = createAdminClient()
  const { data: row, error } = await supabase
    .from('google_tokens')
    .select('access_token, refresh_token, token_expiry')
    .eq('account_id', accountId)
    .single()

  if (error || !row) throw new Error('Google Calendar não conectado para esta conta.')

  const oauth2 = getOAuthClient()
  oauth2.setCredentials({
    access_token: decryptToken(row.access_token),
    refresh_token: decryptToken(row.refresh_token),
    expiry_date: new Date(row.token_expiry).getTime(),
  })

  // googleapis renova automaticamente via refresh_token quando expirado;
  // persistimos o novo access_token para as próximas chamadas.
  oauth2.on('tokens', (newTokens) => {
    if (!newTokens.access_token || !newTokens.expiry_date) return
    void supabase
      .from('google_tokens')
      .update({
        access_token: encryptToken(newTokens.access_token),
        token_expiry: new Date(newTokens.expiry_date).toISOString(),
      })
      .eq('account_id', accountId)
  })

  return oauth2
}

export async function isGoogleConnected(accountId: string): Promise<{ connected: boolean; email: string | null }> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('google_tokens')
    .select('google_email')
    .eq('account_id', accountId)
    .maybeSingle()

  return { connected: Boolean(data), email: data?.google_email ?? null }
}
