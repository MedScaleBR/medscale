import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMockConfig, type SupabaseMock } from '../helpers/supabase-mock'
import type { MockFn } from '../helpers/types'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  events: {
    list: null as unknown as MockFn,
    insert: null as unknown as MockFn,
    patch: null as unknown as MockFn,
    delete: null as unknown as MockFn,
  },
  calendarList: { list: null as unknown as MockFn },
  oauthClient: null as unknown as { setCredentials: MockFn; on: MockFn },
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/crypto', () => ({
  decryptToken: (t: string) => t.replace(/^enc:/, ''),
  encryptToken: (t: string) => `enc:${t}`,
}))
// googleapis inteiro é mockado — nenhum teste pode tocar a rede.
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({ events: g.events, calendarList: g.calendarList })),
    auth: {
      OAuth2: class {
        setCredentials = (...args: unknown[]) => g.oauthClient.setCredentials(...args)
        on = (...args: unknown[]) => g.oauthClient.on(...args)
      },
    },
  },
}))

import { listEvents, createEvent, cancelEvent, updateEvent } from '@/lib/google/calendar'
import { isGoogleConnected, getAuthenticatedClient } from '@/lib/google/auth'

const TOKEN_ROW = {
  access_token: 'enc:access-123',
  refresh_token: 'enc:refresh-456',
  token_expiry: '2025-09-15T15:00:00.000Z',
  google_email: 'medico@clinica.com',
}

function setup(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock({ google_tokens: { select: { data: TOKEN_ROW }, update: { data: null } }, ...config })
  g.events = {
    list: vi.fn(async () => ({ data: { items: [] } })),
    insert: vi.fn(async () => ({ data: { id: 'gcal-novo' } })),
    patch: vi.fn(async () => ({ data: { id: 'gcal-1' } })),
    delete: vi.fn(async () => ({ data: null })),
  }
  g.calendarList = { list: vi.fn(async () => ({ data: { items: [] } })) }
  g.oauthClient = { setCredentials: vi.fn(), on: vi.fn() }
  return g.supabase
}

describe('isGoogleConnected — estado da conexão com o Google', () => {
  beforeEach(() => setup())

  it('deve devolver conectado com o e-mail quando existe token para a workspace', async () => {
    expect(await isGoogleConnected('w1')).toEqual({ connected: true, email: 'medico@clinica.com' })
  })

  it('deve devolver desconectado quando não há token', async () => {
    setup({ google_tokens: { select: { data: null } } })
    expect(await isGoogleConnected('w1')).toEqual({ connected: false, email: null })
  })
})

describe('getAuthenticatedClient — credenciais do Google', () => {
  beforeEach(() => setup())

  it('deve descriptografar os tokens antes de usá-los', async () => {
    await getAuthenticatedClient('w1')

    expect(g.oauthClient.setCredentials).toHaveBeenCalledWith({
      access_token: 'access-123',
      refresh_token: 'refresh-456',
      expiry_date: new Date(TOKEN_ROW.token_expiry).getTime(),
    })
  })

  it('deve registrar o listener que persiste o token renovado', async () => {
    await getAuthenticatedClient('w1')
    expect(g.oauthClient.on).toHaveBeenCalledWith('tokens', expect.any(Function))
  })

  it('deve lançar quando a workspace não tem o calendário conectado', async () => {
    setup({ google_tokens: { select: { data: null, error: { message: 'no rows' } } } })
    await expect(getAuthenticatedClient('w1')).rejects.toThrow(/não conectado para esta workspace/)
  })
})

describe('listEvents — leitura da agenda real', () => {
  beforeEach(() => setup())

  it('deve pedir os eventos do intervalo já expandidos em ocorrências únicas', async () => {
    const from = new Date('2025-09-15T00:00:00-03:00')
    const to = new Date('2025-09-15T23:59:59-03:00')
    await listEvents('w1', from, to)

    expect(g.events.list).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: 'primary',
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        singleEvents: true,
      })
    )
  })

  it('deve devolver lista vazia quando o Google não retorna items', async () => {
    g.events.list = vi.fn(async () => ({ data: {} }))
    await expect(listEvents('w1', new Date(), new Date())).resolves.toEqual([])
  })
})

describe('createEvent — evento criado pela MedScale', () => {
  beforeEach(() => setup())

  const params = {
    workspaceId: 'w1',
    patientName: 'João Silva',
    patientPhone: '5511988887777',
    appointmentType: 'consulta',
    startTime: new Date('2025-09-15T13:00:00.000Z'),
    durationMin: 30,
    workspaceName: 'Clínica Teste',
    doctorEmail: 'medico@clinica.com',
  }

  it('deve marcar o evento como medscale para o reconcile reconhecê-lo depois', async () => {
    await createEvent(params)

    const body = (g.events.insert.mock.calls[0] as unknown as [{ requestBody: Record<string, never> }])[0].requestBody
    expect(body.extendedProperties).toEqual({
      private: { medscale: 'true', patientPhone: '5511988887777' },
    })
  })

  it('deve montar o título e a descrição no formato que o reconcile sabe ler', async () => {
    await createEvent(params)

    const body = (g.events.insert.mock.calls[0] as unknown as [{ requestBody: Record<string, string> }])[0].requestBody
    expect(body.summary).toBe('consulta — João Silva')
    expect(body.description).toContain('Paciente: João Silva')
    expect(body.description).toContain('Telefone: 5511988887777')
  })

  it('deve calcular o fim do evento a partir da duração', async () => {
    await createEvent(params)

    const body = (
      g.events.insert.mock.calls[0] as unknown as [{ requestBody: { start: { dateTime: string }; end: { dateTime: string } } }]
    )[0].requestBody
    expect(body.start.dateTime).toBe('2025-09-15T13:00:00.000Z')
    expect(body.end.dateTime).toBe('2025-09-15T13:30:00.000Z')
  })

  it('não deve enviar convite quando o paciente não tem e-mail', async () => {
    await createEvent(params)

    expect(g.events.insert).toHaveBeenCalledWith(expect.objectContaining({ sendUpdates: 'none' }))
  })

  it('deve convidar o paciente quando ele tem e-mail', async () => {
    await createEvent({ ...params, patientEmail: 'joao@example.com' })

    expect(g.events.insert).toHaveBeenCalledWith(expect.objectContaining({ sendUpdates: 'all' }))
    const body = (
      g.events.insert.mock.calls[0] as unknown as [{ requestBody: { attendees: Array<{ email: string }> } }]
    )[0].requestBody
    expect(body.attendees.map((a) => a.email)).toEqual(['medico@clinica.com', 'joao@example.com'])
  })
})

describe('cancelEvent / updateEvent — alterações no Google', () => {
  beforeEach(() => setup())

  it('deve marcar o evento como cancelled avisando os participantes', async () => {
    await cancelEvent('w1', 'gcal-1')

    expect(g.events.patch).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'gcal-1', sendUpdates: 'all', requestBody: { status: 'cancelled' } })
    )
  })

  it('deve remarcar o evento recalculando o horário de término', async () => {
    await updateEvent('w1', 'gcal-1', { startTime: new Date('2025-09-15T18:00:00.000Z'), durationMin: 60 })

    const body = (
      g.events.patch.mock.calls[0] as unknown as [{ requestBody: { start: { dateTime: string }; end: { dateTime: string } } }]
    )[0].requestBody
    expect(body.start.dateTime).toBe('2025-09-15T18:00:00.000Z')
    expect(body.end.dateTime).toBe('2025-09-15T19:00:00.000Z')
  })
})
