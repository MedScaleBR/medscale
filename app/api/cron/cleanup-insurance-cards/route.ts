import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/server'
import { INSURANCE_CARD_BUCKET } from '@/lib/bot/insurance-card'

const BATCH = 100

function insuranceCardRetentionDays(): number {
  const days = Number(process.env.INSURANCE_CARD_RETENTION_DAYS ?? 90)
  return Number.isFinite(days) && days >= 0 ? days : 90
}

// Disparado pelo Supabase pg_cron (ver supabase/cron.sql), 3h30 da manhã.
// Apaga do Storage as fotos de carteirinha com mais de
// INSURANCE_CARD_RETENTION_DAYS dias e marca deleted_at no registro.
export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const supabase = createAdminClient()
  const cutoff = new Date(Date.now() - insuranceCardRetentionDays() * 24 * 60 * 60 * 1000)

  const { data: old, error } = await supabase
    .from('conversation_attachments')
    .select('id, storage_path')
    .eq('kind', 'insurance_card')
    .is('deleted_at', null)
    .lte('created_at', cutoff.toISOString())
    .order('created_at')
    .limit(BATCH)

  if (error) {
    console.error('[cleanup-insurance-cards] query failed')
    return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  }
  if (!old?.length) return NextResponse.json({ deleted: 0 })

  const { error: storageError } = await supabase.storage.from(INSURANCE_CARD_BUCKET).remove(old.map((a) => a.storage_path))
  if (storageError) {
    console.error('[cleanup-insurance-cards] storage delete failed')
    return NextResponse.json({ error: 'storage_failed' }, { status: 500 })
  }

  await supabase
    .from('conversation_attachments')
    .update({ deleted_at: new Date().toISOString() })
    .in('id', old.map((a) => a.id))

  return NextResponse.json({ deleted: old.length })
}
