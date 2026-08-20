interface NoShowMeterProps {
  rate: number
  total: number
}

export function NoShowMeter({ rate, total }: NoShowMeterProps) {
  const alert = rate >= 15

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <h2 className="mb-4 text-sm font-medium text-gray-900">Taxa de no-show</h2>
      <div className="flex items-end gap-2">
        <span className={`text-3xl font-medium ${alert ? 'text-red-500' : 'text-gray-900'}`}>{rate}%</span>
        <span className="mb-1 text-xs text-gray-400">{total} no-shows este mês</span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--navy-06)]">
        <div
          className={`h-full rounded-full transition-all ${alert ? 'bg-red-500' : 'bg-[var(--cyan)]'}`}
          style={{ width: `${Math.min(rate, 100)}%` }}
        />
      </div>
      {alert && <p className="mt-2 text-xs text-red-500">Acima do recomendado (15%) — considere reforçar lembretes.</p>}
    </div>
  )
}
