import { describe, it, expect } from 'vitest'
import { attendsOn, closedDayMessage, formatWorkingDays, weekdayOf } from '@/lib/bot/working-days'

describe('dias de atendimento da unidade', () => {
  it('lê o dia da semana da data no fuso de São Paulo', () => {
    expect(weekdayOf('2026-10-29')).toBe(4) // quinta
    expect(weekdayOf('2026-11-01')).toBe(0) // domingo
  })

  it('atende só nos dias do expediente e nas datas avulsas', () => {
    const unit = { workingDays: [1, 2], extraDates: ['2026-10-31'] }
    expect(attendsOn(unit, '2026-11-02')).toBe(true) // segunda
    expect(attendsOn(unit, '2026-10-29')).toBe(false) // quinta
    expect(attendsOn(unit, '2026-10-31')).toBe(true) // sábado avulso
  })

  it('sem expediente cadastrado não bloqueia nada', () => {
    expect(attendsOn({}, '2026-10-29')).toBe(true)
    expect(attendsOn({ workingDays: [] }, '2026-10-29')).toBe(true)
  })

  it('escreve os dias em português', () => {
    expect(formatWorkingDays([1, 2])).toBe('segunda-feira e terça-feira')
    expect(formatWorkingDays([1, 3, 5])).toBe('segunda-feira, quarta-feira e sexta-feira')
    expect(closedDayMessage('Pituba', [1, 2])).toBe('A unidade Pituba atende só às segundas e terças. Qual desses dias fica melhor para você?')
  })
})
