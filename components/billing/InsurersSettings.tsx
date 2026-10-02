'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { GUIDE_TYPE_LABELS } from '@/lib/billing/constants'
import { InsurerForm, type InsurerRow } from './InsurerForm'
import { ProcedureTable } from './ProcedureTable'
import { ProviderFields, type ProviderWorkspace } from './ProviderFields'

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

function scheduleLabel(i: InsurerRow): string {
  if (i.batch_weekdays.length === 0) return 'Só manual'
  return `${i.batch_weekdays.map((d) => WEEKDAYS[d]).join(', ')} às ${String(i.batch_hour).padStart(2, '0')}h`
}

export function InsurersSettings({
  initialInsurers,
  workspaces,
  billingEnabled,
}: {
  initialInsurers: InsurerRow[]
  workspaces: ProviderWorkspace[]
  billingEnabled: boolean
}) {
  const [insurers, setInsurers] = useState(initialInsurers)
  const [expanded, setExpanded] = useState<string | null>(initialInsurers[0]?.id ?? null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<InsurerRow | null>(null)

  const onSaved = (saved: InsurerRow) => {
    setInsurers((prev) => {
      const exists = prev.some((i) => i.id === saved.id)
      const next = exists ? prev.map((i) => (i.id === saved.id ? saved : i)) : [...prev, saved]
      return next.sort((a, b) => a.name.localeCompare(b.name))
    })
    setExpanded(saved.id)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-gray-900">{billingEnabled ? 'Operadoras' : 'Convênios aceitos'}</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              {billingEnabled
                ? 'Registro ANS, código do prestador, tabela de procedimentos e horário do lote de cada convênio.'
                : 'Convênios que a clínica atende — a Clara informa ao paciente.'}
            </p>
          </div>
          <Button
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
            className="gap-2 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            <Plus className="h-4 w-4" />
            Adicionar
          </Button>
        </div>
        <Separator className="my-4" />
        {insurers.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">Nenhum convênio cadastrado ainda.</p>
        ) : (
          <ul className="divide-y divide-[var(--navy-06)]">
            {insurers.map((i) => {
              const open = billingEnabled && expanded === i.id
              return (
                <li key={i.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={() => billingEnabled && setExpanded(open ? null : i.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      aria-expanded={billingEnabled ? open : undefined}
                    >
                      {billingEnabled &&
                        (open ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                        ))}
                      <span className="truncate text-sm font-medium text-gray-900">{i.name}</span>
                      {!i.is_active && (
                        <Badge className="border-none bg-[var(--navy-06)] text-gray-500">Inativa</Badge>
                      )}
                    </button>
                    {billingEnabled && i.ans_registry && i.provider_code && (
                      <span className="hidden text-xs text-gray-400 sm:inline">
                        ANS {i.ans_registry} · TISS {i.tiss_version} · {GUIDE_TYPE_LABELS[i.default_consult_guide]} ·{' '}
                        {scheduleLabel(i)}
                      </span>
                    )}
                    {billingEnabled && !(i.ans_registry && i.provider_code) && (
                      <Badge className="border-none bg-amber-50 text-amber-700">Falta ANS/código do prestador</Badge>
                    )}
                    <button
                      onClick={() => {
                        setEditing(i)
                        setFormOpen(true)
                      }}
                      className="text-gray-400 hover:text-gray-700"
                      aria-label={`Editar ${i.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {billingEnabled && open && (
                    <div className="mt-3 pl-6">
                      <ProcedureTable insurerId={i.id} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {billingEnabled && (
        <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
          <h2 className="text-sm font-medium text-gray-900">Dados do prestador</h2>
          <p className="mt-0.5 text-xs text-gray-400">
            Identificação da unidade nas guias TISS. O CRM, a UF do conselho e o CBO de cada médico ficam no perfil
            dele, em Configurações.
          </p>
          <Separator className="my-4" />
          <ProviderFields workspaces={workspaces} />
        </div>
      )}

      <InsurerForm
        open={formOpen}
        onOpenChange={setFormOpen}
        insurer={editing}
        onSaved={onSaved}
        billingEnabled={billingEnabled}
      />
    </div>
  )
}
