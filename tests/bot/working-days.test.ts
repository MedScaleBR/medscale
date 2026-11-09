import { describe, it, expect } from 'vitest'
import {
  attendsOn,
  bookingNotOpenMessage,
  closedDayMessage,
  formatWorkingDays,
  isBookingOpen,
  upcomingAttendanceDates,
  weekdayOf,
} from '@/lib/bot/working-days'

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

describe('agenda aberta até e dias bloqueados', () => {
  // Quinzenal às terças: 10/11/2026, 24/11, 08/12, 22/12...
  const rules = [{ day_of_week: 2, start_time: '08:00', end_time: '12:00', interval_weeks: 2, anchor_date: '2026-11-10' }]

  it('dia bloqueado não é dia de atendimento, nem se for data avulsa', () => {
    const unit = { workingDays: [1, 2], extraDates: ['2026-10-31'], blockedDates: ['2026-11-02', '2026-10-31'] }
    expect(attendsOn(unit, '2026-11-02')).toBe(false)
    expect(attendsOn(unit, '2026-10-31')).toBe(false)
    expect(attendsOn({ blockedDates: ['2026-11-02'] }, '2026-11-02')).toBe(false)
  })

  it('isBookingOpen: sem limite sempre; com limite, até o dia inclusive', () => {
    expect(isBookingOpen({}, '2027-01-10')).toBe(true)
    expect(isBookingOpen({ bookingOpenUntil: '2026-12-31' }, '2026-12-31')).toBe(true)
    expect(isBookingOpen({ bookingOpenUntil: '2026-12-31' }, '2027-01-01')).toBe(false)
  })

  it('próximas datas param na agenda aberta e pulam dias bloqueados', () => {
    const unit = { workingDays: [2], scheduleRules: rules, blockedDates: ['2026-11-24'], bookingOpenUntil: '2026-12-10' }
    expect(upcomingAttendanceDates(unit, '2026-11-09')).toEqual(['2026-11-10', '2026-12-08'])
  })

  it('mensagens de dia bloqueado e de agenda ainda não liberada', () => {
    const unit = { workingDays: [2], scheduleRules: rules, blockedDates: ['2026-11-24'], bookingOpenUntil: '2026-12-31' }
    expect(closedDayMessage('Pituba', [2], unit, '2026-11-09', '2026-11-24')).toBe(
      'Em 24/11 não haverá atendimento na unidade Pituba. As próximas datas com atendimento são ter 10/11, ter 08/12 e ter 22/12. Qual fica melhor para você?'
    )
    expect(bookingNotOpenMessage('Pituba', '2026-12-31', true)).toBe(
      'A agenda da unidade Pituba está aberta até 31/12. Depois disso ainda não foi liberada. Se quiser, coloco você na lista de espera e aviso assim que abrir.'
    )
  })
})
