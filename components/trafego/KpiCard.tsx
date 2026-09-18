import type { LucideIcon } from 'lucide-react'

// O design traz uma barrinha sob o número, mas com largura cravada (100, 82,
// 46) — decoração sem escala. Fica de fora: barra sem denominador sugere uma
// proporção que não existe.
export function KpiCard({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <div className="rounded-[14px] border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
      </div>
      <p className="mt-2 text-2xl font-medium text-[var(--text-strong)]">{value}</p>
    </div>
  )
}
