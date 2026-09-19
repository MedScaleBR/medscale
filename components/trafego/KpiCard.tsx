import type { LucideIcon } from 'lucide-react'

// O design traz uma barrinha sob o número, mas com largura cravada (100, 82,
// 46) — decoração sem escala. Só entra quem tem denominador de verdade, via
// `bar`: barra sem escala sugere uma proporção que não existe.
export function KpiCard({
  label,
  value,
  icon: Icon,
  bar,
}: {
  label: string
  value: string
  icon: LucideIcon
  /** `pct` de 0 a 100, já calculado contra uma escala explicada por quem chama. */
  bar?: { pct: number; color: string }
}) {
  return (
    <div className="rounded-[14px] border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
      </div>
      <p className="mt-2 text-2xl font-medium text-[var(--text-strong)]">{value}</p>
      {bar && (
        <div className="mt-3 h-1.5 rounded-full bg-[var(--navy-06)]">
          <div
            className="h-1.5 rounded-full"
            style={{ width: `${bar.pct}%`, backgroundColor: bar.color }}
          />
        </div>
      )}
    </div>
  )
}
