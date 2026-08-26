'use client'

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

interface FinanceCategoryChartProps {
  data: { category: string; total: number }[]
}

export function FinanceCategoryChart({ data }: FinanceCategoryChartProps) {
  const formatBRL = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
        <p className="text-sm text-gray-400">Sem lançamentos neste período.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <h2 className="mb-4 text-sm font-medium text-gray-900">Por categoria</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} barSize={32}>
          <XAxis dataKey="category" tickLine={false} axisLine={false} fontSize={11} stroke="#9CA3AF" />
          <YAxis tickLine={false} axisLine={false} fontSize={12} stroke="#9CA3AF" tickFormatter={formatBRL} width={70} />
          <Tooltip formatter={(v) => formatBRL(Number(v ?? 0))} cursor={{ fill: 'var(--navy-06)' }} />
          <Bar dataKey="total" fill="var(--cyan)" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
