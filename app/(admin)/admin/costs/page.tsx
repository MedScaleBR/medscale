import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CostsChart } from '@/components/admin/CostsChart'
import {
  summarizeCosts,
  detectLoopAlerts,
  detectExpensiveAccountAlerts,
  PROVIDER_LABELS,
  PROVIDER_ORDER,
  type CostEventRow,
} from '@/lib/costs/aggregate'

// Painel interno: quanto a MedScale gasta de custo variável (Claude, Whisper e
// as janelas de WhatsApp que pagamos à Meta) para atender cada cliente. Não é
// o que o cliente paga — é o que ele custa. O acesso é barrado pela policy de
// RLS de cost_events (só is_medscale_admin lê) e pelo layout de /admin.

const PERIODS = [7, 30, 90] as const
const DEFAULT_DAYS = 30

// Teto de segurança: o painel agrega em memória. Se algum dia bater neste
// número, a agregação precisa virar SQL — não aumentar o limite.
const MAX_EVENTS = 50_000

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default async function AdminCostsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: daysParam } = await searchParams
  const days = PERIODS.includes(Number(daysParam) as (typeof PERIODS)[number]) ? Number(daysParam) : DEFAULT_DAYS
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const supabase = await createClient()

  // Tudo sai de cost_events: os dois sinais de bot mal configurado são
  // deriváveis do próprio custo, sem ler conversa nem telefone de paciente.
  const { data: eventRows, error } = await supabase
    .from('cost_events')
    .select('provider, cost_brl, account_id, workspace_id, related_id, accounts(name), workspaces(name)')
    .gte('created_at', since)
    .limit(MAX_EVENTS)

  if (error) console.error('Erro ao buscar custos:', error.message)

  const events = (eventRows ?? []) as unknown as CostEventRow[]
  const summary = summarizeCosts(events)
  const alerts = [...detectLoopAlerts(events), ...detectExpensiveAccountAlerts(events)]

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Custos</h1>
          <p className="text-sm text-gray-400">
            Custo variável da MedScale por cliente — Claude, Whisper e conversas de WhatsApp que pagamos à Meta
          </p>
        </div>
        <nav className="flex items-center gap-1 text-xs">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/admin/costs?days=${p}`}
              className={
                p === days
                  ? 'rounded-md bg-[var(--navy-dark)] px-2.5 py-1.5 font-medium text-white'
                  : 'rounded-md px-2.5 py-1.5 text-gray-400 hover:text-gray-900'
              }
            >
              {p} dias
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
          <p className="text-xs text-gray-400">Total no período</p>
          <p className="mt-1 text-2xl font-medium text-gray-900">{brl(summary.total)}</p>
        </div>
        {PROVIDER_ORDER.filter((p) => summary.byProvider[p] > 0).map((p) => (
          <div key={p} className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
            <p className="text-xs text-gray-400">{PROVIDER_LABELS[p]}</p>
            <p className="mt-1 text-2xl font-medium text-gray-900">{brl(summary.byProvider[p])}</p>
          </div>
        ))}
      </div>

      {alerts.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50">
          <div className="border-b border-amber-200 px-5 py-3">
            <h2 className="text-sm font-medium text-amber-900">Possível bot mal configurado</h2>
            <p className="text-xs text-amber-700">
              Conversas que giram sem fechar, ou cliente cuja conversa média sai cara demais — custo que não vira
              agendamento
            </p>
          </div>
          <ul className="divide-y divide-amber-200">
            {alerts.map((a) => (
              <li key={`${a.kind}-${a.accountId}`} className="flex items-center justify-between gap-4 px-5 py-3">
                <p className="text-sm text-amber-900">
                  <Link href={`/admin/accounts/${a.accountId}`} className="font-medium hover:underline">
                    {a.accountName}
                  </Link>
                  {' — '}
                  {a.detail}
                </p>
                {a.cost > 0 && <span className="shrink-0 text-sm text-amber-900">{brl(a.cost)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <CostsChart rows={summary.accounts.map((a) => ({ name: a.name, total: a.total }))} />

      <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        <div className="border-b border-[var(--navy-06)] px-5 py-3">
          <h2 className="text-sm font-medium text-gray-900">Detalhe por cliente</h2>
        </div>
        {summary.accounts.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">Nenhum custo registrado no período.</p>
        ) : (
          <ul className="divide-y divide-[var(--navy-06)]">
            {summary.accounts.map((account) => (
              <li key={account.accountId} className="px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Link
                    href={`/admin/accounts/${account.accountId}`}
                    className="text-sm font-medium text-gray-900 hover:text-[var(--cyan-dark)]"
                  >
                    {account.name}
                  </Link>
                  <span className="text-sm font-medium text-gray-900">{brl(account.total)}</span>
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  {PROVIDER_ORDER.filter((p) => account.byProvider[p] > 0)
                    .map((p) => `${PROVIDER_LABELS[p]}: ${brl(account.byProvider[p])}`)
                    .join(' · ')}
                </p>
                {account.units.length > 1 && (
                  <ul className="mt-2 space-y-1">
                    {account.units.map((unit) => (
                      <li key={unit.workspaceId ?? 'none'} className="flex justify-between text-xs text-gray-400">
                        <span>{unit.name}</span>
                        <span>{brl(unit.total)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
