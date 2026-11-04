// Excluir unidade = arquivar (is_active = false). Apagar a linha levaria junto,
// por cascade, consultas, guias TISS, receitas e transcrições, que precisam
// ficar guardadas. Unidade arquivada some da sessão, da agenda e da Clara.

export const ARCHIVE_NOT_FOUND_ERROR = 'A unidade não foi encontrada.'
export const ARCHIVE_LAST_UNIT_ERROR = 'Esta é a única unidade da conta. Cadastre outra unidade antes de excluir esta.'

// Consultas que ainda vão acontecer (ou aguardam a clínica parceira).
export const ARCHIVE_BLOCKING_STATUSES = ['agendado', 'confirmado', 'pendente_confirmacao_externa'] as const

export function archiveFutureAppointmentsError(count: number): string {
  const what = count === 1 ? '1 consulta marcada' : `${count} consultas marcadas`
  return `A unidade tem ${what} a partir de agora. Remarque ou cancele antes de excluir.`
}

// Libera o slug (unique por account) para uma unidade nova com o mesmo nome.
export function archivedSlug(slug: string, id: string): string {
  return `${slug}-excluida-${id.slice(0, 8)}`
}
