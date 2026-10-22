import { describe, it, expect } from 'vitest'
import {
  requestedMessage, confirmedMessage, alreadyPendingMessage, REQUEST_FAILED_MESSAGE,
  missingDataMessage, formatDayLabel, formatTimeLabel,
} from '@/lib/outsourced/messages'

const at = new Date('2026-10-16T11:00:00.000Z') // 08:00 em SP

describe('mensagens fixas do agendamento terceirizado', () => {
  it('rótulos de dia e hora', () => {
    expect(formatDayLabel(at)).toBe('sexta-feira, 16/10')
    expect(formatTimeLabel(at)).toBe('08:00')
  })
  it('solicitação', () => {
    expect(requestedMessage({ scheduledAt: at, unitName: 'IAD Pituba' }))
      .toBe('Pronto, solicitei o horário de sexta-feira, 16/10 às 08:00 na IAD Pituba. Assim que a clínica confirmar eu te aviso aqui mesmo. 😊')
  })
  it('confirmação com e sem endereço', () => {
    expect(confirmedMessage({ scheduledAt: at, unitName: 'IAD Pituba', address: 'Rua A, 10, Salvador' }))
      .toBe('Sua consulta está confirmada! ✅ sexta-feira, 16/10 às 08:00 na IAD Pituba, Rua A, 10, Salvador.')
    expect(confirmedMessage({ scheduledAt: at, unitName: 'IAD Pituba', address: null }))
      .toBe('Sua consulta está confirmada! ✅ sexta-feira, 16/10 às 08:00 na IAD Pituba.')
  })
  it('já pendente e falha', () => {
    expect(alreadyPendingMessage('IAD Pituba'))
      .toBe('Você já tem uma solicitação de horário em andamento na IAD Pituba. Assim que a clínica confirmar eu te aviso aqui mesmo.')
    expect(REQUEST_FAILED_MESSAGE).toBe('Não consegui solicitar esse horário agora. A equipe vai te retornar por aqui em breve.')
  })
  it('dados faltando', () => {
    expect(missingDataMessage(['nascimento'], 'IAD Pituba')).toBe('Para solicitar o horário na IAD Pituba, preciso de sua data de nascimento. Pode me passar?')
    expect(missingDataMessage(['nome', 'nascimento', 'convenio'], 'IAD Pituba'))
      .toBe('Para solicitar o horário na IAD Pituba, preciso de seu nome completo, sua data de nascimento e seu convênio (ou se será particular). Pode me passar?')
  })
})
