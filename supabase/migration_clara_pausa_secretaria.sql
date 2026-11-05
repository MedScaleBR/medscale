-- Pausa temporária da Clara numa conversa.
-- No modo coexistência, quando a secretária responde o paciente pelo app do
-- WhatsApp Business no celular, a Meta avisa o webhook (smb_message_echoes).
-- A Clara fica em silêncio naquela conversa até bot_paused_until; cada nova
-- resposta da secretária empurra o prazo. Diferente de bot_paused, que só a
-- equipe desliga. Idempotente.

alter table public.conversations add column if not exists bot_paused_until timestamptz;
