import type { RevenueForecast as Forecast } from '@/lib/revenue/forecast'

const formatBRL = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function RevenueForecast({ forecast }: { forecast: Forecast | null }) {
  return (
    <section className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-gray-900">Previsibilidade de receita</h2>
          <p className="mt-1 text-xs text-gray-500">Mês atual · Quantidade de consultas × valor de cada procedimento</p>
        </div>
        {forecast && (
          <div className="text-right">
            <p className="text-2xl font-semibold text-[var(--navy)]">{formatBRL(forecast.total)}</p>
            <p className="text-xs text-gray-500">Receita estimada · {forecast.appointments} consultas particulares</p>
          </div>
        )}
      </div>
      {!forecast ? (
        <p className="mt-5 text-sm text-amber-700" role="status">Não foi possível carregar a previsão de receita. Atualize a página para tentar novamente.</p>
      ) : (
        <>
          {forecast.missingPrice > 0 && (
            <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              {forecast.missingPrice} consulta(s) sem valor informado. Preencha o valor na agenda para completar a previsão.
            </p>
          )}
          {forecast.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">Nenhuma consulta particular elegível neste mês.</p>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <caption className="sr-only">Previsão mensal por procedimento e valor registrado na consulta</caption>
                <thead>
                  <tr className="border-b border-[var(--navy-06)] text-left text-xs text-gray-500">
                    <th scope="col" className="pb-3 font-normal">Procedimento</th>
                    <th scope="col" className="pb-3 text-right font-normal">Consultas</th>
                    <th scope="col" className="pb-3 text-right font-normal">Valor unitário</th>
                    <th scope="col" className="pb-3 text-right font-normal">Receita estimada</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.rows.map((row) => (
                    <tr key={row.key} className="border-b border-[var(--navy-06)]">
                      <th scope="row" className="py-3 text-left font-medium text-gray-900">{row.name}</th>
                      <td className="py-3 text-right tabular-nums text-gray-600">{row.quantity}</td>
                      <td className="py-3 text-right tabular-nums text-gray-600">{row.unitPrice == null ? 'Sem valor' : formatBRL(row.unitPrice)}</td>
                      <td className="py-3 text-right tabular-nums font-medium text-gray-900">{row.unitPrice == null ? '—' : formatBRL(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-medium text-gray-900">
                    <th scope="row" className="pt-3 text-left">Total estimado</th>
                    <td className="pt-3 text-right tabular-nums">{forecast.appointments}</td>
                    <td />
                    <td className="pt-3 text-right tabular-nums">{formatBRL(forecast.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="mt-4 text-xs leading-relaxed text-gray-500">
            Considera consultas agendadas, confirmadas e realizadas no mês, com o valor registrado na agenda.
            Cancelamentos, faltas e convênios ficam fora do cálculo. A estimativa não representa pagamentos recebidos.
            {forecast.insurance > 0 && ` ${forecast.insurance} consulta(s) por convênio fora da previsão.`}
          </p>
        </>
      )}
    </section>
  )
}
