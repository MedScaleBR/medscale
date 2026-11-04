-- Expediente quinzenal (e a cada N semanas) por unidade.
--
-- availability_rules ganha a repetição: interval_weeks (1 = toda semana, como
-- hoje; 2 a 4 = a cada N semanas) e anchor_date (um dia em que o médico atende
-- por essa regra, obrigatório quando interval_weeks > 1). As regras existentes
-- ficam com interval_weeks = 1 e anchor_date nulo: nada muda para quem já usa.
--
-- A checagem "anchor_date cai no mesmo dia da semana da regra" fica na API
-- (lib/scheduling/recurrence.ts). day_of_week usa 0=domingo … 6=sábado.
-- As policies atuais de availability_rules cobrem as colunas novas.
--
-- Rodar avulso no SQL Editor do Supabase. Idempotente. Aplicar ANTES do deploy.

alter table public.availability_rules
  add column if not exists interval_weeks smallint not null default 1,
  add column if not exists anchor_date date;

alter table public.availability_rules drop constraint if exists availability_rules_interval_weeks_check;
alter table public.availability_rules add constraint availability_rules_interval_weeks_check
  check (interval_weeks between 1 and 4);

alter table public.availability_rules drop constraint if exists availability_rules_anchor_required;
alter table public.availability_rules add constraint availability_rules_anchor_required
  check (interval_weeks = 1 or anchor_date is not null);
