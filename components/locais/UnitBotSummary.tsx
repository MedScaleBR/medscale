import { INTAKE_FIELD_LABELS, SCHEDULING_MODE_SUMMARY, type WorkspaceBotSettings } from '@/lib/bot/unit-settings'

// Resumo somente leitura para owner/admin do cliente. Sem as instruções nem os
// metadados de alteração — isso fica em /admin, com a equipe MedScale.
export function UnitBotSummary({ settings }: { settings: Pick<WorkspaceBotSettings, 'schedulingMode' | 'intakeFields'> }) {
  return (
    <section className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
      <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">Como a Clara atende nesta unidade</h2>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-gray-500">Agenda</dt>
          <dd className="text-gray-900">{SCHEDULING_MODE_SUMMARY[settings.schedulingMode]}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Dados que ela pede</dt>
          <dd className="text-gray-900">
            {settings.intakeFields.length > 0 ? (
              <ul className="list-inside list-disc">
                {settings.intakeFields.map((f) => (
                  <li key={f}>{INTAKE_FIELD_LABELS[f]}</li>
                ))}
              </ul>
            ) : (
              'Os de sempre (nome e convênio ao agendar)'
            )}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-gray-400">Configurado pela MedScale. Para mudar, fale com a gente.</p>
    </section>
  )
}
