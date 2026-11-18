// O Whisper não devolve vazio quando recebe silêncio: ele "alucina" frases de
// fim de vídeo que aprendeu com legendas do YouTube. Em pt-BR a clássica é
// "Legendas pela comunidade Amara.org", repetida uma vez a cada ~30s mudos.
// Em 17/11/2026 o microfone de um médico ficou mudo no 5º minuto e o resto da
// consulta virou 49 cópias dessa frase, que foram parar no prontuário.
//
// Aqui essas frases saem do texto e cada trecho contínuo delas vira um único
// SILENT_GAP_MARKER, para o médico (e o gerador do SOAP) saberem que ali houve
// gravação sem som. Lista conservadora de propósito: só frases que nunca são
// ditas numa consulta.

export const SILENT_GAP_MARKER = '[trecho sem áudio]'

const HALLUCINATIONS: RegExp[] = [
  /(?:legendas?|sous-titres|subt[ií]tulos|subtitles)[^.!?\n]{0,60}?amara\.org[.!]?/gi,
  /amara\.org[.!]?/gi,
  /inscreva-se\s+no\s+(?:meu\s+|nosso\s+)?canal[^.!?\n]{0,40}[.!]?/gi,
  /obrigad[oa]\s+por\s+assistir[^.!?\n]{0,20}[.!]?/gi,
]

const SENTINEL = '\u0000'

export type CleanedTranscript = {
  text: string
  removedCount: number
  hasSilentGap: boolean
  hasSpeech: boolean
}

export function cleanTranscript(raw: string): CleanedTranscript {
  let removedCount = 0
  let text = raw
  for (const pattern of HALLUCINATIONS) {
    text = text.replace(pattern, () => {
      removedCount++
      return SENTINEL
    })
  }

  // Sequência de frases alucinadas (com espaço ou pontuação solta entre elas)
  // = um único trecho mudo.
  text = text.replace(new RegExp(`${SENTINEL}(?:[\\s.,!?]*${SENTINEL})*`, 'g'), ` ${SILENT_GAP_MARKER} `)
  text = text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()

  const withoutMarkers = text.split(SILENT_GAP_MARKER).join('')
  return {
    text,
    removedCount,
    hasSilentGap: removedCount > 0,
    hasSpeech: /\p{L}/u.test(withoutMarkers),
  }
}

// Código gravado em error_message quando a gravação inteira veio muda — lido
// por transcriptionErrorMessage (lib/friendly-errors.ts).
export const NO_SPEECH_ERROR = 'NO_SPEECH: nenhuma fala captada na gravação'
