-- MedScale — dados mock (2 accounts fictícios com 25 pacientes cada).
-- Diferente de seed.sql, não depende de nenhum auth.users existente —
-- roda sozinho no SQL Editor do Supabase, a qualquer momento, depois do schema.sql.
--
-- Serve também para comprovar o ON DELETE CASCADE de accounts -> patients
-- (declarado em patients.account_id, schema.sql): apagar um account remove
-- automaticamente todos os pacientes vinculados a ele.
--
-- Para limpar os dados mock (cascata cuida do resto):
-- delete from public.accounts where slug in ('mock-clinica-aurora', 'mock-clinica-bem-estar');
--
-- NOTA: as duas accounts também têm, hoje, uma workspace, bot_config,
-- expediente (availability_rules/handoff_hours), consultas, receita,
-- campanhas de tráfego, lista de espera e conversas do bot — pra parecerem
-- clínicas em uso real. Isso foi montado direto no banco (não reproduzido
-- aqui) porque appointments/availability_rules/waitlist exigem um
-- doctor_id que referencia auth.users, o que quebraria a premissa deste
-- arquivo de não depender de nenhum usuário específico.

do $$
declare
  v_account1_id uuid;
  v_account2_id uuid;
  first_names text[] := array[
    'Ana','Bruno','Carla','Diego','Elaine','Fabio','Gabriela','Hugo','Isabela','Joao',
    'Karina','Lucas','Mariana','Nicolas','Otavio','Patricia','Rafael','Sabrina','Thiago','Vanessa',
    'William','Yasmin','Bruna','Caio','Debora'
  ];
  last_names text[] := array[
    'Silva','Souza','Oliveira','Santos','Pereira','Costa','Rodrigues','Almeida','Nascimento','Lima',
    'Araujo','Fernandes','Carvalho','Gomes','Martins','Rocha','Ribeiro','Alves','Monteiro','Mendes',
    'Barros','Freitas','Barbosa','Pinto','Moreira'
  ];
  v_full_name text;
  i int;
begin
  -- Accounts ---------------------------------------------------------------
  insert into public.accounts
    (name, slug, plan, modules, max_workspaces, max_members, billing_email)
  values
    ('Mock Clínica Aurora', 'mock-clinica-aurora', 'avancado',
     '{dashboard,agenda,patients,settings}', 2, 5, 'financeiro@mockaurora.example.com')
  returning id into v_account1_id;

  insert into public.accounts
    (name, slug, plan, modules, max_workspaces, max_members, billing_email)
  values
    ('Mock Clínica Bem-Estar', 'mock-clinica-bem-estar', 'essencial',
     '{dashboard,agenda,patients,settings}', 1, 3, 'financeiro@mockbemestar.example.com')
  returning id into v_account2_id;

  -- Workspace padrão de cada account — sem isso, resolveActiveSession()
  -- (lib/session/server.ts) não libera dashboard para quem for atribuído
  -- a essas accounts: exige ao menos uma workspace ativa.
  insert into public.workspaces (account_id, name, slug, city, state, is_active, is_default)
  values (v_account1_id, 'Unidade Principal', 'unidade-principal', 'São Paulo', 'SP', true, true);

  insert into public.workspaces (account_id, name, slug, city, state, is_active, is_default)
  values (v_account2_id, 'Unidade Principal', 'unidade-principal', 'Rio de Janeiro', 'RJ', true, true);

  -- 25 pacientes para o account 1 -------------------------------------------
  for i in 1..25 loop
    v_full_name := first_names[i] || ' ' || last_names[i];
    insert into public.patients (account_id, full_name, phone, email, birth_date, tags)
    values (
      v_account1_id,
      v_full_name,
      '+55119' || lpad(i::text, 8, '0'),
      lower(first_names[i]) || '.' || lower(last_names[i]) || '@example.com',
      make_date(1955 + (i * 3) % 45, 1 + (i % 12), 1 + (i * 3) % 28),
      case when i % 5 = 0 then '{VIP}'::text[] else '{}'::text[] end
    );
  end loop;

  -- 25 pacientes para o account 2 (pareamento invertido para variar os nomes) --
  for i in 1..25 loop
    v_full_name := first_names[i] || ' ' || last_names[26 - i];
    insert into public.patients (account_id, full_name, phone, email, birth_date, tags)
    values (
      v_account2_id,
      v_full_name,
      '+55219' || lpad(i::text, 8, '0'),
      lower(first_names[i]) || '.' || lower(last_names[26 - i]) || '@example.com',
      make_date(1960 + (i * 2) % 40, 1 + (i % 12), 1 + (i * 5) % 28),
      case when i % 5 = 0 then '{VIP}'::text[] else '{}'::text[] end
    );
  end loop;

  raise notice 'Mock concluído. account1 = % (25 pacientes), account2 = % (25 pacientes)', v_account1_id, v_account2_id;
end $$;
