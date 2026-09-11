// Payload do evento `transcription_error` que o server emite em
// notifyTranscriptionFailed (lib/transcriptions/notify-error.ts) e o
// TranscriptionErrorToastListener consome no client.
export interface TranscriptionErrorToastEvent {
  transcriptionId: string
  patientName?: string
  recordedBy: string
}

// Só o médico que gravou a consulta vê o toast — diferente do handoff (onde
// qualquer um da equipe pode atender), aqui só quem gravou tem ação a tomar.
export function shouldShowTranscriptionErrorToast(args: {
  currentUserId: string
  event: TranscriptionErrorToastEvent
}): boolean {
  return args.event.recordedBy === args.currentUserId
}
