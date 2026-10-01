import { createAdminClient } from '@/lib/supabase/server'

export const TISS_BUCKET = 'tiss-batches'

// Exceção aprovada para o bucket sem policies de usuário. Este helper só
// expõe Storage; as rotas verificam owner/admin antes de chamá-lo e usam
// createClient/RLS para todas as consultas e alterações no banco.
export function createBillingStorage() {
  return createAdminClient().storage.from(TISS_BUCKET)
}

export type TissStorage = ReturnType<typeof createBillingStorage>
