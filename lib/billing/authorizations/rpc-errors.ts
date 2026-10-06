import { NextResponse } from 'next/server'
import { INCOMPLETE_INSURER_ERROR } from '../insurer'
import { isEditable } from './status'
import type { AuthorizationStatus } from './types'

// Mensagens fixas por chave de erro dos RPCs (raise exception '<chave>').
// Nunca devolver error.message cru: pode citar valores (carteirinha etc.).
const RPC_ERRORS: Record<string, { status: number; error: string }> = {
  tiss_authorization_forbidden: { status: 403, error: 'Sem permissão para esta ação.' },
  // Vem de next_tiss_number (chamado por create_tiss_authorization); defesa —
  // o RPC já recusou antes quem não é owner/admin.
  billing_forbidden: { status: 403, error: 'Sem permissão para esta ação.' },
  billing_module_disabled: { status: 403, error: "Módulo 'billing' não está ativo no seu plano" },
  tiss_authorization_not_found: { status: 404, error: 'Autorização não encontrada' },
  tiss_authorization_not_editable: { status: 409, error: 'Autorização já enviada ou cancelada — somente leitura.' },
  tiss_authorization_changed: { status: 409, error: 'A autorização foi alterada por outra pessoa. Recarregue e tente de novo.' },
  tiss_authorization_invalid_transition: { status: 409, error: 'Mudança de status não permitida.' },
  tiss_authorization_incomplete: { status: 409, error: 'Complete os campos pendentes antes de gerar o XML.' },
  tiss_authorization_payload_mismatch: { status: 409, error: 'Os dados da operadora mudaram. Use "Recarregar dados".' },
  tiss_authorization_parent_invalid: { status: 400, error: 'Guia de origem inválida para o anexo OPME.' },
  tiss_authorization_account_mismatch: { status: 400, error: 'Paciente, operadora ou unidade não pertencem a esta conta.' },
  tiss_authorization_appointment_mismatch: { status: 400, error: 'O agendamento não é deste paciente ou desta unidade.' },
  tiss_authorization_item_kind: { status: 400, error: 'Tipo de item incompatível com a autorização.' },
  tiss_authorization_item_not_found: { status: 400, error: 'Item da resposta não pertence a esta autorização.' },
  tiss_authorization_invalid: { status: 400, error: 'Dados inválidos.' },
  tiss_insurer_incomplete: { status: 400, error: INCOMPLETE_INSURER_ERROR },
}

export function authorizationRpcError(error: { message?: string; code?: string } | null): NextResponse {
  const known = error?.message ? RPC_ERRORS[error.message] : undefined
  if (known) return NextResponse.json({ error: known.error }, { status: known.status })
  // CHECK/cast do banco (limites do XSD) que passaram pela validação da rota.
  if (error?.code === '23514' || error?.code === '22P02' || error?.code === '22023') {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  }
  console.error('[billing] erro inesperado em RPC de autorização', { code: error?.code ?? 'unknown' })
  return NextResponse.json({ error: 'Não foi possível concluir a operação.' }, { status: 500 })
}

// 409 antes de chamar o RPC quando o status já não permite editar conteúdo
// ou itens (sent, final, cancelled). Mesma mensagem do RPC not_editable.
export function readOnlyConflict(status: AuthorizationStatus): NextResponse | null {
  if (isEditable(status)) return null
  return NextResponse.json({ error: RPC_ERRORS.tiss_authorization_not_editable.error }, { status: 409 })
}
