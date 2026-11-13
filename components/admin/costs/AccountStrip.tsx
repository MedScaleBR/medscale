import Link from 'next/link'
import { cn } from '@/lib/utils'
import { formatBRL } from '@/lib/finance/summary'

// Cor do círculo da inicial: estável por cliente, para o olho aprender.
const AVATAR_COLORS = ['#00b8d4', '#7c4dff', '#ff7043', '#43a047', '#e53935', '#f9a825']

function colorFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

/** Faixa de clientes no estilo de abas de navegador; o selecionado fica destacado. */
export function AccountStrip({
  accounts,
  selectedId,
  hrefFor,
}: {
  accounts: { accountId: string; name: string; total: number }[]
  selectedId: string | null
  hrefFor: (accountId: string) => string
}) {
  return (
    <nav aria-label="Clientes" className="overflow-x-auto rounded-xl bg-[var(--navy-dark)] p-1.5">
      <ul className="flex w-max gap-1">
        {accounts.map((a) => {
          const selected = a.accountId === selectedId
          return (
            <li key={a.accountId}>
              <Link
                href={hrefFor(a.accountId)}
                aria-current={selected ? 'page' : undefined}
                title={a.name}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--cyan)]',
                  selected ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white/90',
                )}
              >
                <span
                  aria-hidden
                  className="flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                  style={{ background: colorFor(a.accountId) }}
                >
                  {a.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="max-w-48 truncate">{a.name}</span>
                <span className={cn('tabular-nums', selected ? 'text-white/70' : 'text-white/40')}>
                  {formatBRL(a.total)}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
