'use client'

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface CostsChartRow {
  name: string
  total: number
}

const formatBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })

/**
 * Custo por cliente, do mais caro para o mais barato. O corte é sempre por
 * período (feito por quem chama) — custo acumulado desde sempre não diz nada
 * sobre margem deste mês.
 */
export function CostsChart({ rows }: { rows: CostsChartRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
        <p className="py-12 text-center text-sm text-gray-400">Nenhum custo registrado no período.</p>
      </div>
    )
  }

  // A barra mais cara é a que interessa: é ela que come a margem.
  const max = Math.max(...rows.map((r) => r.total))

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <h2 className="mb-4 text-sm font-medium text-gray-900">Custo por cliente</h2>
      <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 36)}>
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
          <XAxis type="number" tickLine={false} axisLine={false} fontSize={12} stroke="#9CA3AF" tickFormatter={formatBRL} />
          <YAxis
            type="category"
            dataKey="name"
            tickLine={false}
            axisLine={false}
            fontSize={12}
            stroke="#9CA3AF"
            width={160}
          />
          <Tooltip formatter={(v) => formatBRL(Number(v ?? 0))} cursor={{ fill: 'var(--navy-06)' }} />
          <Bar dataKey="total" radius={[0, 6, 6, 0]} barSize={20}>
            {rows.map((r) => (
              <Cell key={r.name} fill={r.total === max ? 'var(--cyan-dark)' : 'var(--cyan)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
