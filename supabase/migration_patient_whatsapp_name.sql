-- Nome do perfil do WhatsApp do paciente (contacts[].profile.name no webhook).
-- Fica separado de full_name de propósito: a Clara trata full_name = 'Paciente'
-- como "nome ainda não coletado" e pergunta o nome completo antes de agendar.
-- Gravar o apelido do WhatsApp em full_name faria ela pular essa pergunta.
-- O /bot mostra este nome enquanto não há nome real e oferece copiá-lo.
-- Idempotente.

alter table public.patients add column if not exists whatsapp_name text;
