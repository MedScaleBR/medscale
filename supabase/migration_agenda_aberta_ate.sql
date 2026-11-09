-- Agenda aberta até (por unidade).
--
-- workspaces.booking_open_until: último dia em que a Clara pode oferecer ou
-- marcar horário nesta unidade. Nulo = sem limite (como hoje). Serve para o
-- médico que ainda não montou a agenda do mês seguinte: a Clara não oferece
-- janeiro enquanto a clínica não liberar.
--
-- As policies atuais de workspaces cobrem a coluna nova (owner/admin editam).
--
-- Rodar avulso no SQL Editor do Supabase. Idempotente. Aplicar ANTES do deploy
-- (o código aguenta a coluna ausente, mas aí o limite não vale).

alter table public.workspaces
  add column if not exists booking_open_until date;
