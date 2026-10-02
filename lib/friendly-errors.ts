const DEFAULT_ERROR = 'Não foi possível concluir esta ação. Tente novamente. Se o problema continuar, entre em contato com o suporte.'

const AUTH_MESSAGES: Record<string, string> = {
  Unauthorized: 'Sua sessão expirou. Entre novamente para continuar.',
  'Invalid login credentials': 'E-mail ou senha incorretos. Confira os dados e tente novamente.',
  'Email not confirmed': 'Confirme seu e-mail antes de entrar. Confira também a pasta de spam.',
  'User already registered': 'Este e-mail já está cadastrado. Entre na sua conta ou redefina a senha.',
  'New password should be different from the old password.': 'Escolha uma senha diferente da anterior.',
  'Token has expired or is invalid': 'Este link expirou. Solicite um novo link e tente novamente.',
}

// Só preserva orientações em português sem detalhes internos. Erros de SDKs,
// banco e exceções recebem o texto da ação; o erro original não é modificado.
const USER_MESSAGE_START = /^(?:Não|Nao|Informe|Confira|Confirme|Escolha|Selecione|Preencha|Aguarde|Tente|Você|Voce|Sua|Seu|Este|Esta|Esse|Essa|Já|Ja|E-mail|As senhas|A senha|O paciente|O telefone|O nome|O valor|O convite|O e-mail|A conta|A consulta|A unidade|A conexão|A Meta|Nenhum|Nenhuma|Convite criado|Dê um nome|Permita|Microfone|Gravação|Tempo máximo)(?=\s|$|[.,:!?])/i
const TECHNICAL_DETAILS = /(?:\b(?:Error|TypeError|SyntaxError|RangeError|Exception|SOAP|SOAPValidationError|Claude|OpenAI|Postgres|PostgREST|Supabase|SQL|SDK|SMTP|stack|constraint|violates|invalid|invalid_grant|account|workspace|owner|payload|undefined|null|fetch|HTTP|HTTPS|permission denied|relation|table|column|syntax|request|response|forbidden|unauthorized|ECONNREFUSED|ETIMEDOUT)\b|\w+_\w+|\bat\s+\S+\s*\(|https?:\/\/|\{\s*"|\n|\r)/i

function errorText(error: unknown): string | null {
  if (typeof error === 'string') return error.trim()
  if (error instanceof Error) return error.message.trim()
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message.trim()
  return null
}

export function friendlyErrorMessage(error: unknown, fallback = DEFAULT_ERROR): string {
  const message = errorText(error)
  if (!message) return fallback
  if (Object.hasOwn(AUTH_MESSAGES, message)) return AUTH_MESSAGES[message]
  if (USER_MESSAGE_START.test(message) && !TECHNICAL_DETAILS.test(message)) return message
  return fallback
}

export function transcriptionErrorMessage(error: unknown): string {
  const message = errorText(error) ?? ''
  const action = 'Clique em “Tentar novamente”. Se o problema continuar, entre em contato com o suporte.'
  if (/SOAP|prontuário|generate|Claude/i.test(message)) {
    return `Não foi possível gerar o prontuário desta consulta. ${action}`
  }
  if (/audio|áudio|Whisper|transcrib/i.test(message)) {
    return `Não foi possível transcrever o áudio desta consulta. ${action}`
  }
  return `Não foi possível processar esta consulta agora. ${action}`
}
