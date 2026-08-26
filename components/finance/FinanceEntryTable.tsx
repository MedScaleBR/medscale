import type { FinanceEntry } from '@/lib/finance/types'

// Sem paginação (v1) — limitado a 100 registros/mês, faixa em que médicos
// não costumam passar. Sem edição/exclusão nesta versão.
const MAX_ROWS = 100

export function FinanceEntryTable({ entries }: { entries: FinanceEntry[] }) {
  const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const rows = entries.slice(0, MAX_ROWS)

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
      {rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">Nenhum lançamento neste período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 text-left text-xs text-gray-400">
                <th className="px-5 py-3 font-normal">Data</th>
                <th className="px-5 py-3 font-normal">Descrição</th>
                <th className="px-5 py-3 font-normal">Categoria</th>
                <th className="px-5 py-3 font-normal">Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-[var(--navy-06)] last:border-0">
                  <td className="px-5 py-3 text-gray-600">
                    {new Date(e.entry_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-5 py-3 text-gray-600">{e.description ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-600">{e.category ?? '—'}</td>
                  <td className="px-5 py-3 font-medium text-gray-900">{formatBRL(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
