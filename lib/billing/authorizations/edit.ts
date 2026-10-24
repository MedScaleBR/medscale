import {
  applyAuthorizationEdits, buildAuthorizationPayload, mergeRefreshedAuthorizationPayload,
  type AuthorizationSources, type ProfessionalOption,
} from './payload'
import { parseRequestPatch, type ContentPatch, type Result } from './validation'
import type { AnyAuthorizationPayload, AuthorizationPayload, AuthorizationType, RequestDataByType } from './types'

// Pontes entre o payload "qualquer tipo" das rotas e as funções genéricas:
// o switch estreita o tipo e evita casts.

export function buildInitialPayload(type: AuthorizationType, src: AuthorizationSources): AnyAuthorizationPayload {
  switch (type) {
    case 'sp_sadt_request': return buildAuthorizationPayload('sp_sadt_request', src)
    case 'hospitalization_request': return buildAuthorizationPayload('hospitalization_request', src)
    case 'opme_request': return buildAuthorizationPayload('opme_request', src)
  }
}

function refreshTyped<T extends AuthorizationType>(current: AuthorizationPayload<T>, src: AuthorizationSources): AuthorizationPayload<T> {
  return mergeRefreshedAuthorizationPayload(current, buildAuthorizationPayload(current.type, src, current.request))
}

export function refreshPayload(current: AnyAuthorizationPayload, src: AuthorizationSources): AnyAuthorizationPayload {
  switch (current.type) {
    case 'sp_sadt_request': return refreshTyped(current, src)
    case 'hospitalization_request': return refreshTyped(current, src)
    case 'opme_request': return refreshTyped(current, src)
  }
}

export interface PatchDeps {
  professional?: ProfessionalOption | null
  patientInsurance?: { id: string; card_number: string } | null
}

function patchTyped<T extends AuthorizationType>(
  payload: AuthorizationPayload<T>,
  patch: ContentPatch,
  deps: PatchDeps,
): Result<AuthorizationPayload<T>> {
  let request: RequestDataByType[T] | undefined
  if (patch.request !== undefined) {
    const parsed = parseRequestPatch(payload.type, payload.request, patch.request)
    if (!parsed.ok) return parsed
    request = parsed.value
  }
  return {
    ok: true,
    value: applyAuthorizationEdits(payload, {
      professional: deps.professional,
      patientInsurance: deps.patientInsurance,
      card_number: patch.card_number,
      newborn: patch.newborn,
      professional_phone: patch.professional_phone,
      professional_email: patch.professional_email,
      request,
    }),
  }
}

export function applyContentPatch(payload: AnyAuthorizationPayload, patch: ContentPatch, deps: PatchDeps): Result<AnyAuthorizationPayload> {
  switch (payload.type) {
    case 'sp_sadt_request': return patchTyped(payload, patch, deps)
    case 'hospitalization_request': return patchTyped(payload, patch, deps)
    case 'opme_request': return patchTyped(payload, patch, deps)
  }
}
