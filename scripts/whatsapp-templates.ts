/**
 * Cria os templates do WhatsApp (lib/meta/whatsapp-templates.ts) no WABA de
 * cada clínica já conectada. Conexões novas já ganham os templates no
 * Embedded Signup; isto cobre as antigas. Idempotente.
 *
 *   npm run whatsapp:templates
 *
 * Lê NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e TOKEN_ENCRYPTION_KEY
 * do .env.local — aponte para o projeto (dev ou prod) que quer ajustar.
 */
import { createClient } from '@supabase/supabase-js'
import { decryptToken } from '../lib/crypto'
import { ensureWhatsAppTemplates } from '../lib/meta/whatsapp-templates'

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: configs, error } = await supabase
    .from('bot_config')
    .select('account_id, waba_id, meta_token')
    .not('waba_id', 'is', null)
    .not('meta_token', 'is', null)

  if (error) throw new Error(error.message)
  if (!configs?.length) {
    console.log('Nenhuma clínica com WhatsApp conectado.')
    return
  }

  let failures = 0
  for (const c of configs) {
    const r = await ensureWhatsAppTemplates(c.waba_id, decryptToken(c.meta_token))
    console.log(`conta ${c.account_id} (WABA ${c.waba_id})`)
    if (r.created.length) console.log(`  criados: ${r.created.join(', ')}`)
    if (r.existing.length) console.log(`  já existiam: ${r.existing.join(', ')}`)
    for (const f of r.failed) console.log(`  FALHOU ${f.name}: ${f.error}`)
    failures += r.failed.length
  }

  if (failures > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
