import { createAdminClient } from '@/lib/supabase/server'
import { broadcastToWorkspace } from '@/lib/realtime/broadcast'

interface FailedTranscription {
  id: string
  workspace_id: string
  patient_id: string
  recorded_by: string
}

// Avisa só o médico que gravou a consulta (não o workspace todo) quando uma
// transcrição esgota as 3 tentativas automáticas e vira `status = 'error'`.
// Mesmo padrão do passo 5 de executeHandoff() (lib/bot/handoff.ts): push +
// toast in-app disparados em paralelo, fire-and-forget — nunca lança, só loga
// como `[transcriptions] ...`, para não derrubar a rota de processamento.
export async function notifyTranscriptionFailed(transcription: FailedTranscription): Promise<void> {
  try {
    const supabase = createAdminClient()

    const { data: patient } = await supabase
      .from('patients')
      .select('full_name')
      .eq('id', transcription.patient_id)
      .single()
    const patientName = patient?.full_name ?? 'Paciente'

    const { sendTranscriptionErrorPush } = await import('@/lib/push/send')

    await Promise.all([
      sendTranscriptionErrorPush(transcription.workspace_id, transcription.recorded_by, {
        title: '⚠️ Transcrição não processada',
        body: `A transcrição de ${patientName} falhou após várias tentativas`,
        url: `/transcricoes/${transcription.id}`,
      }),
      broadcastToWorkspace(transcription.workspace_id, 'transcription_error', {
        transcriptionId: transcription.id,
        patientName,
        recordedBy: transcription.recorded_by,
      }),
    ])
  } catch (err) {
    console.error('[transcriptions] notifyTranscriptionFailed falhou', err)
  }
}
