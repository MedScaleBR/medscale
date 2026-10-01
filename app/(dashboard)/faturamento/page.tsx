import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GuidesTable } from '@/components/billing/GuidesTable'
import { BatchesTable } from '@/components/billing/BatchesTable'

export default async function FaturamentoPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  // Guias e lotes TISS: owner e admin (secretária/gestão). member não.
  if (session.role === 'member' || !session.accountModules.includes('billing')) {
    redirect('/dashboard')
  }

  const supabase = await createClient()
  const { data: insurers } = await supabase
    .from('health_insurers')
    .select('id, name')
    .eq('account_id', session.accountId)
    .order('name')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Faturamento</h1>
        <p className="text-sm text-gray-400">
          Guias TISS das consultas de convênio e lotes XML para enviar às operadoras.
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
        <Tabs defaultValue="guides">
          <TabsList>
            <TabsTrigger value="guides">Guias</TabsTrigger>
            <TabsTrigger value="batches">Lotes</TabsTrigger>
          </TabsList>
          <TabsContent value="guides" className="pt-4">
            <GuidesTable insurers={insurers} />
          </TabsContent>
          <TabsContent value="batches" className="pt-4">
            <BatchesTable insurers={insurers} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
