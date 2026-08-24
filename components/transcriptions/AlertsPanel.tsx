import { TriangleAlert } from 'lucide-react'

export function AlertsPanel({ alertas }: { alertas: string[] }) {
  if (alertas.length === 0) return null

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-800">
        <TriangleAlert className="h-4 w-4" />
        Campos não mencionados na gravação
      </div>
      <ul className="space-y-1 pl-6 text-sm text-amber-800">
        {alertas.map((alerta, i) => (
          <li key={i} className="list-disc">
            {alerta}
          </li>
        ))}
      </ul>
    </div>
  )
}
