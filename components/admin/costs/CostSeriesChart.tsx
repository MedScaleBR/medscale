'use client'

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatBRL } from '@/lib/finance/summary'
import { PROVIDER_GROUP_LABELS } from '@/lib/costs/aggregate'
import type { SeriesPoint } from '@/lib/costs/account-detail'

// Mesmas cores das barras do painel Geral: Claude navy, Whisper ciano,
// WhatsApp navy translúcido.
const SERIES = [
  { key: 'claude', fill: 'var(--navy-dark)' },
  { key: 'whisper', fill: 'var(--cyan)' },
  { key: 'whatsapp', fill: 'color-mix(in srgb, var(--navy) 20%, transparent)' },
] as const

export function CostSeriesChart({ mode, points }: { mode: 'day' | 'hour'; points: SeriesPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={points} barCategoryGap={mode === 'hour' ? 2 : '20%'}>
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          fontSize={11}
          stroke="#9CA3AF"
          interval="preserveStartEnd"
          minTickGap={12}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          fontSize={11}
          stroke="#9CA3AF"
          width={70}
          tickFormatter={(v) => formatBRL(Number(v))}
        />
        <Tooltip
          cursor={{ fill: 'var(--navy-06)' }}
          formatter={(v, name) => [
            formatBRL(Number(v ?? 0)),
            PROVIDER_GROUP_LABELS[name as keyof typeof PROVIDER_GROUP_LABELS] ?? name,
          ]}
          labelFormatter={(label, payload) => {
            const total = payload?.[0]?.payload?.total ?? 0
            return `${label} · ${formatBRL(Number(total))}`
          }}
        />
        {/* Sem cantos arredondados: numa pilha, só a série do topo arredondaria, e o
            topo muda de dia para dia (nem todo dia tem WhatsApp). */}
        {SERIES.map((s) => (
          <Bar key={s.key} dataKey={s.key} stackId="custo" fill={s.fill} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
