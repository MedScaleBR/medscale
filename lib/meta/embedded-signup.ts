import crypto from 'crypto'
import { graphFetch, MetaApiError } from './graph'

// Os quatro passos que o Embedded Signup exige da Meta. Cada um erra com
// mensagem própria: um erro genérico aqui é indepurável — o usuário não
// distingue problema de número, de permissão ou de conta.

export function isEmbeddedSignupConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_META_APP_ID && process.env.META_ES_CONFIG_ID && process.env.META_APP_SECRET)
}

/** Troca o `code` do popup pelo token de system user do negócio (sem expiração). */
export async function exchangeEmbeddedSignupCode(code: string): Promise<string> {
  try {
    const data = await graphFetch<{ access_token: string }>('/oauth/access_token', {
      params: {
        client_id: process.env.NEXT_PUBLIC_META_APP_ID ?? '',
        client_secret: process.env.META_APP_SECRET ?? '',
        code,
      },
    })
    if (!data.access_token) throw new Error('sem access_token')
    return data.access_token
  } catch (err) {
    throw new Error(
      `Não foi possível concluir a autorização do WhatsApp (a autorização pode ter expirado — tente conectar de novo). Detalhe da Meta: ${
        err instanceof MetaApiError ? err.message : String(err)
      }`
    )
  }
}

/** Inscreve o App da MedScale no WABA do cliente — é o que faz o webhook receber mensagens. */
export async function subscribeAppToWaba(wabaId: string, token: string): Promise<void> {
  try {
    await graphFetch(`/${wabaId}/subscribed_apps`, { token, method: 'POST' })
  } catch (err) {
    throw new Error(
      `Não foi possível inscrever o App no seu WhatsApp Business. Detalhe da Meta: ${
        err instanceof MetaApiError ? err.message : String(err)
      }`
    )
  }
}

export async function unsubscribeAppFromWaba(wabaId: string, token: string): Promise<void> {
  await graphFetch(`/${wabaId}/subscribed_apps`, { token, method: 'DELETE' })
}

/** Registra o número na Cloud API. Sem isso o número conecta mas não envia. */
export async function registerPhoneNumber(phoneNumberId: string, pin: string, token: string): Promise<void> {
  try {
    await graphFetch(`/${phoneNumberId}/register`, {
      token,
      method: 'POST',
      body: { messaging_product: 'whatsapp', pin },
    })
  } catch (err) {
    throw new Error(
      `Não foi possível registrar o número na Meta (ele precisa estar verificado antes de conectar). Detalhe da Meta: ${
        err instanceof MetaApiError ? err.message : String(err)
      }`
    )
  }
}

export async function fetchPhoneNumberInfo(
  phoneNumberId: string,
  token: string
): Promise<{ displayPhoneNumber: string | null; verifiedName: string | null }> {
  const data = await graphFetch<{ display_phone_number?: string; verified_name?: string }>(`/${phoneNumberId}`, {
    token,
    params: { fields: 'display_phone_number,verified_name' },
  })
  return {
    displayPhoneNumber: data.display_phone_number ?? null,
    verifiedName: data.verified_name ?? null,
  }
}

/** PIN da verificação em duas etapas. Guardado cifrado: sem ele, reconectar o mesmo número trava. */
export function generatePin(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}
