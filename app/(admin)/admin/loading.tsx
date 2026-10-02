import { Skeleton } from '@/components/ui/skeleton'

// Esqueleto genérico das rotas do admin que não têm loading próprio:
// título + subtítulo, faixa de cards e um bloco de lista.
export default function AdminLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only" role="status">
        Carregando…
      </span>
      <div className="space-y-2">
        <Skeleton className="h-6 w-40 bg-white" />
        <Skeleton className="h-4 w-72 bg-white" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl bg-white shadow-[var(--shadow-sm)]" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl bg-white shadow-[var(--shadow-sm)]" />
    </div>
  )
}
