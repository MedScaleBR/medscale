import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { isDate } from '@/lib/billing/validation'
import { GUIDE_COLUMNS } from '@/lib/billing/constants'
import type { GuideStatus } from '@/lib/billing/types'

const STATUSES: GuideStatus[] = ['draft', 'ready', 'batched', 'sent', 'cancelled']
const PAGE_SIZE = 50

// Owner/admin. Filtros: ?status=draft,ready &insurer_id= &from=YYYY-MM-DD
// &to=YYYY-MM-DD (data do atendimento) &page=1
export async function GET(req: NextRequest) {
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session } = result

  const sp = req.nextUrl.searchParams
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const statuses = (sp.get('status') ?? '')
    .split(',')
    .filter((s): s is GuideStatus => (STATUSES as string[]).includes(s))

  const supabase = await createClient()
  let query = supabase
    .from('tiss_guides')
    .select(GUIDE_COLUMNS, { count: 'exact' })
    .eq('account_id', session.accountId)
    .order('service_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

  if (statuses.length > 0) query = query.in('status', statuses)
  if (sp.get('insurer_id')) query = query.eq('insurer_id', sp.get('insurer_id')!)
  if (isDate(sp.get('from'))) query = query.gte('service_date', sp.get('from')!)
  if (isDate(sp.get('to'))) query = query.lte('service_date', sp.get('to')!)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ guides: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE })
}
