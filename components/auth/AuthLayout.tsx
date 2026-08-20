import Image from 'next/image'
import { CalendarCheck, MessageCircle, TrendingUp } from 'lucide-react'

const FEATURES = [
  { icon: CalendarCheck, text: 'Agenda sincronizada com o Google Calendar' },
  { icon: MessageCircle, text: 'Agente de WhatsApp que agenda consultas sozinho' },
  { icon: TrendingUp, text: 'Receita, tráfego pago e métricas num só painel' },
]

interface AuthLayoutProps {
  title: string
  subtitle: string
  children: React.ReactNode
  footer?: React.ReactNode
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen">
      {/* Painel de marca — oculto em telas pequenas */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-[var(--navy-dark)] p-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              'radial-gradient(circle at 15% 15%, var(--cyan-20), transparent 40%), radial-gradient(circle at 85% 75%, var(--cyan-10), transparent 45%)',
          }}
        />

        <div className="relative flex items-center gap-2.5">
          <div className="flex h-9 items-center justify-center rounded-xl bg-white px-2">
            <Image src="/logo-icon.png" alt="MedScale" width={138} height={96} className="h-5 w-auto" priority />
          </div>
          <span className="text-lg font-semibold">MedScale</span>
        </div>

        <div className="relative">
          <h1 className="max-w-md text-3xl font-medium leading-tight text-balance">
            Sua clínica, organizada do agendamento à receita.
          </h1>
          <p className="mt-4 max-w-sm text-sm text-[var(--w70)]">
            O painel completo para médicos autônomos e pequenas clínicas gerenciarem agenda,
            pacientes e o atendimento automático via WhatsApp.
          </p>

          <ul className="mt-10 space-y-4">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-[var(--w70)]">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--w10)]">
                  <Icon className="h-4 w-4 text-[var(--cyan)]" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-[var(--w60)]">MedScale © {new Date().getFullYear()}</p>
      </div>

      {/* Painel do formulário */}
      <div className="flex w-full flex-col items-center justify-center bg-[var(--navy-06)] px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Image src="/logo-icon.png" alt="MedScale" width={138} height={96} className="h-8 w-auto" priority />
            <span className="text-lg font-semibold text-[var(--navy-dark)]">MedScale</span>
          </div>

          <div className="rounded-2xl border border-[var(--navy-06)] bg-white p-8 shadow-[var(--shadow-lg)]">
            <div className="mb-6">
              <h2 className="text-xl font-medium text-gray-900">{title}</h2>
              <p className="mt-1 text-sm text-gray-400">{subtitle}</p>
            </div>
            {children}
          </div>

          {footer && <div className="mt-6 text-center text-sm text-gray-500">{footer}</div>}
        </div>
      </div>
    </div>
  )
}
