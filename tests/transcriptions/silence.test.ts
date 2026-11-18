import { describe, it, expect } from 'vitest'
import { cleanTranscript, SILENT_GAP_MARKER } from '@/lib/transcriptions/silence'

describe('cleanTranscript', () => {
  it('não mexe em transcrição normal', () => {
    const raw = 'Bom dia, doutor. Estou com dor de cabeça há três dias.'
    expect(cleanTranscript(raw)).toEqual({
      text: raw,
      removedCount: 0,
      hasSilentGap: false,
      hasSpeech: true,
    })
  })

  it('troca uma sequência de "Amara.org" (caso real de 17/11) por um único marcador', () => {
    const raw =
      'Pode tomar o remédio de 8 em 8 horas. Legendas pela comunidade Amara.org Legendas pela comunidade Amara.org Legendas pela comunidade Amara.org'
    const result = cleanTranscript(raw)
    expect(result.text).toBe(`Pode tomar o remédio de 8 em 8 horas. ${SILENT_GAP_MARKER}`)
    expect(result.removedCount).toBe(3)
    expect(result.hasSilentGap).toBe(true)
    expect(result.hasSpeech).toBe(true)
  })

  it('marca cada trecho mudo separadamente quando há fala entre eles', () => {
    const raw = 'Oi. Legendas pela comunidade Amara.org. Voltei. Obrigado por assistir!'
    const result = cleanTranscript(raw)
    expect(result.text).toBe(`Oi. ${SILENT_GAP_MARKER} Voltei. ${SILENT_GAP_MARKER}`)
    expect(result.removedCount).toBe(2)
  })

  it('cobre as variantes em outras línguas e o "inscreva-se no canal"', () => {
    const raw =
      'Subtítulos realizados por la comunidad de Amara.org Sous-titres réalisés para la communauté d\'Amara.org Inscreva-se no canal!'
    const result = cleanTranscript(raw)
    expect(result.text).toBe(SILENT_GAP_MARKER)
    expect(result.removedCount).toBe(3)
  })

  it('gravação toda muda: sem fala', () => {
    const result = cleanTranscript('Legendas pela comunidade Amara.org\nLegendas pela comunidade Amara.org')
    expect(result.text).toBe(SILENT_GAP_MARKER)
    expect(result.hasSpeech).toBe(false)
  })

  it('texto vazio: sem fala e sem trecho mudo', () => {
    expect(cleanTranscript('   ')).toMatchObject({ hasSpeech: false, hasSilentGap: false })
  })

  it('não remove "legenda" ou "canal" em fala médica comum', () => {
    const raw = 'A legenda do exame diz normal. Fizemos tratamento de canal no mês passado.'
    expect(cleanTranscript(raw).text).toBe(raw)
  })
})
