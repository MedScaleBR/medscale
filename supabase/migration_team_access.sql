-- Migração incremental: Receita exclusiva do owner + convite/módulos por
-- membro geridos pelo owner (self-service, sem depender do /admin interno).
-- Rode isto no SQL Editor — NÃO rode supabase/schema.sql inteiro (é "drop
-- and recreate" e apagaria os dados existentes). Este conteúdo já foi
-- incorporado em supabase/schema.sql, que continua sendo a fonte de verdade
-- para reconstruções completas do zero.

-- ============================================================
-- Receita (revenue_entries) passa a ser exclusiva do owner — mesmo padrão
-- já usado por finance_entries. Antes, qualquer membro da workspace podia
-- ler/escrever via RLS.
-- ============================================================
drop policy if exists "revenue_entries: workspace members" on public.revenue_entries;

create policy "revenue_entries: owner only" on public.revenue_entries
  for all using (public.is_account_owner(account_id));

-- Nenhuma mudança de schema é necessária para convites/module_overrides —
-- as tabelas `invites` e `memberships.module_overrides` já existem, e a
-- policy "invites: admin manage" / "memberships: admin manage" (is_account_
-- admin, que inclui owner) já cobre o que as novas rotas em
-- app/api/memberships/* precisam. A restrição a "só owner" (não admin) é
-- aplicada na camada de API, não na RLS.
