-- MedScale — dados fictícios para teste/demo.
-- Rode DEPOIS do schema.sql, no SQL Editor do Supabase.
--
-- Como funciona: memberships, patients.created_by etc. apontam para auth.users,
-- que é gerenciado pelo Supabase Auth (não dá pra inventar um usuário via SQL
-- com segurança). Por isso este script vincula o account fictício à SUA conta
-- já cadastrada (cadastre-se primeiro em /registrar) — assim você loga normal
-- e vê os dados de teste no dashboard, como se fosse "owner" da clínica demo.
--
-- >>> TROQUE O E-MAIL ABAIXO pelo e-mail que você usou no cadastro <<<

-- Para rodar de novo do zero (apaga só os dados fictícios, cascata cuida do resto):
-- delete from public.accounts where slug = 'clinica-demo';

do $$
declare
  v_user_id         uuid;
  v_account_id      uuid;
  v_workspace_id    uuid;
  v_patient1_id     uuid;
  v_patient2_id     uuid;
  v_patient3_id     uuid;
  v_conversation_id uuid;
  v_appointment_id  uuid;
begin
  select id into v_user_id
  from auth.users
  where email = 'eduardobordev@gmail.com';

  if v_user_id is null then
    raise exception 'Usuário não encontrado. Cadastre-se em /registrar primeiro e ajuste o e-mail no topo deste script.';
  end if;

  -- Account + workspace ------------------------------------------------
  insert into public.accounts
    (name, slug, plan, modules, max_workspaces, max_members, billing_email, created_by)
  values
    ('Clínica Demo', 'clinica-demo', 'avancado',
     '{dashboard,agenda,patients,settings}', 2, 5,
     'financeiro@clinicademo.com.br', v_user_id)
  returning id into v_account_id;

  insert into public.workspaces
    (account_id, name, slug, address, city, state, zip_code,
     business_hours, consultation_price_from, is_active, is_default)
  values
    (v_account_id, 'Unidade Centro', 'unidade-centro',
     'Rua das Flores, 123', 'São Paulo', 'SP', '01310-100',
     'Seg a Sex, 8h às 18h', 250.00, true, true)
  returning id into v_workspace_id;

  insert into public.memberships (account_id, user_id, role, status, accepted_at)
  values (v_account_id, v_user_id, 'owner', 'active', now());

  -- Bot config (uma por account) ---------------------------------------
  -- is_active fica false/pending de propósito: sem um meta_token real em
  -- bot_config (só a conexão de verdade via /api/bot/onboarding/verify-meta
  -- seta os dois juntos), marcar como ativo aqui deixaria essa tela e a de
  -- Configurações divergentes (uma diz "ativo", a outra "não configurado")
  -- e esconderia o wizard de conexão por trás de "bot já ativo".
  insert into public.bot_config
    (account_id, specialty, procedures, insurance_plans,
     accepts_private, is_active, number_source, onboarding_step)
  values
    (v_account_id, 'Clínica Geral',
     '{Consulta,Retorno,Avaliação}', '{Unimed,Bradesco Saúde,Particular}',
     true, false, 'own', 'pending');

  -- Pacientes --------------------------------------------------------------
  insert into public.patients
    (account_id, full_name, phone, email, birth_date, notes, tags, created_by)
  values
    (v_account_id, 'Maria Silva', '+5511987654321', 'maria.silva@example.com',
     '1985-04-12', 'Paciente antiga, prefere manhã', '{VIP}', v_user_id)
  returning id into v_patient1_id;

  insert into public.patients
    (account_id, full_name, phone, email, birth_date, created_by)
  values
    (v_account_id, 'João Pereira', '+5511976543210', 'joao.pereira@example.com',
     '1990-09-30', v_user_id)
  returning id into v_patient2_id;

  insert into public.patients
    (account_id, full_name, phone, birth_date, created_by)
  values
    (v_account_id, 'Ana Costa', '+5511965432109', '1978-01-22', v_user_id)
  returning id into v_patient3_id;

  -- Agendamentos -------------------------------------------------------
  insert into public.appointments
    (workspace_id, account_id, doctor_id, patient_id, patient_name, patient_phone,
     scheduled_at, duration_min, type, source, status, price)
  values
    (v_workspace_id, v_account_id, v_user_id, v_patient1_id, 'Maria Silva', '+5511987654321',
     now() + interval '2 days' + interval '9 hours', 30, 'consulta', 'bot', 'confirmado', 250.00);

  insert into public.appointments
    (workspace_id, account_id, doctor_id, patient_id, patient_name, patient_phone,
     scheduled_at, duration_min, type, source, status, price)
  values
    (v_workspace_id, v_account_id, v_user_id, v_patient2_id, 'João Pereira', '+5511976543210',
     now() + interval '3 days' + interval '14 hours', 30, 'retorno', 'manual', 'agendado', 150.00);

  insert into public.appointments
    (workspace_id, account_id, doctor_id, patient_id, patient_name, patient_phone,
     scheduled_at, duration_min, type, source, status, price)
  values
    (v_workspace_id, v_account_id, v_user_id, v_patient3_id, 'Ana Costa', '+5511965432109',
     now() - interval '1 days' + interval '10 hours', 45, 'avaliacao', 'bot', 'realizado', 300.00)
  returning id into v_appointment_id;

  -- Conversa + mensagens do bot ------------------------------------------
  insert into public.conversations
    (workspace_id, account_id, patient_id, patient_phone, status, summary)
  values
    (v_workspace_id, v_account_id, v_patient1_id, '+5511987654321', 'resolved',
     'Paciente agendou consulta de retorno via WhatsApp')
  returning id into v_conversation_id;

  insert into public.messages (conversation_id, role, content, sent_at)
  values
    (v_conversation_id, 'user', 'Oi, gostaria de marcar uma consulta', now() - interval '2 hours'),
    (v_conversation_id, 'assistant', 'Olá Maria! Temos horário na quinta às 9h. Confirma?', now() - interval '2 hours' + interval '1 minute'),
    (v_conversation_id, 'user', 'Sim, pode confirmar', now() - interval '1 hour 55 minutes'),
    (v_conversation_id, 'assistant', 'Perfeito, consulta confirmada para quinta às 9h!', now() - interval '1 hour 54 minutes');

  -- Expediente ------------------------------------------------------------
  insert into public.availability_rules
    (workspace_id, doctor_id, day_of_week, start_time, end_time, slot_duration, is_active)
  values
    (v_workspace_id, v_user_id, 1, '08:00', '18:00', 30, true),
    (v_workspace_id, v_user_id, 2, '08:00', '18:00', 30, true),
    (v_workspace_id, v_user_id, 3, '08:00', '18:00', 30, true),
    (v_workspace_id, v_user_id, 4, '08:00', '18:00', 30, true),
    (v_workspace_id, v_user_id, 5, '08:00', '16:00', 30, true);

  -- Receita -----------------------------------------------------------------
  insert into public.revenue_entries
    (workspace_id, account_id, appointment_id, amount, status, payment_method, entry_date)
  values
    (v_workspace_id, v_account_id, v_appointment_id, 300.00, 'confirmado', 'pix', current_date - 1),
    (v_workspace_id, v_account_id, null, 250.00, 'previsto', null, current_date + 2),
    (v_workspace_id, v_account_id, null, 150.00, 'previsto', null, current_date + 3);

  -- Campanhas de tráfego -------------------------------------------------
  insert into public.ad_campaigns
    (workspace_id, account_id, channel, campaign_name, period_start, period_end,
     spend, impressions, clicks, leads)
  values
    (v_workspace_id, v_account_id, 'instagram', 'Campanha Retorno de Verão',
     current_date - 30, current_date, 1200.00, 45000, 890, 32),
    (v_workspace_id, v_account_id, 'google', 'Busca - Clínica Geral SP',
     current_date - 15, current_date, 800.00, 12000, 450, 18);

  -- Lista de espera --------------------------------------------------------
  insert into public.waitlist
    (workspace_id, account_id, patient_name, patient_phone, doctor_id,
     preferred_days, preferred_times, status)
  values
    (v_workspace_id, v_account_id, 'Carlos Souza', '+5511954321098', v_user_id,
     '{segunda,quarta}', '{manha}', 'waiting');

  raise notice 'Seed concluído. account_id = %, workspace_id = %', v_account_id, v_workspace_id;
end $$;
