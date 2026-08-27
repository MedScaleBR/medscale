'use client'

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

interface RevenueChartProps {
  projected: number
  realized: number
  received: number
}

export function RevenueChart({ projected, realized, received }: RevenueChartProps) {
  const data = [
    { name: 'Previsto', value: projected },
    { name: 'Realizado', value: realized },
    { name: 'Recebido', value: received },
  ]

  const formatBRL = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-900">Receita do mês</h2>
        <span className="text-lg font-medium text-gray-900">{formatBRL(projected)}</span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} barSize={48}>
          <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} stroke="#9CA3AF" />
          <YAxis tickLine={false} axisLine={false} fontSize={12} stroke="#9CA3AF" tickFormatter={formatBRL} width={70} />
          <Tooltip formatter={(v) => formatBRL(Number(v ?? 0))} cursor={{ fill: 'var(--navy-06)' }} />
          <Bar dataKey="value" fill="var(--cyan)" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
