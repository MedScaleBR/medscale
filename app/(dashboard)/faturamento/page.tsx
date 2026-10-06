import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GuidesTable } from '@/components/billing/GuidesTable'
import { BatchesTable } from '@/components/billing/BatchesTable'
import { isAuthorizationType } from '@/lib/billing/authorizations/status'

const TABS = ['autorizacoes', 'guias', 'lotes'] as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Só strings valem; arrays (?x=1&x=2) e ausentes viram undefined.
function single(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function uuidOrUndefined(v: string | undefined): string | undefined {
  return v && UUID_RE.test(v) ? v : undefined
}

export default async function FaturamentoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await resolveActiveSession()
  if (!session) return null

  // Convênios / TISS: owner e admin (secretária/gestão). member não.
  if (session.role === 'member' || !session.accountModules.includes('billing')) {
    redirect('/dashboard')
  }

  const params = await searchParams
  const tab = single(params.tab)
  const nova = single(params.nova)
  // OPME nasce do pai (SP/SADT ou internação), nunca direto da URL.
  const newType = nova && isAuthorizationType(nova) && nova !== 'opme_request' ? nova : undefined
  const appointmentId = uuidOrUndefined(single(params.appointment_id))
  const openId = uuidOrUndefined(single(params.autorizacao))
  // Consumidos pela AuthorizationsTable (Tarefa 16).
  void newType
  void appointmentId
  void openId

  const supabase = await createClient()
  const { data: insurers } = await supabase
    .from('health_insurers')
    .select('id, name')
    .eq('account_id', session.accountId)
    .order('name')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Convênios / TISS</h1>
        <p className="text-sm text-gray-400">
          Autorizações prévias (SP/SADT, internação e OPME), guias TISS das consultas de convênio e
          lotes XML para as operadoras.
        </p>
      </div>

      {!insurers || insurers.length === 0 ? (
        <div className="rounded-xl border border-[var(--navy-06)] bg-white p-8 text-center text-sm text-gray-500 shadow-[var(--shadow-sm)]">
          Cadastre as operadoras em{' '}
          <Link href="/configuracoes/convenios" className="text-[var(--cyan-dark)] underline">
            Configurações → Convênios
          </Link>{' '}
          para começar a faturar.
        </div>
      ) : (
        <Tabs defaultValue={TABS.find((t) => t === tab) ?? 'autorizacoes'}>
          <TabsList>
            <TabsTrigger value="autorizacoes">Autorizações</TabsTrigger>
            <TabsTrigger value="guias">Guias</TabsTrigger>
            <TabsTrigger value="lotes">Lotes</TabsTrigger>
          </TabsList>
          <TabsContent value="autorizacoes" className="pt-4">
            {/* AuthorizationsTable entra na Tarefa 16 */}
            {null}
          </TabsContent>
          <TabsContent value="guias" className="pt-4">
            <GuidesTable insurers={insurers} />
          </TabsContent>
          <TabsContent value="lotes" className="pt-4">
            <BatchesTable insurers={insurers} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
