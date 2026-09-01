-- Migração incremental: Categorias e subcategorias do financeiro (Bloco A)
-- Rode isto no SQL Editor do Supabase — NÃO rode supabase/schema.sql inteiro,
-- pois aquele arquivo é "drop and recreate" e apagaria todos os dados.
-- Este arquivo só ADICIONA. O conteúdo também já foi incorporado em
-- supabase/schema.sql, que segue sendo a fonte de verdade para reconstruções.

create table public.finance_categories (
  id           uuid default uuid_generate_v4() primary key,
  account_id   uuid references public.accounts(id) on delete cascade not null,
  kind         text not null check (kind in ('pf','pj')),
  -- null = categoria-raiz; preenchido = subcategoria. Profundidade máxima 2
  -- (garantida por trg_enforce_finance_category_depth).
  parent_id    uuid references public.finance_categories(id) on delete cascade,
  name         text not null,
  sort_order   int not null default 0,
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Normalização compartilhada com lib/finance/default-categories.ts
-- (normalizeCategoryName). Determinística/immutable para poder entrar no
-- índice único abaixo. translate() em vez de unaccent para não depender de
-- extensão. Definida antes do índice único que a referencia.
create or replace function public.normalize_category_name(p_name text)
returns text language sql immutable as $$
  select regexp_replace(
    lower(translate(btrim(coalesce(p_name, '')),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')),
    '\s+', ' ', 'g')
$$;

create index idx_finance_categories_tree
  on public.finance_categories(account_id, kind, parent_id, sort_order);

-- Impede duas irmãs de mesmo nome (case/acento-insensitive); permite mesmo
-- nome em ramos diferentes. Coalesce porque NULL em unique é sempre distinto.
create unique index idx_finance_categories_unique_sibling
  on public.finance_categories(
    account_id, kind,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    public.normalize_category_name(name)
  );

alter table public.finance_categories enable row level security;

create policy "finance_categories: owner only" on public.finance_categories
  for all using (public.is_account_owner(account_id));

grant all on public.finance_categories to authenticated, service_role;

-- Profundidade 2 + coerência account/kind do parent.
create or replace function public.enforce_finance_category_depth()
returns trigger language plpgsql as $$
declare v_parent record;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'finance_categories: categoria não pode ser pai de si mesma';
    end if;
    select account_id, kind, parent_id into v_parent
      from public.finance_categories where id = new.parent_id;
    if not found then
      raise exception 'finance_categories: parent_id % inexistente', new.parent_id;
    end if;
    if v_parent.parent_id is not null then
      raise exception 'finance_categories: profundidade máxima é 2 níveis';
    end if;
    if v_parent.account_id <> new.account_id or v_parent.kind <> new.kind then
      raise exception 'finance_categories: parent_id de outra conta ou kind';
    end if;
    if exists (select 1 from public.finance_categories where parent_id = new.id) then
      raise exception 'finance_categories: categoria com subcategorias não pode virar subcategoria';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_enforce_finance_category_depth
  before insert or update on public.finance_categories
  for each row execute procedure public.enforce_finance_category_depth();

alter table public.finance_entries
  add column category_id    uuid references public.finance_categories(id) on delete set null,
  add column subcategory_id uuid references public.finance_categories(id) on delete set null;

create index idx_finance_entries_category
  on public.finance_entries(account_id, category_id, entry_date desc);

-- subcategory_id tem que ser filha de category_id; kind da categoria = type.
create or replace function public.enforce_finance_entry_category()
returns trigger language plpgsql as $$
declare v_cat record; v_sub_parent uuid;
begin
  if new.category_id is not null then
    select kind, parent_id into v_cat
      from public.finance_categories where id = new.category_id;
    if not found then raise exception 'finance_entries: category_id inexistente'; end if;
    if v_cat.kind <> new.type then
      raise exception 'finance_entries: kind da categoria difere do type do lançamento';
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

create trigger trg_enforce_finance_entry_category
  before insert or update on public.finance_entries
  for each row execute procedure public.enforce_finance_entry_category();

-- Provisionamento lazy e idempotente das categorias de uma conta. Chamada no
-- primeiro carregamento de /finance e no agente do WhatsApp. Roda numa única
-- transação (função); advisory lock evita corrida entre dois carregamentos.
-- p_tree: { "pf": [{ "name": "...", "children": ["..."] }, ...], "pj": [...] }
create or replace function public.provision_finance_categories(p_account_id uuid, p_tree jsonb)
returns void language plpgsql as $$
declare
  v_kind        text;
  v_cat         jsonb;
  v_sub         text;
  v_root_id     uuid;
  v_order       int;
  v_suborder    int;
  v_existing    text;
  v_existing_kd text;
begin
  perform pg_advisory_xact_lock(hashtext(p_account_id::text));

  if exists (select 1 from public.finance_categories where account_id = p_account_id) then
    return; -- já provisionada
  end if;

  -- 1. árvore curada
  foreach v_kind in array array['pf','pj'] loop
    v_order := 0;
    for v_cat in select jsonb_array_elements(p_tree -> v_kind) loop
      insert into public.finance_categories (account_id, kind, parent_id, name, sort_order)
      values (p_account_id, v_kind, null, v_cat ->> 'name', v_order)
      returning id into v_root_id;
      v_order := v_order + 1;
      v_suborder := 0;
      for v_sub in select jsonb_array_elements_text(coalesce(v_cat -> 'children', '[]'::jsonb)) loop
        insert into public.finance_categories (account_id, kind, parent_id, name, sort_order)
        values (p_account_id, v_kind, v_root_id, v_sub, v_suborder);
        v_suborder := v_suborder + 1;
      end loop;
    end loop;
  end loop;

  -- 2. derivar do histórico: category texto que não casa com nenhuma raiz
  for v_existing, v_existing_kd in
    select distinct btrim(fe.category), fe.type
    from public.finance_entries fe
    where fe.account_id = p_account_id
      and fe.category is not null and btrim(fe.category) <> ''
  loop
    if not exists (
      select 1 from public.finance_categories c
      where c.account_id = p_account_id and c.kind = v_existing_kd and c.parent_id is null
        and public.normalize_category_name(c.name) = public.normalize_category_name(v_existing)
    ) then
      insert into public.finance_categories (account_id, kind, parent_id, name, sort_order)
      values (
        p_account_id, v_existing_kd, null, v_existing,
        coalesce((select max(sort_order) + 1 from public.finance_categories
                  where account_id = p_account_id and kind = v_existing_kd and parent_id is null), 0)
      );
    end if;
  end loop;

  -- 3. backfill: category texto → category_id da raiz de mesmo kind
  update public.finance_entries fe
  set category_id = c.id
  from public.finance_categories c
  where fe.account_id = p_account_id
    and fe.category_id is null
    and fe.category is not null
    and c.account_id = p_account_id
    and c.parent_id is null
    and c.kind = fe.type
    and public.normalize_category_name(c.name) = public.normalize_category_name(fe.category);
end;
$$;

grant execute on function public.provision_finance_categories(uuid, jsonb) to authenticated, service_role;
grant execute on function public.normalize_category_name(text) to authenticated, service_role;
