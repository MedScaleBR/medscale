-- /bot lista as conversas de todas as unidades da account, inclusive as que
-- ainda não têm unidade (a Clara só grava workspace_id quando o paciente
-- confirma a unidade).
--
-- Antes, a RLS de conversations só liberava workspace_id = uma das minhas
-- unidades: conversa sem unidade (workspace_id null) era invisível no painel.
-- Agora quem é membro ativo da account também enxerga e pode agir nas
-- conversas sem unidade dela. Quem tem acesso restrito a algumas unidades
-- continua sem ver as conversas das outras.
--
-- O WITH CHECK inclui account_id: com workspace_id null, a trigger
-- trg_enforce_ws_account não deriva o account_id. Idempotente.

begin;

drop policy if exists "conversations: workspace members" on public.conversations;
create policy "conversations: workspace members" on public.conversations
  for all
  using (
    workspace_id = any(public.my_workspace_ids())
    or (workspace_id is null and account_id = any(public.my_account_ids()))
  )
  with check (
    (workspace_id = any(public.my_workspace_ids()) and account_id = any(public.my_account_ids()))
    or (workspace_id is null and account_id = any(public.my_account_ids()))
  );

drop policy if exists "messages: via conversation" on public.messages;
create policy "messages: via conversation" on public.messages
  for all using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (
          c.workspace_id = any(public.my_workspace_ids())
          or (c.workspace_id is null and c.account_id = any(public.my_account_ids()))
        )
    )
  );

drop policy if exists "conversation_attachments: workspace members read" on public.conversation_attachments;
create policy "conversation_attachments: workspace members read" on public.conversation_attachments
  for select using (
    exists (
      select 1 from public.conversations c
       where c.id = conversation_id
         and (
           c.workspace_id = any(public.my_workspace_ids())
           or (c.workspace_id is null and c.account_id = any(public.my_account_ids()))
         )
    )
  );

commit;
