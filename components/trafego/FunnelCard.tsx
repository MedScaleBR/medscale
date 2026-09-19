import type { FunnelStep } from '@/lib/trafego/funnel'

// Barras horizontais e não um funil desenhado: o trapézio clássico distorce a
// leitura (a área não é proporcional ao número) e não cabe na coluna estreita
// ao lado do gráfico.
export function FunnelCard({ steps, days }: { steps: FunnelStep[]; days: number }) {
  const empty = steps[0].value === 0

  return (
    <div className="rounded-[14px] border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--text-strong)]">Funil de conversão</h2>
        <span className="text-xs text-[var(--text-muted)]">Leads vindos de anúncio</span>
      </div>

      {empty ? (
        <p className="py-12 text-center text-sm text-[var(--text-muted)]">
          Nenhum lead atribuído a anúncio neste período.
        </p>
      ) : (
        <div className="space-y-3">
          {steps.map((step) => (
            <div key={step.label}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-[var(--text-muted)]">{step.label}</span>
                <span className="text-xs font-medium text-[var(--text-strong)]">
                  {step.value}
                  <span className="ml-1.5 font-normal text-[var(--text-muted)]">
                    {Math.round(step.pct)}%
                  </span>
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-[var(--navy-06)]">
                <div
                  className="h-2 rounded-full bg-[var(--cyan)]"
                  // Mínimo visível: uma etapa com 1 lead em 400 sumiria e
                  // pareceria zero, que é outra informação.
                  style={{ width: `${step.value > 0 ? Math.max(2, step.pct) : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* O lead de ontem ainda não teve tempo de virar consulta: em 7 dias a
          conversão sai artificialmente baixa e leva a desligar campanha boa. */}
      {days === 7 && (
        <p className="mt-4 text-xs text-[var(--text-muted)]">
          Leads dos últimos 7 dias ainda não tiveram tempo de virar consulta. Use 30 ou 90 dias para
          ler conversão.
        </p>
      )}
    </div>
  )
}
