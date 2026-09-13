-- Migração incremental: patrimônio no financeiro — reservas, investimentos,
-- projeções, metas e sugestões de gasto excessivo.
-- Rode isto no SQL Editor do Supabase — NÃO rode supabase/schema.sql inteiro,
-- pois aquele arquivo é "drop and recreate" e apagaria todos os dados.
-- Este arquivo só ADICIONA. O conteúdo também já foi incorporado em
-- supabase/schema.sql, que segue sendo a fonte de verdade para reconstruções.
--
-- Tudo aqui é exclusivo do owner do account, igual a finance_entries: dado
-- financeiro pessoal não é estendido a admin/member (ver is_account_owner).

-- ============================================================
-- 1. RESERVAS (dinheiro guardado, por caixinha nomeada)
-- ============================================================

create table public.finance_reserves (
  id          uuid default uuid_generate_v4() primary key,
  account_id  uuid references public.accounts(id) on delete cascade not null,
  -- Mesma divisão do resto do módulo: a caixinha é pessoal (pf) ou da
  -- clínica (pj). Default pf porque reserva é, na prática, patrimônio do médico.
  kind        text not null default 'pf' check (kind in ('pf','pj')),
  name        text not null,
  -- Arquivar em vez de apagar: o histórico de movimentos continua valendo
  -- para o saldo consolidado de meses passados.
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Impede duas caixinhas de mesmo nome no mesmo kind (case/acento-insensitive),
-- que tornaria o fuzzy match do agente do WhatsApp ambíguo. Arquivadas entram
-- no índice de propósito: reusar o nome de uma arquivada confundiria o
-- histórico tanto quanto duplicar uma ativa.
create unique index idx_finance_reserves_unique_name
  on public.finance_reserves(account_id, kind, public.normalize_category_name(name));

create index idx_finance_reserves_account
  on public.finance_reserves(account_id, kind, archived_at);

-- Movimento de uma reserva. amount é sempre positivo; o sinal está em `type`.
create table public.finance_reserve_movements (
  id          uuid default uuid_generate_v4() primary key,
  reserve_id  uuid references public.finance_reserves(id) on delete cascade not null,
  -- Duplicado da reserva de propósito: deixa a policy RLS ser
  -- is_account_owner(account_id) direto, sem subquery por linha. Coerência
  -- com a reserva garantida por trg_enforce_reserve_movement_account.
  account_id  uuid references public.accounts(id) on delete cascade not null,
  amount      numeric(12,2) not null check (amount > 0),
  type        text not null check (type in ('deposit','withdrawal')),
  -- De onde veio: tela ou agente do WhatsApp. Espelha o sentinela
  -- recorded_by_phone = 'web' de finance_entries.
  source      text not null default 'web' check (source in ('web','whatsapp')),
  note        text,
  -- date, não timestamptz: o módulo inteiro raciocina em dia (ver
  -- finance_entries.entry_date), o que evita bug de fuso em borda de mês.
  occurred_at date not null default current_date,
  created_at  timestamptz not null default now()
);

create index idx_finance_reserve_movements_reserve
  on public.finance_reserve_movements(reserve_id, occurred_at desc);
create index idx_finance_reserve_movements_account
  on public.finance_reserve_movements(account_id, occurred_at desc);

-- ============================================================
-- 2. INVESTIMENTOS
-- ============================================================

create table public.finance_investments (
  id              uuid default uuid_generate_v4() primary key,
  account_id      uuid references public.accounts(id) on delete cascade not null,
  kind            text not null default 'pf' check (kind in ('pf','pj')),
  name            text not null,
  type            text not null check (type in ('renda_fixa','renda_variavel','cripto','outro')),
  invested_amount numeric(12,2) not null check (invested_amount > 0),
  -- Valor atual INFORMADO pelo owner. O valor estimado por
  -- calculateInvestmentProjection nunca é gravado — é derivado na leitura,
  -- senão congelaria numa data e passaria a mentir no dia seguinte.
  current_value   numeric(12,2),
  -- Sem taxa (os três campos nulos) o rendimento não é calculado nem chutado:
  -- a tela mostra "dados insuficientes". Ver lib/finance/investments.ts.
  rate_type       text check (rate_type in ('fixed_annual','pct_cdi','ipca_plus')),
  rate_value      numeric(8,2),
  start_date      date not null default current_date,
  maturity_date   date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint finance_investments_maturity_after_start
    check (maturity_date is null or maturity_date >= start_date)
);

create index idx_finance_investments_account
  on public.finance_investments(account_id, kind, start_date desc);

-- ============================================================
-- 3. PROJEÇÕES (quanto se planeja gastar por categoria no mês)
-- ============================================================

-- category_id e subcategory_id apontam AMBOS para finance_categories: a
-- árvore é uma tabela só, auto-referenciada por parent_id (profundidade 2).
-- on delete cascade, e não set null como em finance_entries: um lançamento sem
-- categoria ainda é um gasto que aconteceu, mas uma projeção sem categoria não
-- significa nada.
create table public.finance_projections (
  id               uuid default uuid_generate_v4() primary key,
  account_id       uuid references public.accounts(id) on delete cascade not null,
  category_id      uuid references public.finance_categories(id) on delete cascade not null,
  subcategory_id   uuid references public.finance_categories(id) on delete cascade,
  -- Sempre o dia 1 do mês de referência, normalizado por
  -- trg_normalize_finance_projection_period.
  period_month     date not null,
  projected_amount numeric(12,2) not null check (projected_amount >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Índice único com coalesce em vez de `unique (...)` na tabela: NULL em
-- constraint unique é sempre distinto de NULL, então duas projeções da mesma
-- categoria sem subcategoria passariam. Mesmo truque de
-- idx_finance_categories_unique_sibling.
create unique index idx_finance_projections_unique
  on public.finance_projections(
    account_id, category_id,
    coalesce(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_month
  );

create index idx_finance_projections_period
  on public.finance_projections(account_id, period_month);

-- ============================================================
-- 4. METAS
-- ============================================================

create table public.finance_goals (
  id                 uuid default uuid_generate_v4() primary key,
  account_id         uuid references public.accounts(id) on delete cascade not null,
  kind               text not null default 'pf' check (kind in ('pf','pj')),
  name               text not null,
  -- manual = o owner dita o alvo. auto = o alvo sai das projeções de gasto e
  -- é RECALCULADO a cada leitura (lib/finance/goals.ts), nunca congelado aqui.
  mode               text not null check (mode in ('manual','auto')),
  target_amount      numeric(12,2) check (target_amount is null or target_amount > 0),
  target_date        date,
  -- Multiplicador da meta automática: quantos meses de despesa projetada o
  -- owner quer ter guardados. 1 = a fórmula literal (um mês de despesa);
  -- 6 = reserva de emergência clássica.
  months_of_expenses numeric(5,2) not null default 1 check (months_of_expenses > 0),
  -- null = a meta acompanha o patrimônio inteiro do kind (todas as reservas
  -- ativas + investimentos). Preenchido = acompanha só aquela caixinha.
  linked_reserve_id  uuid references public.finance_reserves(id) on delete set null,
  status             text not null default 'active' check (status in ('active','completed','archived')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Meta manual sem alvo não tem o que acompanhar; a automática deriva o dela.
  constraint finance_goals_manual_needs_target
    check (mode <> 'manual' or target_amount is not null)
);

create index idx_finance_goals_account
  on public.finance_goals(account_id, kind, status);

-- ============================================================
-- 5. SUGESTÕES (gasto excessivo em categoria não essencial)
-- ============================================================

-- Default true: toda categoria que já existe entra como essencial, para não
-- disparar alerta retroativo em categoria que o owner nunca revisou. A feature
-- só passa a valer nas que ele explicitamente desmarcar.
alter table public.finance_categories
  add column is_essential boolean not null default true;

-- Alerta descartado dentro do mês. Some só até o fim do period_month — no mês
-- seguinte, se o padrão se repetir, o alerta pode voltar.
create table public.finance_suggestion_dismissals (
  id             uuid default uuid_generate_v4() primary key,
  account_id     uuid references public.accounts(id) on delete cascade not null,
  category_id    uuid references public.finance_categories(id) on delete cascade not null,
  subcategory_id uuid references public.finance_categories(id) on delete cascade,
  period_month   date not null,
  dismissed_at   timestamptz not null default now()
);

create unique index idx_finance_dismissals_unique
  on public.finance_suggestion_dismissals(
    account_id, category_id,
    coalesce(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_month
  );

-- Tolerância por conta. Pode não existir linha: a leitura cai nos defaults do
-- TypeScript (DEFAULT_TOLERANCE), evitando um insert de provisionamento em
-- toda conta que nunca abriu a aba.
create table public.finance_suggestion_settings (
  account_id               uuid primary key references public.accounts(id) on delete cascade,
  projection_tolerance_pct numeric(5,2) not null default 0  check (projection_tolerance_pct >= 0),
  history_tolerance_pct    numeric(5,2) not null default 30 check (history_tolerance_pct >= 0),
  updated_at               timestamptz not null default now()
);

-- ============================================================
-- 6. TRIGGERS DE INTEGRIDADE
-- ============================================================

-- O movimento carrega account_id próprio (para a policy ser barata); esta
-- trigger garante que ele nunca divirja do account_id da reserva.
create or replace function public.enforce_reserve_movement_account()
returns trigger language plpgsql as $$
declare v_account uuid;
begin
  select account_id into v_account
    from public.finance_reserves where id = new.reserve_id;
  if not found then
    raise exception 'finance_reserve_movements: reserve_id % inexistente', new.reserve_id;
  end if;
  -- Preenche quando o insert omite, valida quando informa.
  if new.account_id is null then
    new.account_id := v_account;
  elsif new.account_id <> v_account then
    raise exception 'finance_reserve_movements: account_id diverge do da reserva';
  end if;
  return new;
end;
$$;

create trigger trg_enforce_reserve_movement_account
  before insert or update on public.finance_reserve_movements
  for each row execute procedure public.enforce_reserve_movement_account();

-- period_month sempre no dia 1: sem isso '2026-09-01' e '2026-09-15' seriam
-- dois períodos distintos e furariam o índice único.
create or replace function public.normalize_finance_projection_period()
returns trigger language plpgsql as $$
begin
  new.period_month := date_trunc('month', new.period_month)::date;
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_normalize_finance_projection_period
  before insert or update on public.finance_projections
  for each row execute procedure public.normalize_finance_projection_period();

-- Mesma normalização para o descarte, sem o updated_at (a tabela não tem).
create or replace function public.normalize_finance_dismissal_period()
returns trigger language plpgsql as $$
begin
  new.period_month := date_trunc('month', new.period_month)::date;
  return new;
end;
$$;

create trigger trg_normalize_finance_dismissal_period
  before insert or update on public.finance_suggestion_dismissals
  for each row execute procedure public.normalize_finance_dismissal_period();

-- Coerência categoria/subcategoria de projeção e descarte: a subcategoria tem
-- que ser filha da categoria, e ambas da mesma conta. Mesmo contrato de
-- trg_enforce_finance_entry_category, aplicado às duas tabelas novas que
-- referenciam a árvore.
create or replace function public.enforce_finance_category_ref()
returns trigger language plpgsql as $$
declare
  v_cat_account uuid;
  v_sub_parent  uuid;
begin
  select account_id into v_cat_account
    from public.finance_categories where id = new.category_id;
  if not found then
    raise exception '%: category_id inexistente', tg_table_name;
  end if;
  if v_cat_account <> new.account_id then
    raise exception '%: category_id de outra conta', tg_table_name;
  end if;
  if new.subcategory_id is not null then
    select parent_id into v_sub_parent
      from public.finance_categories where id = new.subcategory_id;
    if not found then
      raise exception '%: subcategory_id inexistente', tg_table_name;
    end if;
    if v_sub_parent is distinct from new.category_id then
      raise exception '%: subcategory_id não é filha de category_id', tg_table_name;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_enforce_finance_projection_category
  before insert or update on public.finance_projections
  for each row execute procedure public.enforce_finance_category_ref();

create trigger trg_enforce_finance_dismissal_category
  before insert or update on public.finance_suggestion_dismissals
  for each row execute procedure public.enforce_finance_category_ref();

-- ============================================================
-- 7. RLS — owner only, igual a finance_entries
-- ============================================================

alter table public.finance_reserves             enable row level security;
alter table public.finance_reserve_movements    enable row level security;
alter table public.finance_investments          enable row level security;
alter table public.finance_projections          enable row level security;
alter table public.finance_goals                enable row level security;
alter table public.finance_suggestion_dismissals enable row level security;
alter table public.finance_suggestion_settings  enable row level security;

create policy "finance_reserves: owner only" on public.finance_reserves
  for all using (public.is_account_owner(account_id));
create policy "finance_reserve_movements: owner only" on public.finance_reserve_movements
  for all using (public.is_account_owner(account_id));
create policy "finance_investments: owner only" on public.finance_investments
  for all using (public.is_account_owner(account_id));
create policy "finance_projections: owner only" on public.finance_projections
  for all using (public.is_account_owner(account_id));
create policy "finance_goals: owner only" on public.finance_goals
  for all using (public.is_account_owner(account_id));
create policy "finance_suggestion_dismissals: owner only" on public.finance_suggestion_dismissals
  for all using (public.is_account_owner(account_id));
create policy "finance_suggestion_settings: owner only" on public.finance_suggestion_settings
  for all using (public.is_account_owner(account_id));

grant all on public.finance_reserves              to authenticated, service_role;
grant all on public.finance_reserve_movements     to authenticated, service_role;
grant all on public.finance_investments           to authenticated, service_role;
grant all on public.finance_projections           to authenticated, service_role;
grant all on public.finance_goals                 to authenticated, service_role;
grant all on public.finance_suggestion_dismissals to authenticated, service_role;
grant all on public.finance_suggestion_settings   to authenticated, service_role;
