import { ClaraTabs } from '@/components/admin/clara/ClaraTabs'

// /admin/clara — ferramentas internas da Clara. O layout de /admin já exige
// is_medscale_admin(); as rotas de API conferem de novo.
export default function AdminClaraLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Clara</h1>
        <p className="text-sm text-gray-400">Teste a Clara de qualquer account e mantenha os modelos de configuração.</p>
      </div>
      <ClaraTabs />
      {children}
    </div>
  )
}
