-- MedScale — seed completo do sistema, para desenvolvimento e demo.
--
-- Diferente de seed.sql (que cria só o mínimo para o dashboard abrir), este
-- arquivo povoa TODOS os módulos do produto com dados fictícios coerentes entre
-- si: a consulta realizada vira entrada de receita, a receita paga vira
-- lançamento no financeiro, a conversa que pediu humano tem handoff_log, e por
-- aí vai.
--
-- Rode DEPOIS do schema.sql, no SQL Editor do Supabase.
--
-- COMO FUNCIONA O VÍNCULO COM O USUÁRIO
-- memberships, appointments.doctor_id, transcriptions.recorded_by etc. apontam
-- para auth.users, que é gerenciado pelo Supabase Auth — não dá para inventar um
-- usuário via SQL com segurança. Por isso o script usa a SUA conta já cadastrada
-- (cadastre-se em /registrar antes) como owner da clínica fictícia. Os "colegas
-- de equipe" entram como convites pendentes em public.invites, que é o mais
-- próximo de um segundo usuário sem mexer no Auth.
--
-- REEXECUÇÃO
-- O script apaga a account fictícia no começo e recria tudo — pode rodar quantas
-- vezes quiser. Só mexe na account de slug 'clinica-exemplo'.
--
-- PARA APAGAR SEM RECRIAR:
--   delete from public.transcriptions where account_id in
--     (select id from public.accounts where slug = 'clinica-exemplo');
--   delete from public.feedback where account_id in
--     (select id from public.accounts where slug = 'clinica-exemplo');
--   delete from public.accounts where slug = 'clinica-exemplo';
-- (transcriptions e feedback saem antes porque as FKs delas não cascateiam:
--  transcriptions.patient_id é 'on delete restrict' e feedback.account_id é
--  'on delete set null'.)
--
-- O QUE ESTE SEED NÃO CRIA, DE PROPÓSITO
--   • google_tokens — token falso faria o app tentar usar o Google Calendar com
--     credencial inválida; conecte pela tela de configurações.
--   • push_subscriptions — endpoint falso faz o envio de push falhar em loop.
--   • bot_config.meta_token / is_active = true — sem número real conectado,
--     marcar o bot como ativo deixaria /configuracoes/bot mentindo e esconderia
--     o wizard de conexão (mesma razão documentada no seed.sql).
--   • finance_sessions — estado efêmero da conversa do agente financeiro.
--   • arquivos no storage — os transcriptions.audio_path apontam para áudios que
--     não existem: a lista e o prontuário abrem, tocar o áudio não.

do $$
declare
  -- ─── CONFIGURE AQUI ────────────────────────────────────────────────────
  -- E-mail com que você se cadastrou em /registrar.
  v_email        text := 'eduardobordev@gmail.com';
  -- true = também te cadastra como admin da MedScale (libera o painel /admin).
  v_medscale_adm boolean := false;
  -- ───────────────────────────────────────────────────────────────────────

  v_slug        constant text := 'clinica-exemplo';
  v_user_id     uuid;
  v_old_id      uuid;
  v_account_id  uuid;
  v_ws_a        uuid;  -- Unidade Moema
  v_ws_b        uuid;  -- Unidade Santana
  v_conv        uuid;
  v_pat_ids     uuid[];
  v_n_pac       int;
  v_cat_consultas uuid;
  v_month_start date := date_trunc('month', current_date)::date;
  v_elapsed     int  := extract(day from current_date)::int;
  v_phone       text := '+5511988887777';
  v_n           int;
begin
  -- ══ 1. Usuário e limpeza do run anterior ═══════════════════════════════
  select id into v_user_id from auth.users where lower(email) = lower(v_email);
  if v_user_id is null then
    raise exception
      'Usuário % não encontrado em auth.users. Cadastre-se em /registrar e ajuste v_email no topo deste arquivo.',
      v_email;
  end if;

  select id into v_old_id from public.accounts where slug = v_slug;
  if v_old_id is not null then
    -- Estas duas não saem por cascata (ver cabeçalho).
    delete from public.transcriptions where account_id = v_old_id;
    delete from public.feedback        where account_id = v_old_id;
    delete from public.accounts        where id = v_old_id;
    raise notice 'Account fictícia anterior removida.';
  end if;

  -- ══ 2. Account, unidades, perfil e equipe ══════════════════════════════
  insert into public.accounts
    (name, slug, plan, modules, max_workspaces, max_members, billing_email, created_by)
  values
    ('Clínica Exemplo', v_slug, 'premium',
     -- Todos os módulos ligados (slugs em lib/nav/tabs.ts). dashboard, patients
     -- e settings são sempre-ativos, mas ficam explícitos para a tela de
     -- Configurações mostrar os toggles coerentes.
     '{dashboard,agenda,conversations,locations,schedule,waitlist,campaigns,patients,settings,transcriptions,finance,revenue_cycle}',
     4, 10, 'financeiro@clinicaexemplo.com.br', v_user_id)
  returning id into v_account_id;

  insert into public.workspaces
    (account_id, name, slug, address, city, state, zip_code, business_hours,
     directions_parking, contact_info, consultation_price_from, handoff_number,
     is_active, is_default, display_order)
  values
    (v_account_id, 'Unidade Moema', 'unidade-moema',
     'Av. Ibirapuera, 2033 — conj. 114', 'São Paulo', 'SP', '04029-100',
     'Seg a Sex, 8h às 19h · Sáb, 8h às 12h',
     'Estacionamento no subsolo, R$ 15 com validação na recepção.',
     'Telefone fixo (11) 5051-2020',
     350.00, '+5511955550101', true, true, 0)
  returning id into v_ws_a;

  insert into public.workspaces
    (account_id, name, slug, address, city, state, zip_code, business_hours,
     directions_parking, consultation_price_from, handoff_number,
     is_active, is_default, display_order)
  values
    (v_account_id, 'Unidade Santana', 'unidade-santana',
     'Rua Voluntários da Pátria, 1400 — sala 62', 'São Paulo', 'SP', '02010-100',
     'Seg, Qua e Sex, 9h às 18h',
     'Sem estacionamento próprio; conveniado na esquina.',
     290.00, '+5511955550102', true, false, 1)
  returning id into v_ws_b;

  -- O trigger on_auth_user_created já criou o profile no cadastro; aqui só
  -- completamos os campos que o formulário de registro não pede.
  insert into public.profiles (id, full_name, email, phone, crm, specialty, last_workspace_id)
  values (v_user_id, 'Dr. Eduardo Bordin', v_email, v_phone, 'CRM-SP 123456',
          'Clínica Geral', v_ws_a)
  on conflict (id) do update
    set crm               = excluded.crm,
        specialty         = excluded.specialty,
        last_workspace_id = excluded.last_workspace_id;

  insert into public.memberships (account_id, user_id, role, status, accepted_at)
  values (v_account_id, v_user_id, 'owner', 'active', now());

  -- Equipe "em convite": é o que dá para simular sem criar auth.users.
  insert into public.invites (account_id, email, role, invited_by, expires_at)
  values
    (v_account_id, 'recepcao@clinicaexemplo.com.br',   'member', v_user_id, now() + interval '5 days'),
    (v_account_id, 'dra.helena@clinicaexemplo.com.br', 'admin',  v_user_id, now() + interval '7 days'),
    -- Um já expirado, para a tela de equipe mostrar os dois estados.
    (v_account_id, 'antigo@clinicaexemplo.com.br',     'member', v_user_id, now() - interval '2 days');

  if v_medscale_adm then
    insert into public.medscale_admins (user_id) values (v_user_id)
    on conflict (user_id) do nothing;
    raise notice 'Usuário cadastrado como admin MedScale (painel /admin liberado).';
  end if;

  -- ══ 3. Clara: configuração e horário de handoff ════════════════════════
  insert into public.bot_config
    (account_id, specialty, procedures, insurance_plans, accepts_private,
     payment_methods, pricing_info, exam_preparation, policies, tone_of_voice,
     handoff_instructions, forbidden_actions, faq, welcome_message,
     handoff_message, out_of_hours_message, is_active, number_source,
     onboarding_step)
  values
    (v_account_id, 'Clínica Geral e Medicina Preventiva',
     '{Consulta,Retorno,Check-up executivo,Avaliação pré-operatória,Aplicação de vacina}',
     '{Unimed,Bradesco Saúde,SulAmérica,Particular}',
     true,
     '{Pix,Cartão de crédito,Cartão de débito,Dinheiro}',
     'Consulta particular a partir de R$ 350 na Moema e R$ 290 na Santana. Retorno em até 30 dias é sem custo.',
     'Exames de sangue: jejum de 8h. Ultrassom de abdome: jejum de 6h e bexiga cheia.',
     'Remarcação sem custo com 24h de antecedência. Falta sem aviso é cobrada como consulta.',
     'Acolhedora e objetiva. Trata o paciente por você, sem gírias e sem prometer diagnóstico.',
     'Chame a equipe quando o paciente pedir falar com humano, relatar urgência, ou reclamar de cobrança.',
     'Nunca dar diagnóstico, sugerir medicação, ou opinar sobre resultado de exame.',
     '[{"question":"Vocês atendem convênio?","answer":"Atendemos Unimed, Bradesco Saúde e SulAmérica, além de particular."},
       {"question":"Qual o valor da consulta particular?","answer":"R$ 350 na Unidade Moema e R$ 290 na Unidade Santana."},
       {"question":"Precisa de pedido médico para fazer exame?","answer":"Para os exames feitos aqui, sim — o pedido sai na consulta."},
       {"question":"Tem estacionamento?","answer":"Na Moema, no subsolo do prédio, R$ 15 com validação na recepção."}]'::jsonb,
     'Oi! Aqui é a Clara, da Clínica Exemplo. Posso te ajudar a marcar uma consulta ou tirar dúvidas sobre preparo de exames.',
     'Vou te conectar com nossa equipe agora. Só um instante!',
     'Nosso atendimento é de segunda a sexta, das 8h às 18h. Deixe sua mensagem que respondemos assim que abrirmos.',
     false, 'own', 'pending');

  insert into public.handoff_hours (workspace_id, day_of_week, start_time, end_time, is_active)
  select w.id, d.dow, '08:00'::time, '18:00'::time, true
  from (values (v_ws_a), (v_ws_b)) as w(id)
  cross join generate_series(1, 5) as d(dow);

  -- ══ 4. Catálogo de procedimentos ═══════════════════════════════════════
  -- A Santana cobra 15% menos que a Moema (bate com consultation_price_from).
  insert into public.procedure_catalog
    (workspace_id, name, code, default_price, duration_min, is_active)
  select w.id, p.nome, p.codigo,
         round(p.preco * case when w.id = v_ws_b then 0.85 else 1 end, 2),
         p.dur, true
  from (values (v_ws_a), (v_ws_b)) as w(id)
  cross join (values
    ('Aplicação de vacina',      'VAC-01', 120.00, 15),
    ('Avaliação pré-operatória', 'PRE-01', 480.00, 45),
    ('Check-up executivo',       'CHK-01', 890.00, 60),
    ('Consulta clínica',         'CON-01', 350.00, 30),
    ('Retorno',                  'RET-01',   0.00, 20)
  ) as p(nome, codigo, preco, dur);

  -- ══ 5. Pacientes ═══════════════════════════════════════════════════════
  with novos as (
    insert into public.patients
      (account_id, full_name, phone, email, birth_date, notes, tags, created_by)
    select
      v_account_id,
      n.nome || ' ' || s.sobrenome,
      '+5511' || lpad((940000000 + i.i * 137)::text, 9, '0'),
      lower(translate(n.nome, 'áéíóúâêôãõç', 'aeiouaeoaoc')) || '.' ||
        lower(translate(s.sobrenome, 'áéíóúâêôãõç', 'aeiouaeoaoc')) ||
        i.i || '@example.com',
      make_date(1960 + (i.i * 7) % 45, 1 + (i.i % 12), 1 + (i.i * 5) % 28),
      case when i.i % 6 = 0 then 'Prefere horário na parte da manhã.'
           when i.i % 9 = 0 then 'Alergia a dipirona — registrado na primeira consulta.'
           else null end,
      case when i.i % 8 = 0 then '{VIP}'::text[]
           when i.i % 5 = 0 then '{convenio}'::text[]
           else '{}'::text[] end,
      v_user_id
    from generate_series(1, 36) as i(i)
    cross join lateral (
      select (array['Ana','Bruno','Carla','Diego','Elaine','Fábio','Gabriela','Hugo',
                    'Isabela','João','Karina','Lucas','Mariana','Nicolas','Otávio',
                    'Patrícia','Rafael','Sabrina'])[1 + (i.i % 18)] as nome
    ) n
    cross join lateral (
      select (array['Silva','Souza','Oliveira','Santos','Pereira','Costa','Rodrigues',
                    'Almeida','Nascimento','Lima','Araújo','Fernandes'])[1 + (i.i % 12)] as sobrenome
    ) s
    returning id
  )
  select array_agg(id) into v_pat_ids from novos;
  v_n_pac := array_length(v_pat_ids, 1);

  -- ══ 6. Expediente ══════════════════════════════════════════════════════
  insert into public.availability_rules
    (workspace_id, doctor_id, day_of_week, start_time, end_time, slot_duration, is_active)
  values
    (v_ws_a, v_user_id, 1, '08:00', '19:00', 30, true),
    (v_ws_a, v_user_id, 2, '08:00', '19:00', 30, true),
    (v_ws_a, v_user_id, 3, '08:00', '19:00', 30, true),
    (v_ws_a, v_user_id, 4, '08:00', '19:00', 30, true),
    (v_ws_a, v_user_id, 5, '08:00', '16:00', 30, true),
    (v_ws_b, v_user_id, 1, '09:00', '18:00', 30, true),
    (v_ws_b, v_user_id, 3, '09:00', '18:00', 30, true),
    (v_ws_b, v_user_id, 5, '09:00', '18:00', 30, true);

  insert into public.availability_exceptions
    (workspace_id, doctor_id, date, type, start_time, end_time, reason)
  values
    (v_ws_a, v_user_id, current_date + 9,  'blocked', null,    null,    'Congresso de clínica médica'),
    (v_ws_a, v_user_id, current_date + 10, 'blocked', null,    null,    'Congresso de clínica médica'),
    (v_ws_a, v_user_id, current_date + 16, 'extra',   '08:00', '12:00', 'Mutirão de check-up'),
    (v_ws_b, v_user_id, current_date + 3,  'blocked', '14:00', '18:00', 'Manutenção do prédio');

  -- ══ 7. Agenda ══════════════════════════════════════════════════════════
  -- 90 dias corridos (75 para trás, 14 para frente), só dias úteis, até 3
  -- consultas por dia. O passado tem realizado/faltou/cancelado; o futuro tem
  -- agendado/confirmado. É daqui que saem o dashboard e o ciclo de receita.
  with pac as (
    select p.id, p.full_name, p.phone,
           row_number() over (order by p.created_at, p.id) as rn
    from public.patients p where p.account_id = v_account_id
  ),
  grade as (
    select d.off, s.slot,
           case when (d.off + s.slot) % 5 = 0 then v_ws_b else v_ws_a end as ws
    from generate_series(-75, 14) as d(off)
    cross join generate_series(1, 3) as s(slot)
    where extract(dow from current_date + d.off) between 1 and 5
      and (abs(d.off) + s.slot) % 4 <> 0   -- alguns horários ficam vagos
  )
  insert into public.appointments
    (workspace_id, account_id, doctor_id, patient_id, patient_name, patient_phone,
     scheduled_at, duration_min, type, source, status, notes,
     procedure_id, procedure_name, price, health_plan, reminder_sent)
  select
    g.ws, v_account_id, v_user_id, p.id, p.full_name, p.phone,
    (current_date + g.off)::timestamp + time '08:00' + ((g.slot - 1) * interval '150 minutes'),
    proc.duration_min,
    (array['consulta','retorno','avaliacao','procedimento','consulta'])[1 + ((abs(g.off) + g.slot) % 5)],
    case when (abs(g.off) + g.slot) % 3 = 0 then 'bot' else 'manual' end,
    case
      when g.off > 0 then case when (abs(g.off) + g.slot) % 3 = 0 then 'confirmado' else 'agendado' end
      when g.off = 0 then 'confirmado'
      when (abs(g.off) + g.slot) % 11 = 0 then 'no_show'
      when (abs(g.off) + g.slot) % 13 = 0 then 'cancelado'
      else 'realizado'
    end,
    case when (abs(g.off) + g.slot) % 17 = 0 then 'Paciente pediu para ser chamado 10 min antes.' else null end,
    proc.id, proc.name,
    -- Retorno é sem custo (default_price 0): fica sem preço e, por isso, fora
    -- do ciclo de receita.
    nullif(proc.default_price, 0),
    case when (abs(g.off) + g.slot) % 4 = 0 then 'Unimed'
         when (abs(g.off) + g.slot) % 7 = 0 then 'Bradesco Saúde'
         else null end,
    g.off < 0
  from grade g
  join lateral (
    select pac.id, pac.full_name, pac.phone from pac
    where pac.rn = 1 + ((abs(g.off) * 3 + g.slot) % v_n_pac) limit 1
  ) p on true
  join lateral (
    select pc.id, pc.name, pc.default_price, pc.duration_min
    from public.procedure_catalog pc
    where pc.workspace_id = g.ws
    order by pc.name
    offset ((abs(g.off) + g.slot) % 5) limit 1
  ) proc on true;

  -- ══ 8. Conversas da Clara, mensagens e handoff ═════════════════════════
  -- Conversa 1 — resolvida: o paciente agendou sozinho pelo bot.
  insert into public.conversations
    (workspace_id, account_id, patient_id, patient_phone, status, summary,
     started_at, resolved_at)
  values
    (v_ws_a, v_account_id, v_pat_ids[1],
     (select phone from public.patients where id = v_pat_ids[1]),
     'resolved', 'Paciente agendou consulta de retorno para a próxima terça.',
     now() - interval '3 days', now() - interval '3 days' + interval '11 minutes')
  returning id into v_conv;

  insert into public.messages (conversation_id, role, content, sent_at) values
    (v_conv, 'user',      'Oi, queria marcar um retorno com o Dr. Eduardo',
     now() - interval '3 days'),
    (v_conv, 'assistant', 'Oi! Claro. Seu último atendimento foi há três semanas, então o retorno é sem custo. Tenho terça às 9h ou quinta às 15h na Unidade Moema. Qual fica melhor?',
     now() - interval '3 days' + interval '1 minute'),
    (v_conv, 'user',      'Terça às 9 tá ótimo',
     now() - interval '3 days' + interval '6 minutes'),
    (v_conv, 'assistant', 'Agendado para terça às 9h na Unidade Moema, Av. Ibirapuera 2033. Te mando um lembrete na véspera!',
     now() - interval '3 days' + interval '7 minutes');

  -- Conversa 2 — pediu humano: vira handoff, bot pausado e log de auditoria.
  insert into public.conversations
    (workspace_id, account_id, patient_id, patient_phone, status, bot_paused,
     summary, started_at)
  values
    (v_ws_a, v_account_id, v_pat_ids[2],
     (select phone from public.patients where id = v_pat_ids[2]),
     'handoff', true,
     'Paciente contestou cobrança de falta — encaminhado para a recepção.',
     now() - interval '5 hours')
  returning id into v_conv;

  insert into public.messages (conversation_id, role, content, sent_at) values
    (v_conv, 'user',      'Recebi uma cobrança de falta mas eu avisei que não ia',
     now() - interval '5 hours'),
    (v_conv, 'assistant', 'Sinto muito pelo transtorno. Isso eu não consigo resolver por aqui — vou te conectar com nossa equipe agora. Um instante!',
     now() - interval '5 hours' + interval '2 minutes'),
    (v_conv, 'user',      'Obrigado',
     now() - interval '5 hours' + interval '4 minutes');

  insert into public.handoff_logs
    (workspace_id, conversation_id, patient_phone, trigger_reason, handoff_to, sent_at)
  values
    (v_ws_a, v_conv, (select phone from public.patients where id = v_pat_ids[2]),
     'user_request', '+5511955550101', now() - interval '5 hours' + interval '2 minutes');

  -- Conversa 3 — aberta, aguardando o paciente responder.
  insert into public.conversations
    (workspace_id, account_id, patient_id, patient_phone, status, summary, started_at)
  values
    (v_ws_b, v_account_id, v_pat_ids[3],
     (select phone from public.patients where id = v_pat_ids[3]),
     'open', 'Perguntou sobre preparo de exame; falta confirmar horário.',
     now() - interval '40 minutes')
  returning id into v_conv;

  insert into public.messages (conversation_id, role, content, sent_at) values
    (v_conv, 'user',      'Preciso fazer jejum pro ultrassom de abdome?',
     now() - interval '40 minutes'),
    (v_conv, 'assistant', 'Precisa sim: 6 horas de jejum e bexiga cheia (beba 1 litro de água uma hora antes). Quer que eu veja um horário para você?',
     now() - interval '39 minutes');

  -- Conversa 4 — arquivada, para o filtro da tela de conversas ter conteúdo.
  insert into public.conversations
    (workspace_id, account_id, patient_id, patient_phone, status, summary,
     started_at, resolved_at, archived_at)
  values
    (v_ws_a, v_account_id, v_pat_ids[4],
     (select phone from public.patients where id = v_pat_ids[4]),
     'resolved', 'Pediu endereço e horário de funcionamento.',
     now() - interval '38 days', now() - interval '38 days' + interval '3 minutes',
     now() - interval '7 days');

  -- ══ 9. Lista de espera ═════════════════════════════════════════════════
  insert into public.waitlist
    (workspace_id, account_id, patient_id, patient_name, patient_phone, doctor_id,
     preferred_days, preferred_times, notes, desired_date, desired_time,
     source, status, notified_at)
  select
    case when i.i % 3 = 0 then v_ws_b else v_ws_a end,
    v_account_id, v_pat_ids[10 + i.i],
    (select full_name from public.patients where id = v_pat_ids[10 + i.i]),
    (select phone     from public.patients where id = v_pat_ids[10 + i.i]),
    v_user_id,
    case when i.i % 2 = 0 then '{segunda,quarta}'::text[] else '{terca,quinta,sexta}'::text[] end,
    case when i.i % 2 = 0 then '{manha}'::text[] else '{tarde}'::text[] end,
    case when i.i = 1 then 'Só consegue vir depois das 17h.' else null end,
    -- A Clara registra o dia exato quando o paciente nomeia um.
    case when i.i % 2 = 0 then current_date + i.i else null end,
    case when i.i % 2 = 0 then '09:00'::time else null end,
    case when i.i % 2 = 0 then 'bot' else 'manual' end,
    case when i.i = 5 then 'scheduled' when i.i = 6 then 'cancelled' else 'waiting' end,
    case when i.i = 2 then now() - interval '1 day' else null end
  from generate_series(1, 6) as i(i);

  -- ══ 10. Categorias do financeiro ═══════════════════════════════════════
  -- Mesma árvore de lib/finance/default-categories.ts. Precisa vir antes das
  -- receitas porque o espelho do ciclo de receita procura a categoria
  -- "Consultas particulares".
  perform public.provision_finance_categories(v_account_id, '{
    "pf": [
      {"name":"Alimentação","children":["Mercado","Restaurante","Delivery"]},
      {"name":"Moradia","children":["Aluguel","Condomínio","Contas (luz/água/gás)","Internet"]},
      {"name":"Filhos","children":["Escola","Saúde","Atividades"]},
      {"name":"Saúde","children":["Plano","Farmácia","Consultas"]},
      {"name":"Transporte","children":["Combustível","App/Táxi","Manutenção"]},
      {"name":"Lazer","children":["Viagem","Streaming","Restaurantes"]},
      {"name":"Vestuário","children":[]},
      {"name":"Assinaturas","children":[]},
      {"name":"Investimentos","children":[]},
      {"name":"Impostos e taxas","children":[]},
      {"name":"Outros","children":[]}
    ],
    "pj": [
      {"name":"Aluguel","children":[]},
      {"name":"Salários e encargos","children":[]},
      {"name":"Marketing","children":[]},
      {"name":"Software e assinaturas","children":[]},
      {"name":"Equipamentos","children":[]},
      {"name":"Materiais médicos","children":[]},
      {"name":"Contabilidade","children":[]},
      {"name":"Impostos","children":[]},
      {"name":"Manutenção","children":[]},
      {"name":"Outros","children":[]}
    ]
  }'::jsonb);
  perform public.ensure_finance_income_seed(v_account_id);

  select id into v_cat_consultas
  from public.finance_categories
  where account_id = v_account_id and kind = 'pj' and direction = 'in'
    and parent_id is null
    and public.normalize_category_name(name)
        = public.normalize_category_name('Consultas particulares')
  limit 1;

  -- ══ 11. Ciclo de receita ═══════════════════════════════════════════════
  insert into public.revenue_settings
    (workspace_id, account_id, daily_summary_enabled, daily_summary_hour,
     daily_summary_only_with_activity, overdue_tolerance_days)
  values
    (v_ws_a, v_account_id, true, 20, false, 2),
    (v_ws_b, v_account_id, true, 19, true,  3);

  -- Toda consulta com preço vira uma entrada de receita, com o payment_status
  -- coerente com o status da consulta. As pagas geram o lançamento-espelho no
  -- financeiro, no mesmo formato de lib/revenue/finance-mirror.ts.
  with nova as (
    insert into public.revenue_entries
      (workspace_id, account_id, appointment_id, patient_id, procedure_id,
       procedure_name, amount, status, payment_status, payment_method,
       installments, source, due_date, paid_at, entry_date)
    select
      a.workspace_id, a.account_id, a.id, a.patient_id, a.procedure_id,
      a.procedure_name, a.price,
      case a.status when 'realizado' then 'confirmado'
                    when 'cancelado' then 'cancelado'
                    when 'no_show'   then 'cancelado'
                    else 'previsto' end,
      case
        when a.status in ('cancelado','no_show') then 'cancelled'
        -- ~1 em 6 consultas realizadas segue sem pagamento: é o que aparece
        -- como atrasado no ciclo de receita e o que falta no "previsto" da
        -- tela de financeiro.
        when a.status = 'realizado' and (extract(day from a.scheduled_at)::int % 6) = 0 then 'realized'
        when a.status = 'realizado' then 'paid'
        else 'pending'
      end,
      case when a.status = 'realizado' and (extract(day from a.scheduled_at)::int % 6) <> 0
           then (array['pix','cartao_credito','cartao_debito','dinheiro'])
                  [1 + (extract(day from a.scheduled_at)::int % 4)]
           else null end,
      1,
      case when a.source = 'bot' then 'bot' else 'manual' end,
      a.scheduled_at::date,
      case when a.status = 'realizado' and (extract(day from a.scheduled_at)::int % 6) <> 0
           then a.scheduled_at + interval '3 hours' else null end,
      a.scheduled_at::date
    from public.appointments a
    where a.account_id = v_account_id and a.price is not null
    returning id, workspace_id, amount, procedure_name, entry_date, payment_status
  )
  insert into public.finance_entries
    (account_id, workspace_id, recorded_by_phone, type, direction, description,
     amount, category, category_id, subcategory_id, raw_message, entry_date,
     revenue_entry_id)
  select
    v_account_id, n.workspace_id, 'revenue-cycle', 'pj', 'in', n.procedure_name,
    n.amount, 'Consultas particulares', v_cat_consultas, null,
    'seed:completo (ciclo de receita)', n.entry_date, n.id
  from nova n
  where n.payment_status = 'paid';

  -- ══ 12. Financeiro: 12 meses de PF e PJ ════════════════════════════════
  -- Recorrentes com oscilação de ±14% mês a mês, para a série de 12 meses da
  -- tela /financeiro não virar uma linha reta. O mês corrente só recebe
  -- lançamentos até o dia de hoje.
  insert into public.finance_entries
    (account_id, workspace_id, recorded_by_phone, type, direction, description,
     amount, category, category_id, subcategory_id, raw_message, entry_date)
  select
    v_account_id,
    -- PF é consolidado (workspace_id null); PJ se divide entre as unidades.
    case when t.kind = 'pj'
         then case when (g.m + t.dia) % 3 = 0 then v_ws_b else v_ws_a end
         else null end,
    v_phone, t.kind, t.dir, t.descricao,
    case when t.varia
         then round(t.base * (0.86 + ((g.m * 13 + length(t.descricao) * 7 + t.dia) % 29) / 100.0), 2)
         else t.base end,
    t.cat, cat.id, sub.id, 'seed:completo',
    (v_month_start - ((11 - g.m) * interval '1 month'))::date
      + (case when g.m = 11
              then greatest(1, ceil(t.dia * v_elapsed / 28.0)::int)
              else t.dia end) - 1
  from generate_series(0, 11) as g(m)
  cross join (values
    -- PF — despesas
    ('pf','out','Aluguel do apartamento',    'Moradia',          'Aluguel',               3200.00, false,  5),
    ('pf','out','Condomínio',                'Moradia',          'Condomínio',             780.00, false,  5),
    ('pf','out','Luz, água e gás',           'Moradia',          'Contas (luz/água/gás)',  438.00, true,  12),
    ('pf','out','Internet fibra',            'Moradia',          'Internet',               149.00, false,  9),
    ('pf','out','Mercado do mês',            'Alimentação',      'Mercado',               1180.00, true,   6),
    ('pf','out','Mercado — reposição',       'Alimentação',      'Mercado',                640.00, true,  19),
    ('pf','out','Jantares fora',             'Alimentação',      'Restaurante',            520.00, true,  22),
    ('pf','out','Delivery',                  'Alimentação',      'Delivery',               310.00, true,  15),
    ('pf','out','Combustível',               'Transporte',       'Combustível',            540.00, true,   8),
    ('pf','out','Corridas de app',           'Transporte',       'App/Táxi',               185.00, true,  18),
    ('pf','out','Plano de saúde da família', 'Saúde',            'Plano',                 1240.00, false, 10),
    ('pf','out','Farmácia',                  'Saúde',            'Farmácia',               215.00, true,  14),
    ('pf','out','Mensalidade escolar',       'Filhos',           'Escola',                2150.00, false,  7),
    ('pf','out','Natação das crianças',      'Filhos',           'Atividades',             320.00, false,  7),
    ('pf','out','Streaming',                 'Lazer',            'Streaming',               89.00, false,  3),
    ('pf','out','Assinaturas diversas',      'Assinaturas',      null,                     126.00, true,   3),
    ('pf','out','Carnê-leão',                'Impostos e taxas', null,                    1820.00, true,  20),
    -- PF — receitas
    ('pf','in', 'Pró-labore',                'Salário / Pró-labore', null,               22000.00, false,  5),
    ('pf','in', 'Aluguel da sala comercial', 'Aluguéis recebidos',   null,                2400.00, false, 10),
    ('pf','in', 'Rendimento CDB',            'Investimentos',        null,                 610.00, true,  28),
    -- PJ — despesas
    ('pj','out','Aluguel da clínica',        'Aluguel',                null,              6500.00, false,  5),
    ('pj','out','Folha da equipe',           'Salários e encargos',    null,             14200.00, true,   5),
    ('pj','out','Tráfego pago e social',     'Marketing',              null,              2400.00, true,  10),
    ('pj','out','Sistema de gestão',         'Software e assinaturas', null,               890.00, false,  2),
    ('pj','out','Materiais e descartáveis',  'Materiais médicos',      null,              2380.00, true,  16),
    ('pj','out','Honorários contábeis',      'Contabilidade',          null,               950.00, false,  8),
    ('pj','out','Simples Nacional',          'Impostos',               null,              4380.00, true,  20),
    ('pj','out','Manutenção predial',        'Manutenção',             null,               620.00, true,  24),
    -- PJ — receitas lançadas na mão (sem vínculo com o ciclo de receita)
    ('pj','in', 'Repasse de convênios',      'Convênios',              null,             12800.00, true,  15),
    ('pj','in', 'Procedimentos estéticos',   'Procedimentos',          null,              8400.00, true,  21)
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

  -- Gastos pontuais, que jogam o saldo daqueles meses para o vermelho.
  insert into public.finance_entries
    (account_id, workspace_id, recorded_by_phone, type, direction, description,
     amount, category, category_id, subcategory_id, raw_message, entry_date)
  select
    v_account_id, case when t.kind = 'pj' then v_ws_a else null end,
    v_phone, t.kind, 'out', t.descricao, t.valor, t.cat, cat.id, sub.id,
    'seed:completo',
    (v_month_start - (t.meses * interval '1 month'))::date + t.dia - 1
  from (values
    ('pf','Viagem de férias em família','Lazer',              'Viagem',18500.00,4, 8),
    ('pf','Reforma do quarto',          'Moradia',            null,     4200.00,9,17),
    ('pj','Compra de equipamento novo', 'Equipamentos',       null,    32000.00,6,12),
    ('pj','Rescisão de contrato',       'Salários e encargos',null,     9800.00,2,26)
  ) as t(kind, descricao, cat, sub, valor, meses, dia)
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

  -- Lançamentos sem categoria no mês corrente: acendem o alerta âmbar e dão o
  -- que filtrar na tabela.
  insert into public.finance_entries
    (account_id, workspace_id, recorded_by_phone, type, direction, description,
     amount, category, category_id, subcategory_id, raw_message, entry_date)
  select
    v_account_id, case when t.kind = 'pj' then v_ws_a else null end,
    v_phone, t.kind, t.dir, t.descricao, t.valor, null, null, null,
    'seed:completo',
    v_month_start + greatest(0, least(t.dia, v_elapsed) - 1)
  from (values
    ('pf','out','Compra no cartão — não identificado',  430.00,  4),
    ('pf','out','Saque 24h',                            200.00,  7),
    ('pf','out','Pix enviado — sem descrição',          158.00,  9),
    ('pf','in', 'Transferência recebida',               950.00,  6),
    ('pj','out','Débito recorrente 3452',              1290.00,  5),
    ('pj','out','Boleto sem identificação',             680.00, 10)
  ) as t(kind, dir, descricao, valor, dia);

  -- ══ 13. Tráfego pago ═══════════════════════════════════════════════════
  insert into public.ad_campaigns
    (workspace_id, account_id, channel, campaign_name, period_start, period_end,
     spend, impressions, clicks, leads)
  select
    case when c.ordem % 3 = 0 then v_ws_b else v_ws_a end,
    v_account_id, c.canal, c.nome,
    (v_month_start - (c.meses * interval '1 month'))::date,
    (v_month_start - (c.meses * interval '1 month'))::date + 29,
    c.gasto, c.imp, c.cliques, c.leads
  from (values
    ('instagram','Check-up executivo — prospecção',0,2400.00,118000,2140,74,1),
    ('google',   'Busca — clínico geral Moema',    0,1800.00, 26000, 980,61,2),
    ('instagram','Check-up executivo — prospecção',1,2200.00,104000,1870,63,3),
    ('google',   'Busca — clínico geral Moema',    1,1750.00, 24500, 910,55,4),
    ('facebook', 'Remarketing — pacientes antigos',1, 640.00, 31000, 520,22,5),
    ('instagram','Check-up executivo — prospecção',2,1900.00, 92000,1610,48,6),
    ('tiktok',   'Teste de criativo — vertical',   2, 480.00, 58000, 740,12,7)
  ) as c(canal, nome, meses, gasto, imp, cliques, leads, ordem);

  -- ══ 14. Transcrições ═══════════════════════════════════════════════════
  -- audio_path aponta para arquivos que não existem no storage: a lista e o
  -- prontuário abrem normalmente, só o player não toca.
  insert into public.transcriptions
    (workspace_id, account_id, appointment_id, patient_id, recorded_by,
     audio_path, duration_seconds, transcript_text, medical_record_draft,
     medical_record_final, status, consent_confirmed, source, signed_at,
     signed_by, retry_count, error_message)
  select
    v_ws_a, v_account_id,
    (select a.id from public.appointments a
      where a.account_id = v_account_id and a.workspace_id = v_ws_a
        and a.status = 'realizado'
      order by a.scheduled_at desc offset t.i limit 1),
    v_pat_ids[20 + t.i],
    v_user_id,
    'seed/' || v_account_id || '/consulta-' || t.i || '.webm',
    t.dur, t.texto,
    t.registro::jsonb,
    case when t.st = 'signed' then t.registro::jsonb else null end,
    t.st::public.transcription_status,
    true, 'system',
    case when t.st = 'signed' then now() - ((t.i + 1) || ' days')::interval else null end,
    case when t.st = 'signed' then v_user_id else null end,
    case when t.st = 'error' then 2 else 0 end,
    case when t.st = 'error' then 'Falha ao transcrever: áudio sem voz identificável.' else null end
  from (values
    (0, 'signed', 812,
     'Doutor, faz umas três semanas que eu acordo com dor de cabeça. Piora quando eu fico muito tempo no computador.',
     '{"soap":{"S":{"queixa_principal":"Cefaleia matinal há três semanas","historia_atual":"Dor bilateral, em peso, pior após longos períodos ao computador. Sem náusea ou fotofobia.","antecedentes":"Sem comorbidades conhecidas.","medicamentos_em_uso":["Dipirona 500mg se dor"]},"O":{"exame_fisico":"PA 128x84. Exame neurológico sem alterações. Contratura de trapézio bilateral.","exames_solicitados":["Hemograma","Glicemia de jejum"],"exames_resultados":null},"A":{"hipotese_diagnostica":"Cefaleia tensional","diagnosticos_secundarios":["Postura inadequada no trabalho"],"cid10":"G44.2"},"P":{"prescricao":["Dipirona 1g até 8/8h se dor"],"orientacoes":["Pausas de 5 minutos a cada hora de tela","Alongamento cervical duas vezes ao dia"],"retorno":"30 dias","encaminhamentos":[]}},"resumo":"Cefaleia tensional associada à postura no trabalho. Orientado ajuste ergonômico e analgesia se dor.","alertas":[]}'),
    (1, 'draft_ready', 645,
     'Vim fazer o check-up que a empresa pede todo ano. Estou me sentindo bem, só um cansaço no fim do dia.',
     '{"soap":{"S":{"queixa_principal":"Check-up anual solicitado pela empresa","historia_atual":"Assintomático. Refere cansaço vespertino. Sedentário.","antecedentes":"Pai hipertenso.","medicamentos_em_uso":[]},"O":{"exame_fisico":"IMC 27,4. PA 134x88. Ausculta cardiopulmonar normal.","exames_solicitados":["Hemograma","Perfil lipídico","TSH","Glicemia de jejum"],"exames_resultados":null},"A":{"hipotese_diagnostica":"Sobrepeso com risco cardiovascular a esclarecer","diagnosticos_secundarios":["Sedentarismo"],"cid10":"E66.0"},"P":{"prescricao":[],"orientacoes":["Atividade física 150 minutos por semana","Reduzir ultraprocessados"],"retorno":"Com os exames em mãos, em 15 dias","encaminhamentos":["Nutrição"]}},"resumo":"Check-up anual. Sobrepeso e pressão limítrofe; exames solicitados e retorno em 15 dias.","alertas":["PA limítrofe — reavaliar no retorno"]}'),
    (2, 'error', 97, null, null)
  ) as t(i, st, dur, texto, registro);

  -- ══ 15. Feedback, CRM interno e logs ═══════════════════════════════════
  insert into public.feedback (account_id, workspace_id, user_id, message, status)
  values
    (v_account_id, v_ws_a, v_user_id,
     'Seria ótimo poder exportar a agenda do mês em PDF para levar impressa.', 'new'),
    (v_account_id, v_ws_a, v_user_id,
     'A busca de pacientes podia aceitar o telefone sem o +55.', 'reviewed');

  insert into public.account_notes (account_id, type, body, created_by)
  values
    (v_account_id, 'call',    'Onboarding feito por telefone. Ficou de mandar o número próprio da Meta até sexta.', v_user_id),
    (v_account_id, 'meeting', 'Demo do ciclo de receita para o financeiro da clínica. Gostaram do resumo diário.', v_user_id),
    (v_account_id, 'note',    'Clínica tem uma terceira unidade prevista para o ano que vem.', v_user_id);

  insert into public.account_tasks
    (account_id, title, description, due_date, assigned_to, status, created_by, completed_at)
  values
    (v_account_id, 'Conectar número WhatsApp',
     'Aguardando o App Meta da clínica para concluir o onboarding do bot.',
     current_date + 3, v_user_id, 'pending', v_user_id, null),
    (v_account_id, 'Treinar recepção no ciclo de receita', null,
     current_date + 10, v_user_id, 'pending', v_user_id, null),
    (v_account_id, 'Importar base de pacientes antiga', 'Planilha recebida e importada.',
     current_date - 12, v_user_id, 'done', v_user_id, now() - interval '11 days');

  -- Um registro de rate limit e um payload cru de webhook, só para as telas de
  -- diagnóstico não ficarem vazias.
  insert into public.rate_limit_log (account_id, phone, message_count, window_start)
  values (v_account_id, '+5511911112222', 14, now() - interval '30 minutes')
  on conflict (account_id, phone) do nothing;

  insert into public.webhook_logs (workspace_id, payload, processed, received_at)
  values
    (v_ws_a,
     '{"object":"whatsapp_business_account","entry":[{"changes":[{"field":"messages","value":{"messages":[{"type":"text","text":{"body":"oi"}}]}}]}]}'::jsonb,
     true, now() - interval '2 hours');

  -- ══ 16. Resumo ═════════════════════════════════════════════════════════
  raise notice '───────────────────────────────────────────────';
  raise notice 'Seed completo. account_id = %', v_account_id;
  select count(*) into v_n from public.patients        where account_id = v_account_id;
  raise notice '  pacientes:     %', v_n;
  select count(*) into v_n from public.appointments    where account_id = v_account_id;
  raise notice '  consultas:     %', v_n;
  select count(*) into v_n from public.revenue_entries where account_id = v_account_id;
  raise notice '  receitas:      %', v_n;
  select count(*) into v_n from public.finance_entries where account_id = v_account_id;
  raise notice '  lancamentos:   %', v_n;
  select count(*) into v_n from public.conversations   where account_id = v_account_id;
  raise notice '  conversas:     %', v_n;
  select count(*) into v_n from public.transcriptions  where account_id = v_account_id;
  raise notice '  transcricoes:  %', v_n;
  raise notice 'Entre com % e escolha a Clinica Exemplo.', v_email;
  raise notice '───────────────────────────────────────────────';
end $$;
