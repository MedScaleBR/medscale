-- Migração incremental: receita no financeiro (direction + espelho do ciclo).
-- Rode no SQL Editor do Supabase. NÃO rode supabase/schema.sql inteiro.
-- Só ADICIONA. O conteúdo também está em supabase/schema.sql (fonte de verdade).

-- 1. finance_categories.direction
alter table public.finance_categories
  add column if not exists direction text not null default 'out'
    check (direction in ('in','out'));

-- 2. finance_entries.direction + vínculo com o ciclo de receita
alter table public.finance_entries
  add column if not exists direction text not null default 'out'
    check (direction in ('in','out')),
  add column if not exists revenue_entry_id uuid unique
    references public.revenue_entries(id) on delete cascade;

-- 3. índices
drop index if exists public.idx_finance_categories_unique_sibling;
create unique index idx_finance_categories_unique_sibling
  on public.finance_categories(
    account_id, kind, direction,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    public.normalize_category_name(name)
  );

create index if not exists idx_finance_categories_tree_dir
  on public.finance_categories(account_id, kind, direction, parent_id, sort_order);

create index if not exists idx_finance_entries_direction
  on public.finance_entries(account_id, type, direction, entry_date desc);

-- 4. trigger: profundidade/coerência da árvore — pai tem que ter o mesmo direction
create or replace function public.enforce_finance_category_depth()
returns trigger language plpgsql as $$
declare v_parent record;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'finance_categories: categoria não pode ser pai de si mesma';
    end if;
    select account_id, kind, direction, parent_id into v_parent
      from public.finance_categories where id = new.parent_id;
    if not found then
      raise exception 'finance_categories: parent_id % inexistente', new.parent_id;
    end if;
    if v_parent.parent_id is not null then
      raise exception 'finance_categories: profundidade máxima é 2 níveis';
    end if;
    if v_parent.account_id <> new.account_id
       or v_parent.kind <> new.kind
       or v_parent.direction <> new.direction then
      raise exception 'finance_categories: parent_id de outra conta, kind ou direction';
    end if;
    if exists (select 1 from public.finance_categories where parent_id = new.id) then
      raise exception 'finance_categories: categoria com subcategorias não pode virar subcategoria';
    end if;
  end if;
  return new;
end;
$$;

-- 5. trigger: lançamento vs categoria — kind = type E direction = direction
create or replace function public.enforce_finance_entry_category()
returns trigger language plpgsql as $$
declare v_cat record; v_sub_parent uuid;
begin
  if new.category_id is not null then
    select kind, direction, parent_id into v_cat
      from public.finance_categories where id = new.category_id;
    if not found then raise exception 'finance_entries: category_id inexistente'; end if;
    if v_cat.kind <> new.type then
      raise exception 'finance_entries: kind da categoria difere do type do lançamento';
    end if;
    if v_cat.direction <> new.direction then
      raise exception 'finance_entries: direction da categoria difere do lançamento';
    end if;
  end if;
  if new.subcategory_id is not null then
    if new.category_id is null then
      raise exception 'finance_entries: subcategory_id sem category_id';
    end if;
    select parent_id into v_sub_parent
      from public.finance_categories where id = new.subcategory_id;
    if not found then raise exception 'finance_entries: subcategory_id inexistente'; end if;
    if v_sub_parent is distinct from new.category_id then
      raise exception 'finance_entries: subcategory_id não é filha de category_id';
    end if;
  end if;
  return new;
end;
$$;

-- 6. seed idempotente de categorias de receita (por conta)
create or replace function public.ensure_finance_income_seed(p_account_id uuid)
returns void language plpgsql as $$
declare v_name text; v_order int;
begin
  perform pg_advisory_xact_lock(hashtext('income-seed:' || p_account_id::text));
  if exists (select 1 from public.finance_categories
             where account_id = p_account_id and direction = 'in') then
    return;
  end if;
  v_order := 0;
  foreach v_name in array array[
    'Consultas particulares','Procedimentos','Convênios','Outras receitas'
  ] loop
    insert into public.finance_categories
      (account_id, kind, direction, parent_id, name, sort_order)
    values (p_account_id, 'pj', 'in', null, v_name, v_order);
    v_order := v_order + 1;
  end loop;
  v_order := 0;
  foreach v_name in array array[
    'Salário / Pró-labore','Aluguéis recebidos','Investimentos','Outras receitas'
  ] loop
    insert into public.finance_categories
      (account_id, kind, direction, parent_id, name, sort_order)
    values (p_account_id, 'pf', 'in', null, v_name, v_order);
    v_order := v_order + 1;
  end loop;
end;
$$;
grant execute on function public.ensure_finance_income_seed(uuid)
  to authenticated, service_role;

-- 7. semeia receita nas contas existentes (uma vez)
select public.ensure_finance_income_seed(id) from public.accounts;
