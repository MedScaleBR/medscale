import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuthorizationRequestFields } from '@/components/billing/authorizations/AuthorizationRequestFields'
import { AuthorizationResponseForm } from '@/components/billing/authorizations/AuthorizationResponseForm'
import { defaultRequestData } from '@/lib/billing/authorizations/payload'
import type { AuthorizationDetail, AuthorizationRow, AuthorizationStatus } from '@/lib/billing/authorizations/types'

function detail(status: AuthorizationStatus, over: Partial<AuthorizationRow> = {}): AuthorizationDetail {
  const authorization = {
    id: 'a1', workspace_id: 'w1', patient_id: 'p1', insurer_id: 'i1', appointment_id: null, parent_id: null,
    type: 'opme_request', status, provider_guide_number: '42', missing_fields: [], operator_guide_number: 'OP-1',
    response_status_code: '1', requested_at: '2026-10-01', sent_at: '2026-10-02T10:00:00Z',
    responded_at: '2026-10-03T10:00:00.123456+00:00', created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-03T10:00:00.123456+00:00', professional_name: null, health_insurers: null, patients: null,
    payload: {} as AuthorizationRow['payload'], password: 'S3NHA', authorization_date: '2026-10-03',
    password_valid_until: '2026-11-03', ...over,
  } as AuthorizationRow
  return {
    authorization,
    items: [
      {
        id: 'it1', position: 1, kind: 'opme', table_code: '19', code: '123', description: 'Placa', quantity_requested: 2,
        quantity_authorized: 1, authorized_value_cents: 150000, manufacturer_option: '1', requested_value_cents: 200000,
        anvisa_registration: null, manufacturer_reference: null, operating_authorization: null,
      },
    ],
    parent: null,
    children: [],
  }
}

const render = (d: AuthorizationDetail) =>
  renderToStaticMarkup(<AuthorizationResponseForm detail={d} onSubmit={async () => {}} />)

describe('AuthorizationResponseForm', () => {
  it('opens the form directly while awaiting response, prefilled', () => {
    const html = render(detail('sent'))
    expect(html).toContain('Registrar resposta')
    expect(html).not.toContain('Corrigir resposta')
    expect(html).toContain('value="1500,00"')
  })

  it.each(['authorized', 'partially_authorized', 'denied'] as const)('shows %s read-only with "Corrigir resposta" (R1)', (s) => {
    const html = render(detail(s))
    expect(html).toContain('Corrigir resposta')
    expect(html).not.toContain('Registrar resposta')
    expect(html).toContain('OP-1')
  })

  it('cancelled with a response is read-only without correction', () => {
    const html = render(detail('cancelled'))
    expect(html).toContain('OP-1')
    expect(html).not.toContain('Corrigir resposta')
    expect(html).not.toContain('Registrar resposta')
  })

  it('renders nothing before sending or for cancelled without response', () => {
    expect(render(detail('draft'))).toBe('')
    expect(render(detail('ready'))).toBe('')
    expect(render(detail('cancelled', { responded_at: null }))).toBe('')
  })
})

describe('AuthorizationRequestFields', () => {
  const html = (type: 'sp_sadt_request' | 'hospitalization_request' | 'opme_request') =>
    renderToStaticMarkup(
      <AuthorizationRequestFields
        type={type}
        value={defaultRequestData(type)}
        editable
        missing={new Set(['request.clinical_indication'])}
        onChange={() => {}}
      />,
    )

  it('uses XSD maxLength on textareas', () => {
    expect(html('sp_sadt_request')).toMatch(/id="auth_sp_indication" maxLength="500"/)
    expect(html('sp_sadt_request')).toMatch(/id="auth_sp_observation" maxLength="500"/)
    expect(html('hospitalization_request')).toMatch(/id="auth_h_observation" maxLength="1000"/)
    expect(html('opme_request')).toMatch(/id="auth_o_justification" maxLength="1000"/)
    expect(html('opme_request')).toMatch(/id="auth_o_specification" maxLength="500"/)
    expect(html('opme_request')).toMatch(/id="auth_o_observation" maxLength="500"/)
  })

  it('highlights fields with pending data', () => {
    expect(html('hospitalization_request')).toMatch(/<textarea[^>]*border-amber-400[^>]*id="auth_h_indication"/)
    expect(html('hospitalization_request')).not.toMatch(/<textarea[^>]*border-amber-400[^>]*id="auth_h_observation"/)
  })
})
