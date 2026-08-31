import { createAdminClient } from '@/lib/supabase/server'

// Rate limiting do webhook do WhatsApp por (account, número de telefone).
// Janela deslizante de RATE_LIMIT_WINDOW_SECONDS; acima de
// RATE_LIMIT_MAX_MESSAGES por janela a mensagem é bloqueada antes de qualquer
// processamento (Claude, Graph API). Store no Postgres via Supabase — a Vercel
// roda funções serverless sem estado compartilhado entre instâncias, então um
// Map em module scope funcionaria só dentro da mesma instância e falharia em
// silêncio sob carga (múltiplas instâncias). Ver supabase/migration_rate_limit.sql.

export const RATE_LIMIT_WINDOW_SECONDS = 60
export const RATE_LIMIT_MAX_MESSAGES = 10

// Enviada ao paciente UMA vez por janela de bloqueio (flag `notified`).
export const RATE_LIMIT_NOTICE_MESSAGE =
  'Recebemos muitas mensagens em sequência. Por favor, aguarde um momento antes de continuar. 🙏'

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; shouldNotify: boolean }

/**
 * Checa e incrementa o rate limit para um número dentro de uma account.
 *
 * Retorna:
 * - `{ allowed: true }` — dentro do limite, pode processar normalmente.
 * - `{ allowed: false, shouldNotify: true }` — primeira mensagem bloqueada
 *   nesta janela: enviar o aviso ao paciente.
 * - `{ allowed: false, shouldNotify: false }` — já bloqueado e já avisado
 *   nesta janela: descartar em silêncio.
 *
 * Isolamento por tenant: o bucket é (account_id, phone), então um número
 * abusivo numa account não afeta o atendimento de outra.
 *
 * A checagem é SELECT + UPSERT/UPDATE, não uma operação atômica única. Sob
 * mensagens concorrentes do mesmo número duas invocações podem ler o mesmo
 * contador e deixar passar uma ou duas mensagens a mais — folga aceitável
 * para um rate limiter cujo objetivo é conter volume desproporcional, não
 * impor um teto exato.
 */
export async function checkRateLimit(accountId: string, phone: string): Promise<RateLimitResult> {
  const supabase = createAdminClient()
  const now = new Date()
  const windowCutoff = new Date(now.getTime() - RATE_LIMIT_WINDOW_SECONDS * 1000)

  const { data: existing } = await supabase
    .from('rate_limit_log')
    .select('window_start, message_count, notified, blocked_at')
    .eq('account_id', accountId)
    .eq('phone', phone)
    .maybeSingle()

  const windowExpired = !existing || new Date(existing.window_start) < windowCutoff

  if (windowExpired) {
    // Janela expirada (ou primeiro contato): reinicia a janela com count = 1.
    await supabase.from('rate_limit_log').upsert(
      {
        account_id: accountId,
        phone,
        window_start: now.toISOString(),
        message_count: 1,
        blocked_at: null,
        notified: false,
      },
      { onConflict: 'account_id,phone' }
    )
    return { allowed: true }
  }

  const newCount = existing.message_count + 1

  if (newCount <= RATE_LIMIT_MAX_MESSAGES) {
    await supabase
      .from('rate_limit_log')
      .update({ message_count: newCount })
      .eq('account_id', accountId)
      .eq('phone', phone)
    return { allowed: true }
  }

  // Acima do limite. Avisa só na primeira mensagem bloqueada da janela.
  const isFirstBlock = !existing.notified

  if (isFirstBlock) {
    await supabase
      .from('rate_limit_log')
      .update({
        message_count: newCount,
        blocked_at: existing.blocked_at ?? now.toISOString(),
        notified: true,
      })
      .eq('account_id', accountId)
      .eq('phone', phone)
    return { allowed: false, shouldNotify: true }
  }

  // Já bloqueado e já avisado nesta janela — só contabiliza (rastreabilidade).
  await supabase
    .from('rate_limit_log')
    .update({ message_count: newCount })
    .eq('account_id', accountId)
    .eq('phone', phone)

  return { allowed: false, shouldNotify: false }
}
