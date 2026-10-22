import { describe, it, expect } from 'vitest'
import { appointmentEventStyle, PENDING_LEGEND_LABEL } from '@/components/agenda/event-style'

const PENDING_STYLE = {
  backgroundColor: '#fff7ed',
  color: '#9a3412',
  border: '1px dashed #f97316',
  borderRadius: 6,
}

describe('appointmentEventStyle', () => {
  it('pendente usa o estilo laranja tracejado em qualquer unidade e origem', () => {
    for (const source of ['bot', 'manual', 'importado'] as const) {
      for (const multiUnit of [true, false]) {
        const style = appointmentEventStyle(
          { status: 'pendente_confirmacao_externa', source, workspace_id: 'w1' },
          { multiUnit, unitColor: '#123456' }
        )
        expect(style).toEqual(PENDING_STYLE)
      }
    }
  })

  it('não pendente em multi-unidade usa a cor da unidade', () => {
    expect(
      appointmentEventStyle({ status: 'agendado', source: 'manual', workspace_id: 'w1' }, { multiUnit: true, unitColor: '#123456' })
    ).toEqual({ backgroundColor: '#123456', color: '#fff', border: 'none', borderRadius: 6, boxShadow: undefined })
  })

  it('não pendente numa unidade só: ciano para bot (com realce), navy para manual', () => {
    expect(
      appointmentEventStyle({ status: 'confirmado', source: 'bot', workspace_id: 'w1' }, { multiUnit: false, unitColor: '#123456' })
    ).toEqual({
      backgroundColor: 'var(--cyan)',
      color: '#fff',
      border: 'none',
      borderRadius: 6,
      boxShadow: 'inset 3px 0 0 rgba(255,255,255,0.7)',
    })
    expect(
      appointmentEventStyle({ status: 'confirmado', source: 'manual', workspace_id: null }, { multiUnit: false })
    ).toEqual({ backgroundColor: 'var(--navy)', color: '#fff', border: 'none', borderRadius: 6, boxShadow: undefined })
  })

  it('legenda do pendente', () => {
    expect(PENDING_LEGEND_LABEL).toBe('Aguardando clínica')
  })
})
