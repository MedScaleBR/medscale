import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { InsurersSettings } from '@/components/billing/InsurersSettings'
import type { InsurerRow } from '@/components/billing/InsurerForm'
import { AcceptsPrivateToggle } from '@/components/configuracoes/AcceptsPrivateToggle'

export default async function ConveniosSettingsPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  // Convênios: owner/admin. Sem o módulo billing é só a lista que a Clara informa; com ele, entram os dados TISS.
  if (session.role === 'member') redirect('/configuracoes')
  const billingEnabled = session.accountModules.includes('billing')

  const supabase = await createClient()
  const [{ data: insurers }, { data: workspaces }, { data: botConfig }] = await Promise.all([
    supabase
      .from('health_insurers')
      .select(
        'id, name, ans_registry, provider_code, tiss_version, default_consult_guide, batch_weekdays, batch_hour, max_guides_per_batch, is_active',
      )
      .eq('account_id', session.accountId)
      .order('name'),
    supabase
      .from('workspaces')
      .select('id, name, cnes, cnpj, legal_name')
      .eq('account_id', session.accountId)
      .eq('is_active', true)
      .order('display_order'),
    supabase.from('bot_config').select('accepts_private').eq('account_id', session.accountId).maybeSingle(),
  ])

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href="/configuracoes"
          className="mb-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Configurações
        </Link>
        <h1 className="text-xl font-medium text-gray-900">Convênios</h1>
        <p className="text-sm text-gray-400">
          {billingEnabled
            ? 'Operadoras, tabela TUSS e dados do prestador para o faturamento TISS.'
            : 'Convênios aceitos e atendimento particular — a Clara usa estas informações com o paciente.'}
        </p>
      </div>

      <AcceptsPrivateToggle initialValue={botConfig?.accepts_private ?? true} />

      <InsurersSettings
        initialInsurers={(insurers ?? []) as InsurerRow[]}
        workspaces={workspaces ?? []}
        billingEnabled={billingEnabled}
      />
    </div>
  )
}
