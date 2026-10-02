import { Skeleton } from '@/components/ui/skeleton'

const CARDS_PER_COLUMN = [3, 2, 2, 1]

export default function AdminTasksLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Carregando tarefas">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-28 rounded-[10px] bg-[var(--navy-06)]" />
          <Skeleton className="h-4 w-72 rounded-[10px] bg-[var(--navy-06)]" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-36 rounded-[10px] bg-[var(--navy-06)]" />
          <Skeleton className="h-9 w-32 rounded-[10px] bg-[var(--navy-06)]" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-full rounded-[10px] bg-[var(--navy-06)] sm:w-64" />
        <Skeleton className="h-9 w-40 rounded-full bg-[var(--navy-06)]" />
        <Skeleton className="h-9 w-28 rounded-full bg-[var(--navy-06)]" />
        <Skeleton className="h-9 w-28 rounded-full bg-[var(--navy-06)]" />
      </div>

      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 lg:grid-cols-4">
        {CARDS_PER_COLUMN.map((cards, column) => (
          <div key={column} className="flex flex-col gap-2 rounded-[14px] bg-[var(--navy-06)] p-3">
            <Skeleton className="mb-1 h-5 w-24 rounded-[10px] bg-white/70" />
            {Array.from({ length: cards }, (_, i) => (
              <Skeleton
                key={i}
                className="h-24 rounded-[10px] border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
