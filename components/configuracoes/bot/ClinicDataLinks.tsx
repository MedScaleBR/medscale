import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export interface ClinicData {
  serviceNames: string[]
  insurerNames: string[]
  unitCount: number
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// Dados da clínica que a Clara usa, editados nas páginas próprias.
export function ClinicDataLinks({ data }: { data: ClinicData }) {
  const links = [
    { href: '/configuracoes/servicos', label: 'Serviços', detail: plural(data.serviceNames.length, 'procedimento', 'procedimentos') },
    { href: '/configuracoes/convenios', label: 'Convênios', detail: plural(data.insurerNames.length, 'convênio', 'convênios') },
    { href: '/locais', label: 'Unidades', detail: plural(data.unitCount, 'unidade', 'unidades') },
  ]
  return (
    <section className="mb-6 break-inside-avoid rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Dados que a Clara usa</h3>
      <p className="mb-3 text-xs text-gray-400">Procedimentos, preços, convênios e endereços ficam nas páginas de cada um.</p>
      <ul className="divide-y divide-[var(--navy-06)]">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex items-center justify-between py-2.5 text-sm text-gray-900 hover:text-[var(--cyan-dark)]">
              <span>
                {l.label} <span className="ml-1 text-xs text-gray-400">{l.detail}</span>
              </span>
              <ArrowRight className="h-4 w-4 text-gray-400" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
