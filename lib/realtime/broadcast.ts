// Emite um evento de Supabase Realtime Broadcast para um canal por workspace,
// via endpoint HTTP (fire-and-forget, sem abrir websocket no server). Usado
// para avisar a equipe, dentro do app, que uma conversa precisa de humano —
// o par in-app da notificação Web Push de `lib/push/send.ts`.
//
// O canal `handoff-toast:<workspaceId>` é público (broadcast puro, sem tocar
// no banco). O tópico carrega o UUID da workspace (não adivinhável) e o
// payload só leva nome do paciente + id da conversa — mesma sensibilidade da
// push. Nunca lança: qualquer falha é logada como `[realtime] ...` e engolida.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export function workspaceChannel(workspaceId: string): string {
  return `handoff-toast:${workspaceId}`
}

export async function broadcastToWorkspace(
  workspaceId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.warn('[realtime] SUPABASE_URL / SERVICE_ROLE_KEY ausentes — broadcast ignorado')
    return
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        messages: [{ topic: workspaceChannel(workspaceId), event, payload, private: false }],
      }),
    })
    if (!res.ok) {
      console.error('[realtime] broadcast falhou, status', res.status)
    }
  } catch (err) {
    console.error('[realtime] broadcast falhou', err)
  }
}
