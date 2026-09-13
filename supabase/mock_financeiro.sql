-- MedScale — dados fictícios do financeiro, para testar a tela /finance.
--
-- Rode no SQL Editor do Supabase. Diferente de mock.sql, este arquivo NÃO cria
-- account nem paciente: ele povoa a SUA account, porque /finance é exclusivo do
-- owner e você precisa estar logado nela para ver a tela.
--
-- O que ele cria (12 meses, terminando no mês atual):
--   • finance_entries PF — despesas recorrentes por categoria/subcategoria,
--     receitas (pró-labore, aluguel, investimentos) e uma viagem que derruba
--     o saldo de um mês para negativo;
--   • finance_entries PJ — custos da clínica, repasses e um mês com compra de
--     equipamento (saldo negativo);
--   • revenue_entries pagas + os finance_entries espelho (revenue_entry_id
--     preenchido), que alimentam "Realizado vs. previsto";
--   • revenue_entries pendentes no mês atual, que alimentam "Previsto no ciclo";
--   • lançamentos sem categoria no mês atual, para o alerta âmbar e o filtro
--     "Sem categoria" da tabela.
--
-- ANTES DE RODAR:
--   1. migration_receita_financeiro.sql já aplicada (traz finance_entries.direction
--      e revenue_entry_id, que a tela toda usa);
--   2. abra /finance uma vez, logado como owner — essa visita provisiona a árvore
--      de categorias (lib/finance/provision.ts). O script para com uma mensagem
--      clara se a árvore ainda não existir.
--
-- As revenue_entries criadas aqui também aparecem em /receita e /ciclo-receita —
-- é de propósito: sem elas o card "Realizado vs. previsto" não teria de onde sair.
--
-- Não apaga nem reescreve nada existente. A única alteração fora das tabelas de
-- lançamento é ligar o módulo 'finance' na account (sem ele /finance
-- redireciona para /dashboard) — e só se ainda não estiver ligado.
--
-- PARA LIMPAR TUDO DEPOIS (nesta ordem):
--   delete from public.revenue_entries where notes       = 'mock:financeiro';
--   delete from public.finance_entries  where raw_message = 'mock:financeiro';
--
-- Rodar o arquivo duas vezes duplica os lançamentos — limpe antes de repetir.

do $$
declare
  -- ─── CONFIGURE AQUI ────────────────────────────────────────────────────
  -- E-mail do owner da account que vai receber os dados fictícios.
  v_owner_email  text := 'eduardobordev@gmail.com';
  -- Alternativa: preencha o slug da account e o e-mail acima é ignorado.
  v_account_slug text := null;
  -- ───────────────────────────────────────────────────────────────────────

  v_account_id  uuid;
  v_ws_a        uuid;   -- unidade principal (coluna "Unidade" na tabela PJ)
  v_ws_b        uuid;   -- segunda unidade, se houver
  v_cat_consultas uuid; -- raiz PJ de receita usada pelo espelho do ciclo
  v_month_start date := date_trunc('month', current_date)::date;
  -- Dia de hoje: o mês corrente é povoado por inteiro (para os cards terem o
  -- que comparar), mas as datas são comprimidas até hoje em vez de cairem no
  -- futuro.
  v_elapsed     int  := extract(day from current_date)::int;
  v_phone       text := '+5511988887777';
  v_tag         text := 'mock:financeiro';
  v_n_entries   int;
  v_n_revenue   int;
begin
  -- ── 1. Descobrir a account ────────────────────────────────────────────
  if v_account_slug is not null then
    select id into v_account_id from public.accounts where slug = v_account_slug;
    if v_account_id is null then
      raise exception 'Nenhuma account com slug %. Confira em: select slug, name from public.accounts;', v_account_slug;
    end if;
  else
    select m.account_id into v_account_id
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where lower(u.email) = lower(v_owner_email)
      and m.role = 'owner'
      and m.status = 'active'
    limit 1;
    if v_account_id is null then
      raise exception
        'Nenhuma account onde % seja owner ativo. Ajuste v_owner_email ou preencha v_account_slug.',
        v_owner_email;
    end if;
  end if;

  -- ── 2. Pré-requisitos da tela ─────────────────────────────────────────
  if not exists (select 1 from public.finance_categories where account_id = v_account_id) then
    raise exception
      'A árvore de categorias desta account ainda não foi provisionada. Abra /finance uma vez logado como owner e rode este arquivo de novo.';
  end if;

  select id into v_ws_a
  from public.workspaces
  where account_id = v_account_id and is_active
  order by is_default desc, display_order
  limit 1;
  if v_ws_a is null then
    raise exception 'A account não tem workspace ativa — revenue_entries exige uma.';
  end if;

  select id into v_ws_b
  from public.workspaces
  where account_id = v_account_id and is_active and id <> v_ws_a
  order by display_order
  limit 1;
  v_ws_b := coalesce(v_ws_b, v_ws_a);

  -- /finance redireciona para /dashboard sem o módulo ligado na account
  -- (lib/session/server.ts monta accountModules a partir de accounts.modules).
  if not exists (
    select 1 from public.accounts
    where id = v_account_id and 'finance' = any(modules)
  ) then
    update public.accounts
    set modules = array_append(modules, 'finance'), updated_at = now()
    where id = v_account_id;
    raise notice 'Módulo finance ligado na account %.', v_account_id;
  end if;

  -- Idempotente (retorna na hora se já houver categoria de receita): garante as
  -- raízes de direction 'in' mesmo numa account provisionada antes da migração
  -- de receita, senão as receitas abaixo entrariam todas sem categoria.
  perform public.ensure_finance_income_seed(v_account_id);

  select id into v_cat_consultas
  from public.finance_categories
  where account_id = v_account_id and kind = 'pj' and direction = 'in' and parent_id is null
    and public.normalize_category_name(name) = public.normalize_category_name('Consultas particulares')
  limit 1;

  -- ── 3. Lançamentos recorrentes: 12 meses × catálogo abaixo ────────────
  -- base/varia: valor fixo (aluguel, escola) ou oscilando ±14% por mês, para o
  -- gráfico de 12 meses não virar uma linha reta. A junção lateral casa o nome
  -- da categoria pela mesma normalização do app; categoria renomeada pelo owner
  -- simplesmente entra como texto solto, sem quebrar o insert.
  insert into public.finance_entries
    (account_id, workspace_id, recorded_by_phone, type, direction, description,
     amount, category, category_id, subcategory_id, raw_message, entry_date)
  select
    v_account_id,
    case when t.kind = 'pj'
         then case when (g.m + t.dia) % 3 = 0 then v_ws_b else v_ws_a end
         else null end,
    v_phone,
    t.kind,
    t.dir,
    t.descricao,
    case when t.varia
         then round(t.base * (0.86 + ((g.m * 13 + length(t.descricao) * 7 + t.dia) % 29) / 100.0), 2)
         else t.base end,
    t.cat,
    cat.id,
    sub.id,
    v_tag,
    (v_month_start - ((11 - g.m) * interval '1 month'))::date
      + (case when g.m = 11
              then greatest(1, ceil(t.dia * v_elapsed / 28.0)::int)
              else t.dia end) - 1
  from generate_series(0, 11) as g(m)
  cross join (values
    -- PF — despesas
    ('pf','out','Aluguel do apartamento',      'Moradia',          'Aluguel',                 3200.00, false,  5),
    ('pf','out','Condomínio',                  'Moradia',          'Condomínio',               780.00, false,  5),
    ('pf','out','Luz, água e gás',             'Moradia',          'Contas (luz/água/gás)',    438.00, true,  12),
    ('pf','out','Internet fibra',              'Moradia',          'Internet',                 149.00, false,  9),
    ('pf','out','Mercado do mês',              'Alimentação',      'Mercado',                 1180.00, true,   6),
    ('pf','out','Mercado — reposição',         'Alimentação',      'Mercado',                  640.00, true,  19),
    ('pf','out','Jantares fora',               'Alimentação',      'Restaurante',              520.00, true,  22),
    ('pf','out','Delivery',                    'Alimentação',      'Delivery',                 310.00, true,  15),
    ('pf','out','Combustível',                 'Transporte',       'Combustível',              540.00, true,   8),
    ('pf','out','Corridas de app',             'Transporte',       'App/Táxi',                 185.00, true,  18),
    ('pf','out','Plano de saúde da família',   'Saúde',            'Plano',                   1240.00, false, 10),
    ('pf','out','Farmácia',                    'Saúde',            'Farmácia',                 215.00, true,  14),
    ('pf','out','Mensalidade escolar',         'Filhos',           'Escola',                  2150.00, false,  7),
    ('pf','out','Natação das crianças',        'Filhos',           'Atividades',               320.00, false,  7),
    ('pf','out','Streaming',                   'Lazer',            'Streaming',                 89.00, false,  3),
    ('pf','out','Assinaturas diversas',        'Assinaturas',      null,                       126.00, true,   3),
    ('pf','out','Carnê-leão',                  'Impostos e taxas', null,                      1820.00, true,  20),
    -- PF — receitas
    ('pf','in', 'Pró-labore',                  'Salário / Pró-labore', null,                 22000.00, false,  5),
    ('pf','in', 'Aluguel da sala comercial',   'Aluguéis recebidos',   null,                  2400.00, false, 10),
    ('pf','in', 'Rendimento CDB',              'Investimentos',        null,                   610.00, true,  28),
    -- PJ — despesas
    ('pj','out','Aluguel da clínica',          'Aluguel',                 null,               6500.00, false,  5),
    ('pj','out','Folha da equipe',             'Salários e encargos',     null,              14200.00, true,   5),
    ('pj','out','Tráfego pago e social',       'Marketing',               null,               2400.00, true,  10),
    ('pj','out','Sistema de gestão',           'Software e assinaturas',  null,                890.00, false,  2),
    ('pj','out','Materiais e descartáveis',    'Materiais médicos',       null,               2380.00, true,  16),
    ('pj','out','Honorários contábeis',        'Contabilidade',           null,                950.00, false,  8),
    ('pj','out','Simples Nacional',            'Impostos',                null,               4380.00, true,  20),
    ('pj','out','Manutenção predial',          'Manutenção',              null,                620.00, true,  24),
    -- PJ — receitas lançadas na mão (sem vínculo com o ciclo de receita)
    ('pj','in', 'Repasse de convênios',        'Convênios',               null,              12800.00, true,  15),
    ('pj','in', 'Procedimentos estéticos',     'Procedimentos',           null,               8400.00, true,  21)
  ) as t(kind, dir, descricao, cat, sub, base, varia, dia)
  left join lateral (
    select c.id from public.finance_categories c
    where c.account_id = v_account_id
      and c.kind = t.kind and c.direction = t.dir and c.parent_id is null
      and public.normalize_category_name(c.name) = public.normalize_category_name(t.cat)
    limit 1
  ) cat on true
  left join lateral (
    select s.id from public.finance_categories s
    where s.parent_id = cat.id
      and public.normalize_category_name(s.name) = public.normalize_category_name(t.sub)
    limit 1
  ) sub on true;

  -- ── 4. Gastos pontuais que jogam o saldo do mês para o vermelho ───────
  -- Servem para conferir o valor em vermelho no card de saldo e a variação
  -- negativa nos cards de receitas/despesas ao navegar pelos meses.
  insert into public.finance_entries
    (account_id, workspace_id, recorded_by_phone, type, direction, description,
     amount, category, category_id, subcategory_id, raw_message, entry_date)
  select
    v_account_id,
    case when t.kind = 'pj' then v_ws_a else null end,
    v_phone, t.kind, 'out', t.descricao, t.valor, t.cat, cat.id, sub.id, v_tag,
    (v_month_start - (t.meses_atras * interval '1 month'))::date + t.dia - 1
  from (values
    ('pf', 'Viagem de férias em família', 'Lazer',       'Viagem', 18500.00, 4,  8),
    ('pf', 'Reforma do quarto',           'Moradia',      null,     4200.00, 9, 17),
    ('pj', 'Compra de equipamento novo',  'Equipamentos', null,    32000.00, 6, 12),
    ('pj', 'Rescisão de contrato',        'Salários e encargos', null, 9800.00, 2, 26)
  ) as t(kind, descricao, cat, sub, valor, meses_atras, dia)
  left join lateral (
    select c.id from public.finance_categories c
    where c.account_id = v_account_id
      and c.kind = t.kind and c.direction = 'out' and c.parent_id is null
      and public.normalize_category_name(c.name) = public.normalize_category_name(t.cat)
    limit 1
  ) cat on true
  left join lateral (
    select s.id from public.finance_categories s
    where s.parent_id = cat.id
      and public.normalize_category_name(s.name) = public.normalize_category_name(t.sub)
    limit 1
  ) sub on true;

  -- ── 5. Lançamentos sem categoria no mês atual ─────────────────────────
  -- category e category_id nulos: é isso que acende o alerta âmbar
  -- ("N lançamentos sem categoria") e o chip de filtro na tabela.
  insert into public.finance_entries
    (account_id, workspace_id, recorded_by_phone, type, direction, description,
     amount, category, category_id, subcategory_id, raw_message, entry_date)
  select
    v_account_id,
    case when t.kind = 'pj' then v_ws_a else null end,
    v_phone, t.kind, t.dir, t.descricao, t.valor, null, null, null, v_tag,
    v_month_start + greatest(0, least(t.dia, v_elapsed) - 1)
  from (values
    ('pf','out','Compra no cartão — não identificado',  430.00,  4),
    ('pf','out','Saque 24h',                            200.00,  7),
    ('pf','out','Pix enviado — sem descrição',          158.00,  9),
    ('pf','in', 'Transferência recebida',               950.00,  6),
    ('pj','out','Débito recorrente 3452',              1290.00,  5),
    ('pj','out','Boleto sem identificação',             680.00, 10)
  ) as t(kind, dir, descricao, valor, dia);

  -- ── 6. Ciclo de receita: consultas pagas + espelho no financeiro ──────
  -- 24 consultas por mês com payment_status 'paid'. O espelho (finance_entries
  -- com revenue_entry_id) é o que o app cria em lib/revenue/finance-mirror.ts
  -- quando o pagamento é confirmado; aqui ele é criado junto, pela CTE, para os
  -- dois lados ficarem coerentes. É a parte "Confirmado pelo ciclo" do card
  -- "Realizado vs. previsto".
  with base as (
    select
      m.m,
      c.i,
      (v_month_start - ((11 - m.m) * interval '1 month'))::date
        + (case when m.m = 11
                then greatest(1, ceil(c.i * v_elapsed / 24.0)::int)
                else 1 + ((c.i * 7) % 25) end) - 1 as dt,
      case when (m.m + c.i) % 3 = 0 then v_ws_b else v_ws_a end as ws,
      (420 + ((m.m * 7 + c.i * 11) % 11) * 45)::numeric(10,2) as valor,
      (array['Consulta clínica','Retorno','Avaliação inicial','Consulta + exame','Consulta particular'])
        [1 + ((m.m * 3 + c.i) % 5)] as proc
    from generate_series(0, 11) as m(m)
    cross join generate_series(1, 24) as c(i)
  ),
  pagas as (
    insert into public.revenue_entries
      (workspace_id, account_id, procedure_name, amount, status, payment_status,
       payment_method, installments, source, due_date, paid_at, notes, entry_date)
    select
      b.ws, v_account_id, b.proc, b.valor, 'confirmado', 'paid',
      (array['pix','cartao_credito','cartao_debito','dinheiro'])[1 + ((b.m + b.i) % 4)],
      1, 'manual',
      b.dt,
      (b.dt::timestamp + interval '15 hours') at time zone 'America/Sao_Paulo',
      v_tag,
      b.dt
    from base b
    returning id, workspace_id, amount, procedure_name, entry_date
  )
  insert into public.finance_entries
    (account_id, workspace_id, recorded_by_phone, type, direction, description,
     amount, category, category_id, subcategory_id, raw_message, entry_date,
     revenue_entry_id)
  select
    v_account_id, p.workspace_id, 'revenue-cycle', 'pj', 'in', p.procedure_name,
    p.amount, 'Consultas particulares', v_cat_consultas, null, v_tag, p.entry_date,
    p.id
  from pagas p;

  -- ── 7. Ciclo de receita: o que ainda não caiu ─────────────────────────
  -- Sem espelho no financeiro de propósito: 'pending'/'realized' ainda não são
  -- dinheiro em caixa. É daqui que saem "Previsto no ciclo" (card do topo) e a
  -- barra clara de "A confirmar" no card "Realizado vs. previsto".
  insert into public.revenue_entries
    (workspace_id, account_id, procedure_name, amount, status, payment_status,
     payment_method, installments, source, due_date, notes, entry_date)
  select
    case when p.i % 2 = 0 then v_ws_b else v_ws_a end,
    v_account_id,
    (array['Consulta particular','Retorno','Procedimento estético','Avaliação inicial'])[1 + (p.i % 4)],
    (480 + ((p.i * 13) % 8) * 60)::numeric(10,2),
    case when p.i <= 6 then 'previsto' else 'confirmado' end,
    case when p.i <= 6 then 'pending'  else 'realized'   end,
    null, 1, 'manual',
    v_month_start + 14 + p.i,
    v_tag,
    v_month_start + 14 + p.i
  from generate_series(1, 8) as p(i);

  select count(*) into v_n_entries from public.finance_entries
   where account_id = v_account_id and raw_message = v_tag;
  select count(*) into v_n_revenue from public.revenue_entries
   where account_id = v_account_id and notes = v_tag;

  raise notice 'Pronto: % lançamentos em finance_entries e % em revenue_entries, na account %.',
    v_n_entries, v_n_revenue, v_account_id;
end $$;
