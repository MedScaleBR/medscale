import type { Bucket } from '@/lib/trafego/aggregate'

// Série única: sem legenda (o título já diz o que é) e com rótulo direto em
// cada barra, que aqui cabe porque são no máximo sete.
export function LeadsChart({ buckets, subtitle }: { buckets: Bucket[]; subtitle: string }) {
  const max = Math.max(...buckets.map((b) => b.leads), 1)
  const empty = buckets.every((b) => b.leads === 0)

  return (
    <div className="rounded-[14px] border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--text-strong)]">Leads por período</h2>
        <span className="text-xs text-[var(--text-muted)]">{subtitle}</span>
      </div>

      {empty ? (
        <p className="py-12 text-center text-sm text-[var(--text-muted)]">
          Nenhum lead registrado neste período.
        </p>
      ) : (
        <div className="flex h-40 items-end gap-4 px-1">
          {buckets.map((bucket, index) => (
            <div
              key={`${bucket.label}-${index}`}
              className="flex h-full flex-1 flex-col items-center justify-end gap-2"
              title={`${bucket.label}: ${bucket.leads} leads`}
            >
              <span className="text-xs font-medium text-[var(--text-strong)]">{bucket.leads}</span>
              <div
                className="w-full max-w-9 rounded-t-md bg-[var(--cyan)]"
                style={{ height: `${Math.max(8, Math.round((bucket.leads / max) * 120))}px` }}
              />
              <span className="text-xs text-[var(--text-muted)]">{bucket.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
