import { describe, it, expect } from 'vitest'
import {
  echoTimeFromPause,
  isAutoReply,
  isBotPaused,
  parseBusinessEcho,
  parseMetaTimestamp,
  secretaryPauseUntil,
  SECRETARY_PAUSE_HOURS,
} from '@/lib/bot/pause'

describe('isAutoReply — saudação automática do app', () => {
  const patientAt = new Date('2026-11-06T12:20:28Z')
  const after = (ms: number) => new Date(patientAt.getTime() + ms)

  it('echo menos de 1s depois do paciente é automático (caso real)', () => {
    expect(isAutoReply(after(645), patientAt)).toBe(true)
  })

  it('echo 10s depois ainda é automático; 11s já é a secretária', () => {
    expect(isAutoReply(after(10_000), patientAt)).toBe(true)
    expect(isAutoReply(after(11_000), patientAt)).toBe(false)
  })

  it('echo antes da mensagem do paciente é a secretária (paciente respondendo a ela)', () => {
    expect(isAutoReply(after(-5_000), patientAt)).toBe(false)
  })

  it('tolera o arredondamento em segundos da Meta', () => {
    expect(isAutoReply(after(-900), patientAt)).toBe(true)
  })
})

describe('echoTimeFromPause', () => {
  it('desfaz o prazo de secretaryPauseUntil', () => {
    const at = new Date('2026-11-06T12:20:28.844Z')
    expect(echoTimeFromPause(secretaryPauseUntil(at)).getTime()).toBe(at.getTime())
  })
})

describe('parseMetaTimestamp', () => {
  it('segundos Unix em string', () => {
    expect(parseMetaTimestamp('1762431628')?.toISOString()).toBe('2025-11-06T12:20:28.000Z')
  })

  it('vazio ou inválido vira null', () => {
    expect(parseMetaTimestamp(undefined)).toBeNull()
    expect(parseMetaTimestamp('abc')).toBeNull()
  })
})

const NOW = new Date('2026-11-05T12:00:00Z')

describe('isBotPaused', () => {
  it('bot_paused sempre pausa, com ou sem prazo', () => {
    expect(isBotPaused({ bot_paused: true, bot_paused_until: null }, NOW)).toBe(true)
  })

  it('pausa temporária vale até o prazo', () => {
    expect(isBotPaused({ bot_paused: false, bot_paused_until: '2026-11-05T13:00:00Z' }, NOW)).toBe(true)
  })

  it('pausa temporária vencida não pausa', () => {
    expect(isBotPaused({ bot_paused: false, bot_paused_until: '2026-11-05T11:59:59Z' }, NOW)).toBe(false)
  })

  it('sem nenhuma pausa', () => {
    expect(isBotPaused({ bot_paused: false }, NOW)).toBe(false)
  })
})

describe('secretaryPauseUntil', () => {
  it(`soma ${SECRETARY_PAUSE_HOURS} horas`, () => {
    const until = new Date(secretaryPauseUntil(NOW)).getTime()
    expect(until - NOW.getTime()).toBe(SECRETARY_PAUSE_HOURS * 60 * 60 * 1000)
  })
})

describe('parseBusinessEcho', () => {
  it('texto: telefone do paciente vem do campo to', () => {
    expect(
      parseBusinessEcho({ from: '557130000000', to: '5571999990000', id: 'wamid.1', type: 'text', text: { body: 'Oi, aqui é a Carla' } })
    ).toEqual({ patientPhone: '5571999990000', whatsappMessageId: 'wamid.1', content: 'Oi, aqui é a Carla' })
  })

  it('tira o + do telefone', () => {
    expect(parseBusinessEcho({ to: '+5571999990000', id: 'w', type: 'text', text: { body: 'x' } })?.patientPhone).toBe('5571999990000')
  })

  it('imagem vira um rótulo com a legenda', () => {
    expect(
      parseBusinessEcho({ to: '5571999990000', id: 'w', type: 'image', image: { id: 'm1', caption: 'Seu pedido' } })?.content
    ).toBe('[Imagem enviada pelo celular] Seu pedido')
  })

  it('apagar mensagem pausa, mas não grava nada', () => {
    expect(
      parseBusinessEcho({ to: '5571999990000', id: 'w', type: 'revoke', revoke: { original_message_id: 'x' } })
    ).toEqual({ patientPhone: '5571999990000', whatsappMessageId: 'w', content: null })
  })

  it('sem destinatário é descartado', () => {
    expect(parseBusinessEcho({ id: 'w', type: 'text', text: { body: 'x' } })).toBeNull()
    expect(parseBusinessEcho(null)).toBeNull()
  })
})
